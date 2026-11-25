import { all, get, run, tx, now, num, str, audit, type Row } from "../db";
import { newId } from "../crypto";
import { route, badRequest, conflict, notFound, forbidden, HttpError, type Ctx } from "../router";
import { requireStaff, facilitatorSession, groupForFacilitator, mustBeEditable } from "../authz";
import { obj, text, bool, oneOf, int } from "../validate";
import { parseJson, cleanOptions } from "../content";
import { stageTallies } from "../tally";
import { allQuestions } from "../questions";
import { validateAndStore, removeStored, FILE_LIMITS } from "../files";
import { expectedGroups, submissionState } from "../submissions";
import { reactionConfig, reactionSummary } from "../sharing";

function stageForFacilitator(ctx: Ctx, stageId: string): { stage: Row; session: Row } {
  const stage = get("SELECT * FROM stages WHERE id=?", stageId);
  if (!stage) throw notFound("Part not found");
  const session = facilitatorSession(ctx, str(stage.session_id));
  return { stage, session };
}

function questionsOf(stageId: string) {
  return allQuestions(stageId);
}
function resourcesOf(stageId: string) {
  return all("SELECT r.id,r.kind,r.title,r.url,r.attachment_id,a.mime,a.bytes FROM stage_resources r LEFT JOIN attachments a ON a.id=r.attachment_id WHERE r.stage_id=? ORDER BY r.position", stageId).map((r) => ({
    id: r.id, kind: r.kind, title: r.title, url: r.url ?? null, attachmentId: r.attachment_id ?? null, mime: r.mime ?? null, bytes: r.bytes ?? null,
  }));
}

route("GET", "/sessions/:id/stages", (ctx) => {
  const s = facilitatorSession(ctx, ctx.params.id);
  const stages = all("SELECT * FROM stages WHERE session_id=? ORDER BY position", str(s.id)).map((st) => ({
    id: st.id, position: num(st.position), title: st.title, enabled: !!num(st.enabled), visible: !!num(st.visible), availability: st.availability,
    instructions: st.instructions, tags: parseJson<string[]>(st.tags_json, []), contributionTypes: parseJson<string[]>(st.contribution_types_json, []),
    referenceStageIds: parseJson<string[]>(st.reference_stage_ids_json, []), submitMode: str(st.submit_mode ?? "group"),
    questions: questionsOf(str(st.id)), resources: resourcesOf(str(st.id)), tallies: stageTallies(str(st.id)),
    entryCount: num(get("SELECT COUNT(*) AS c FROM entries WHERE stage_id=? AND deleted_at IS NULL", str(st.id))!.c),
  }));
  const groupSettings = all("SELECT g.group_id, g.stage_id, g.availability_override, g.excluded FROM group_stage_settings g JOIN groups x ON x.id=g.group_id WHERE x.session_id=?", str(s.id)).map((r) => ({
    groupId: r.group_id, stageId: r.stage_id, availabilityOverride: r.availability_override ?? null, excluded: !!num(r.excluded),
  }));
  return { stages, groupSettings };
});

const TRANSITIONS: Record<string, string[]> = { locked: ["open"], open: ["closed", "locked"], closed: ["open", "locked"] };

route("PATCH", "/stages/:sid", (ctx) => {
  const u = requireStaff(ctx);
  const { stage, session } = stageForFacilitator(ctx, ctx.params.sid);
  mustBeEditable(session);
  const b = obj(ctx.req.body);
  const sets: string[] = [];
  const vals: unknown[] = [];
  const changes: Record<string, unknown> = {};

  if (b.title !== undefined) { sets.push("title=?"); vals.push(text(b.title, "Part title", { max: 100 })); }
  if (b.instructions !== undefined) { sets.push("instructions=?"); vals.push(text(b.instructions, "Instructions", { max: 4000, optional: true })); }
  if (b.tags !== undefined) {
    if (!Array.isArray(b.tags) || b.tags.length > 12) throw badRequest("Give at most 12 tags.");
    const tags = [...new Set(b.tags.map((t) => text(t, "Tag", { max: 30 })))];
    sets.push("tags_json=?"); vals.push(JSON.stringify(tags));
  }
  if (b.contributionTypes !== undefined) {
    if (!Array.isArray(b.contributionTypes)) throw badRequest("Contribution types must be a list.");
    const types = [...new Set(b.contributionTypes.map((t) => oneOf(t, "Contribution type", ["text", "table", "image"] as const)))];
    if (!types.includes("text") && !types.includes("table")) throw badRequest("Allow at least text or tables.");
    sets.push("contribution_types_json=?"); vals.push(JSON.stringify(types));
  }
  if (b.referenceStageIds !== undefined) {
    if (!Array.isArray(b.referenceStageIds)) throw badRequest("Reference parts must be a list.");
    for (const rid of b.referenceStageIds) {
      const r = get("SELECT position FROM stages WHERE id=? AND session_id=?", String(rid), str(session.id));
      if (!r || num(r.position) >= num(stage.position)) throw badRequest("The reference panel can only show work from earlier parts of this session.");
    }
    sets.push("reference_stage_ids_json=?"); vals.push(JSON.stringify([...new Set(b.referenceStageIds.map(String))]));
  }
  // "group": the group submits the whole part together. "individual": each person submits each answer on its own.
  if (b.submitMode !== undefined) { const m = oneOf(b.submitMode, "How this part is submitted", ["group", "individual"] as const); sets.push("submit_mode=?"); vals.push(m); changes.submitMode = m; }
  if (b.visible !== undefined) { const v = bool(b.visible, "visible"); sets.push("visible=?"); vals.push(v ? 1 : 0); changes.visible = v; }
  if (b.enabled !== undefined) {
    const en = bool(b.enabled, "enabled");
    if (!en) {
      const others = num(get("SELECT COUNT(*) AS c FROM stages WHERE session_id=? AND enabled=1 AND id<>?", str(session.id), str(stage.id))!.c);
      if (others === 0) throw badRequest("At least one part must stay enabled.");
    }
    sets.push("enabled=?"); vals.push(en ? 1 : 0); changes.enabled = en;
  }
  if (b.availability !== undefined) {
    const to = oneOf(b.availability, "availability", ["locked", "open", "closed"] as const);
    const from = str(stage.availability);
    if (to !== from) {
      if (session.status !== "live") throw conflict("Start the session before opening or closing parts.", "not_live");
      if (!TRANSITIONS[from].includes(to)) throw conflict(`A part cannot go from ${from} to ${to}.`, "bad_transition");
      if (to === "locked" && num(get("SELECT COUNT(*) AS c FROM entries WHERE stage_id=?", str(stage.id))!.c) > 0) throw conflict("This part already has contributions, so it cannot be locked again. Close it instead.", "has_entries");
      // Releasing a later part while expected groups have not submitted the previous one needs a deliberate, recorded reason.
      if (to === "open" && from === "locked") {
        const prev = get("SELECT id,title,submit_mode FROM stages WHERE session_id=? AND enabled=1 AND position<? ORDER BY position DESC LIMIT 1", str(session.id), num(stage.position));
        // A part where each person submits their own answers has no group submission to wait for.
        if (prev && prev.submit_mode !== "individual") {
          const missing = expectedGroups(str(session.id), str(prev.id)).filter((g) => submissionState(str(g.id), str(prev.id)).status !== "submitted").map((g) => ({ id: str(g.id), name: str(g.name) }));
          if (missing.length) {
            const reason = typeof b.proceedReason === "string" ? text(b.proceedReason, "Reason", { max: 300, optional: true }) : "";
            if (!reason) throw new HttpError(409, "groups_not_submitted", `${missing.length} expected group${missing.length === 1 ? "" : "s"} ha${missing.length === 1 ? "s" : "ve"} not submitted ${str(prev.title)}. Give a reason to open this part anyway.`, { missing, previousStage: prev.title });
            run("INSERT INTO proceed_overrides(id,session_id,stage_id,user_id,reason,missing_groups_json,at) VALUES(?,?,?,?,?,?,?)", newId("ovr"), str(session.id), str(stage.id), u.id, reason, JSON.stringify(missing), now());
            audit("facilitator", u.id, "proceed_override", { sessionId: str(session.id), target: str(stage.id), detail: { reason, missing: missing.map((m) => m.name) } });
          }
        }
      }
      sets.push("availability=?"); vals.push(to); changes.availability = { from, to };
    }
  }
  if (!sets.length) {
    if (b.availability !== undefined) return { ok: true }; // no change needed
    throw badRequest("Nothing to change.");
  }
  vals.push(str(stage.id));
  // Only this stage row changes. Opening a stage never touches other stages, entries or publication.
  run(`UPDATE stages SET ${sets.join(",")} WHERE id=?`, ...vals);
  audit("facilitator", u.id, changes.availability ? "stage_availability_changed" : "stage_updated", { sessionId: str(session.id), target: str(stage.id), detail: { ...changes, fields: Object.keys(b) } });
  return { ok: true };
});

/* ----- questions ----- */

route("POST", "/stages/:sid/questions", (ctx) => {
  const u = requireStaff(ctx);
  const { stage, session } = stageForFacilitator(ctx, ctx.params.sid);
  mustBeEditable(session);
  const b = obj(ctx.req.body);
  const t = text(b.text, "Question", { max: 500 });
  const id = newId("que");
  const pos = num(get("SELECT COALESCE(MAX(position),0)+1 AS p FROM stage_questions WHERE stage_id=?", str(stage.id))!.p);
  // Optional parentId makes this a sub-question of a main question in the same part (one level only).
  let parentId: string | null = null;
  if (b.parentId !== undefined && b.parentId !== null && b.parentId !== "") {
    const parent = get("SELECT id, parent_id FROM stage_questions WHERE id=? AND stage_id=? AND deleted_at IS NULL", str(b.parentId), str(stage.id));
    if (!parent) throw badRequest("The main question was not found in this part.");
    if (parent.parent_id) throw badRequest("Sub-questions cannot have their own sub-questions.");
    if (num(get("SELECT COUNT(*) AS c FROM stage_questions WHERE parent_id=? AND deleted_at IS NULL", str(parent.id))!.c) >= 10) throw badRequest("A question can have at most 10 sub-questions.");
    parentId = str(parent.id);
  }
  // visible defaults to true; send visible:false to keep the question hidden until you reveal it. Sub-questions follow their main question.
  const visible = parentId ? true : b.visible === undefined ? true : bool(b.visible, "visible");
  // Optional heading, for main questions only.
  const heading = parentId ? "" : text(b.heading, "Heading", { max: 120, optional: true }).trim();
  if (parentId && typeof b.heading === "string" && b.heading.trim()) throw badRequest("Headings are for main questions only.");
  // Optional response options (for example Agree / Disagree): participants then choose one and give a reason.
  const options = cleanOptions(b.options);
  run("INSERT INTO stage_questions(id,stage_id,position,text,required,visible,parent_id,heading,options_json) VALUES(?,?,?,?,?,?,?,?,?)", id, str(stage.id), pos, t, b.required === true ? 1 : 0, visible ? 1 : 0, parentId, heading, JSON.stringify(options));
  audit("facilitator", u.id, "question_added", { sessionId: str(session.id), target: id });
  return { id };
});

function questionForFacilitator(ctx: Ctx, qid: string) {
  const q = get("SELECT q.*, s.session_id FROM stage_questions q JOIN stages s ON s.id=q.stage_id WHERE q.id=? AND q.deleted_at IS NULL", qid);
  if (!q) throw notFound("Question not found");
  const session = facilitatorSession(ctx, str(q.session_id));
  return { q, session };
}

route("PATCH", "/questions/:qid", (ctx) => {
  const u = requireStaff(ctx);
  const { q, session } = questionForFacilitator(ctx, ctx.params.qid);
  mustBeEditable(session);
  const b = obj(ctx.req.body);
  const sets: string[] = [];
  const vals: unknown[] = [];
  if (b.text !== undefined) { sets.push("text=?"); vals.push(text(b.text, "Question", { max: 500 })); }
  if (b.required !== undefined) { sets.push("required=?"); vals.push(bool(b.required, "required") ? 1 : 0); }
  if (b.heading !== undefined) {
    const h = text(b.heading, "Heading", { max: 120, optional: true }).trim();
    if (q.parent_id && h) throw badRequest("Headings are for main questions only.");
    sets.push("heading=?"); vals.push(h);
  }
  // Changing the options keeps earlier answers; a choice that no longer matches is shown as "other" in the class results.
  if (b.options !== undefined) { sets.push("options_json=?"); vals.push(JSON.stringify(cleanOptions(b.options))); }
  let visibility: boolean | undefined;
  if (b.visible !== undefined) {
    if (q.parent_id) throw badRequest("A sub-question is shown together with its main question. Reveal or hide the main question instead.");
    visibility = bool(b.visible, "visible"); sets.push("visible=?"); vals.push(visibility ? 1 : 0);
  }
  if (!sets.length) throw badRequest("Nothing to change.");
  vals.push(str(q.id));
  run(`UPDATE stage_questions SET ${sets.join(",")} WHERE id=?`, ...vals);
  audit("facilitator", u.id, visibility === undefined ? "question_updated" : visibility ? "question_revealed" : "question_hidden", { sessionId: str(session.id), target: str(q.id) });
  return { ok: true };
});

/**
 * Reveal questions on click. mode "next" reveals the first hidden question (in order), "all" reveals every question,
 * "none" hides every question again. Answers already written are never affected.
 */
route("POST", "/stages/:sid/questions/reveal", (ctx) => {
  const u = requireStaff(ctx);
  const { stage, session } = stageForFacilitator(ctx, ctx.params.sid);
  mustBeEditable(session);
  const mode = oneOf(obj(ctx.req.body).mode, "mode", ["next", "all", "none"] as const);
  const sid = str(stage.id);
  let changed = 0;
  if (mode === "next") {
    const q = get("SELECT id FROM stage_questions WHERE stage_id=? AND deleted_at IS NULL AND parent_id IS NULL AND visible=0 ORDER BY position LIMIT 1", sid);
    if (q) { run("UPDATE stage_questions SET visible=1 WHERE id=?", str(q.id)); changed = 1; }
  } else {
    changed = run("UPDATE stage_questions SET visible=? WHERE stage_id=? AND deleted_at IS NULL AND parent_id IS NULL AND visible<>?", mode === "all" ? 1 : 0, sid, mode === "all" ? 1 : 0).changes;
  }
  audit("facilitator", u.id, mode === "none" ? "questions_hidden" : "questions_revealed", { sessionId: str(session.id), target: sid, detail: { mode, changed } });
  const qs = questionsOf(sid);
  const top = qs.filter((q) => !q.parentId);
  return { changed, visibleCount: top.filter((q) => q.visible).length, total: top.length };
});

/** Questions are retired, not erased: earlier entries keep pointing at them. */
route("DELETE", "/questions/:qid", (ctx) => {
  const u = requireStaff(ctx);
  const { q, session } = questionForFacilitator(ctx, ctx.params.qid);
  mustBeEditable(session);
  // Removing a main question also retires its sub-questions.
  run("UPDATE stage_questions SET deleted_at=? WHERE (id=? OR parent_id=?) AND deleted_at IS NULL", now(), str(q.id), str(q.id));
  audit("facilitator", u.id, "question_removed", { sessionId: str(session.id), target: str(q.id) });
  return { ok: true };
});

/* ----- resources: external links and uploaded files ----- */

function cleanUrl(v: unknown): string {
  const raw = text(v, "Link", { max: 500 });
  let u: URL;
  try { u = new URL(raw); } catch { throw badRequest("Enter a full web address starting with https:// or http://."); }
  if (u.protocol !== "https:" && u.protocol !== "http:") throw badRequest("Only http and https links are allowed.");
  return u.toString();
}

route("POST", "/stages/:sid/resources", (ctx) => {
  const u = requireStaff(ctx);
  const { stage, session } = stageForFacilitator(ctx, ctx.params.sid);
  mustBeEditable(session);
  const b = obj(ctx.req.body);
  const title = text(b.title, "Link title", { max: 100 });
  const url = cleanUrl(b.url);
  if (num(get("SELECT COUNT(*) AS c FROM stage_resources WHERE stage_id=?", str(stage.id))!.c) >= 20) throw badRequest("At most 20 links and files per part.");
  const id = newId("res");
  const pos = num(get("SELECT COALESCE(MAX(position),0)+1 AS p FROM stage_resources WHERE stage_id=?", str(stage.id))!.p);
  run("INSERT INTO stage_resources(id,stage_id,position,kind,title,url) VALUES(?,?,?,'link',?,?)", id, str(stage.id), pos, title, url);
  audit("facilitator", u.id, "resource_added", { sessionId: str(session.id), target: id });
  return { id };
});

route("POST", "/stages/:sid/resources/file", (ctx) => {
  const u = requireStaff(ctx);
  const { stage, session } = stageForFacilitator(ctx, ctx.params.sid);
  mustBeEditable(session);
  const buf = ctx.req.raw;
  if (!buf) throw badRequest("No file received.");
  const used = num(get("SELECT COALESCE(SUM(bytes),0) AS b FROM attachments WHERE session_id=? AND deleted_at IS NULL", str(session.id))!.b);
  if (used + buf.length > FILE_LIMITS.sessionQuotaBytes) throw conflict("This session has reached its storage limit.", "quota_exceeded");
  if (num(get("SELECT COUNT(*) AS c FROM stage_resources WHERE stage_id=?", str(stage.id))!.c) >= 20) throw badRequest("At most 20 links and files per part.");
  const saved = validateAndStore(buf, { who: "facilitator", originalName: ctx.req.headers["x-filename"] });
  const title = text(ctx.req.query.title || saved.originalName, "File title", { max: 100 });
  const rid = newId("res");
  tx(() => {
    run("INSERT INTO attachments(id,session_id,owner_user_id,purpose,mime,bytes,sha256,stored_name,original_name,created_at) VALUES(?,?,?,'resource',?,?,?,?,?,?)", saved.id, str(session.id), u.id, saved.mime, saved.bytes, saved.sha, saved.storedName, saved.originalName, now());
    const pos = num(get("SELECT COALESCE(MAX(position),0)+1 AS p FROM stage_resources WHERE stage_id=?", str(stage.id))!.p);
    run("INSERT INTO stage_resources(id,stage_id,position,kind,title,attachment_id) VALUES(?,?,?,'file',?,?)", rid, str(stage.id), pos, title, saved.id);
    audit("facilitator", u.id, "resource_file_added", { sessionId: str(session.id), target: rid });
  });
  return { id: rid, attachmentId: saved.id };
}, { raw: true });

route("DELETE", "/resources/:rid", (ctx) => {
  const u = requireStaff(ctx);
  const r = get("SELECT r.*, s.session_id FROM stage_resources r JOIN stages s ON s.id=r.stage_id WHERE r.id=?", ctx.params.rid);
  if (!r) throw notFound("Resource not found");
  const session = facilitatorSession(ctx, str(r.session_id));
  mustBeEditable(session);
  tx(() => {
    run("DELETE FROM stage_resources WHERE id=?", str(r.id));
    if (r.attachment_id) {
      const a = get("SELECT stored_name FROM attachments WHERE id=?", str(r.attachment_id));
      run("UPDATE attachments SET deleted_at=? WHERE id=?", now(), str(r.attachment_id));
      if (a) removeStored(str(a.stored_name));
    }
    audit("facilitator", u.id, "resource_removed", { sessionId: str(session.id), target: str(r.id) });
  });
  return { ok: true };
});

/* ----- per-group override and exclusion ----- */

route("PUT", "/groups/:gid/stages/:sid", (ctx) => {
  const u = requireStaff(ctx);
  const { group, session } = groupForFacilitator(ctx, ctx.params.gid);
  mustBeEditable(session);
  const stage = get("SELECT id FROM stages WHERE id=? AND session_id=?", ctx.params.sid, str(session.id));
  if (!stage) throw notFound("Part not found");
  const b = obj(ctx.req.body);
  const cur = get("SELECT * FROM group_stage_settings WHERE group_id=? AND stage_id=?", str(group.id), str(stage.id));
  const override = b.availabilityOverride === undefined ? (cur?.availability_override ?? null) : b.availabilityOverride === null ? null : oneOf(b.availabilityOverride, "availabilityOverride", ["locked", "open", "closed"] as const);
  const excluded = b.excluded === undefined ? !!num(cur?.excluded) : bool(b.excluded, "excluded");
  if (override && session.status !== "live") throw conflict("Start the session before opening or closing parts.", "not_live");
  run("INSERT INTO group_stage_settings(group_id,stage_id,availability_override,excluded) VALUES(?,?,?,?) ON CONFLICT(group_id,stage_id) DO UPDATE SET availability_override=excluded.availability_override, excluded=excluded.excluded", str(group.id), str(stage.id), override, excluded ? 1 : 0);
  audit("facilitator", u.id, "group_stage_setting_changed", { sessionId: str(session.id), target: str(group.id), detail: { stageId: stage.id, override, excluded } });
  return { ok: true };
});

/* ----- facilitator reads and moderates contributions ----- */

export function entryRow(e: Row) {
  return {
    id: e.id, groupId: e.group_id, stageId: e.stage_id, questionId: e.question_id ?? null, choice: e.choice ?? null, authorId: e.author_id, authorName: e.author_name,
    kind: e.kind, body: e.body, tags: parseJson<string[]>(e.tags_json, []), table: e.table_json ? parseJson(e.table_json, null) : null,
    attachmentId: e.attachment_id ?? null, version: num(e.version), createdAt: num(e.created_at), updatedAt: num(e.updated_at), hidden: !!e.hidden_at,
    submittedAt: e.submitted_at ? num(e.submitted_at) : null,
  };
}

route("GET", "/sessions/:id/entries", (ctx) => {
  const s = facilitatorSession(ctx, ctx.params.id);
  const where = ["session_id=?", "deleted_at IS NULL"];
  const args: unknown[] = [str(s.id)];
  if (ctx.req.query.stageId) { where.push("stage_id=?"); args.push(ctx.req.query.stageId); }
  if (ctx.req.query.groupId) { where.push("group_id=?"); args.push(ctx.req.query.groupId); }
  const rows = all(`SELECT * FROM entries WHERE ${where.join(" AND ")} ORDER BY created_at, id LIMIT 2000`, ...args);
  const out = rows.map(entryRow);
  // Optional sort by engagement (total reactions, or one reaction type). Ties keep the stable order above. Counts are engagement, not correctness.
  const sort = str(ctx.req.query.sort || "");
  const sums = reactionSummary("entry", out.map((e) => str(e.id)), null, reactionConfig(s));
  const withReacts = out.map((e) => ({ ...e, reactions: { total: sums[str(e.id)].total, byType: sums[str(e.id)].counts } }));
  if (sort === "reactions" || sort.startsWith("type:")) {
    const k = (e: (typeof withReacts)[number]) => (sort === "reactions" ? e.reactions.total : e.reactions.byType[sort.slice(5)] ?? 0);
    withReacts.sort((a, b) => k(b) - k(a));
  }
  return { entries: withReacts };
});

/** Hides an entry from participants without deleting it. The author cannot edit a hidden entry. */
route("POST", "/entries/:id/hide", (ctx) => {
  const u = requireStaff(ctx);
  const e = get("SELECT * FROM entries WHERE id=? AND deleted_at IS NULL", ctx.params.id);
  if (!e) throw notFound("Entry not found");
  const session = facilitatorSession(ctx, str(e.session_id));
  mustBeEditable(session);
  const hidden = bool(obj(ctx.req.body).hidden, "hidden");
  run("UPDATE entries SET hidden_at=?, hidden_by=? WHERE id=?", hidden ? now() : null, hidden ? u.id : null, str(e.id));
  audit("facilitator", u.id, hidden ? "entry_hidden" : "entry_unhidden", { sessionId: str(session.id), target: str(e.id) });
  return { ok: true };
});

/** In a part where each person submits their own answers: give one submitted answer back so its author can change it. */
route("POST", "/entries/:id/return", (ctx) => {
  const u = requireStaff(ctx);
  const e = get("SELECT * FROM entries WHERE id=? AND deleted_at IS NULL", ctx.params.id);
  if (!e) throw notFound("Entry not found");
  const session = facilitatorSession(ctx, str(e.session_id));
  mustBeEditable(session);
  if (!e.submitted_at) throw conflict("This answer has not been submitted.", "not_submitted");
  run("UPDATE entries SET submitted_at=NULL WHERE id=?", str(e.id));
  audit("facilitator", u.id, "answer_returned", { sessionId: str(session.id), target: str(e.id) });
  return { ok: true };
});

void HttpError;
void forbidden;
void int;
