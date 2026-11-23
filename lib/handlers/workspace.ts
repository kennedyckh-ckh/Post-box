import { all, get, run, tx, now, num, str, audit, type Row } from "../db";
import { newId, sha256 } from "../crypto";
import { route, badRequest, conflict, notFound, forbidden, HttpError, type Ctx } from "../router";
import { requireParticipant, type ParticipantCtx } from "../authz";
import { stageAccess, assertWritable } from "../stages";
import { referenceContent, submissionState } from "../submissions";
import { obj, text, int } from "../validate";
import { CONTENT_LIMITS, validateTable, validateTags, parseJson } from "../content";
import { hit } from "../throttle";
import { reactionConfig, critiqueConfig, reactionSummary, commentsFor, engagementStamp } from "../sharing";
import { validateAndStore, FILE_LIMITS } from "../files";

function attachmentView(id: unknown) {
  if (!id) return null;
  const a = get("SELECT id,mime,bytes,original_name FROM attachments WHERE id=? AND deleted_at IS NULL", str(id));
  return a ? { id: a.id, mime: a.mime, bytes: num(a.bytes), name: a.original_name } : null;
}

function entryForParticipant(e: Row, viewerId: string) {
  return {
    id: e.id, authorName: e.author_name, mine: e.author_id === viewerId, questionId: e.question_id ?? null, kind: e.kind, body: e.body,
    tags: parseJson<string[]>(e.tags_json, []), table: e.table_json ? parseJson(e.table_json, null) : null, attachment: attachmentView(e.attachment_id),
    version: num(e.version), createdAt: num(e.created_at), updatedAt: num(e.updated_at),
  };
}

/** Entries of the participant's *current* group only. Work written in a group they have since left stays with that group. */
function groupEntries(groupId: string, stageId: string): Row[] {
  return all("SELECT * FROM entries WHERE group_id=? AND stage_id=? AND deleted_at IS NULL AND hidden_at IS NULL ORDER BY created_at, id", groupId, stageId);
}

function synthesisOf(groupId: string, stageId: string) {
  const r = get("SELECT body, version, updated_at FROM group_synthesis WHERE group_id=? AND stage_id=?", groupId, stageId);
  return { body: r ? str(r.body) : "", version: r ? num(r.version) : 0, updatedAt: r ? num(r.updated_at) : null };
}

/** Cheap change detector for polling: the client sends the last tag it saw and gets back only "unchanged" if nothing moved. */
function etagFor(rows: Row[], syn: { version: number }, state: string): string {
  return sha256(rows.map((r) => `${r.id}:${r.version}`).join("|") + `#${syn.version}#${state}`).slice(0, 16);
}

function stageDetail(pc: ParticipantCtx, stageId: string) {
  const a = stageAccess(pc, stageId);
  const st = a.stage;
  const groupId = str(pc.group!.id);
  const reference = parseJson<string[]>(st.reference_stage_ids_json, [])
    .map((rid) => get("SELECT * FROM stages WHERE id=? AND session_id=? AND enabled=1 AND visible=1 AND position<?", rid, str(pc.session.id), num(st.position)))
    .filter((r): r is Row => !!r)
    .map((r) => {
      const me = str(pc.participant.id);
      // Submitted work is shown as its frozen snapshot; otherwise the current draft. The label says which.
      const ref = referenceContent(groupId, str(r.id), () => groupEntries(groupId, str(r.id)).map((e) => entryForParticipant(e, me)));
      const entries = ref.snapshot
        ? ref.snapshot.entries.map((e) => ({ id: e.id, authorName: e.authorName, mine: e.authorId === me, questionId: e.questionId, kind: e.kind, body: e.body, tags: e.tags, table: e.table, attachment: e.attachment ? { id: e.attachment.id, mime: e.attachment.mime, bytes: 0, name: e.attachment.name } : null, version: e.version, createdAt: e.createdAt, updatedAt: e.updatedAt }))
        : ref.draft;
      return { stageId: r.id, title: r.title, source: ref.source, entries, synthesis: (ref.snapshot ? ref.snapshot.synthesis?.body : synthesisOf(groupId, str(r.id)).body) || null };
    });
  const resources = all("SELECT r.id,r.kind,r.title,r.url,r.attachment_id,a.mime FROM stage_resources r LEFT JOIN attachments a ON a.id=r.attachment_id WHERE r.stage_id=? ORDER BY r.position", str(st.id)).map((r) => ({
    id: r.id, kind: r.kind, title: r.title, url: r.url ?? null, attachmentId: r.attachment_id ?? null, mime: r.mime ?? null,
  }));
  return {
    stage: {
      id: st.id, title: st.title, instructions: st.instructions, tags: parseJson<string[]>(st.tags_json, []), contributionTypes: parseJson<string[]>(st.contribution_types_json, []),
      availability: a.availability, canWrite: a.canWrite, blockedReason: a.blocked,
    },
    // Only questions the facilitator has revealed. Hidden ones are not sent at all.
    questions: all("SELECT id,text,required FROM stage_questions WHERE stage_id=? AND deleted_at IS NULL AND visible=1 ORDER BY position", str(st.id)).map((q) => ({ id: q.id, text: q.text, required: !!num(q.required) })),
    resources,
    reference,
    synthesis: synthesisOf(groupId, str(st.id)),
    submitPolicy: pc.session.submit_policy,
    representativeId: pc.group!.representative_id ?? null,
    submission: ((s) => ({ status: s.status, revision: s.revision, submittedAt: s.submittedAt, submittedByName: s.submittedByName }))(submissionState(groupId, str(st.id))),
  };
}

route("GET", "/stages/:sid", (ctx) => {
  const pc = requireParticipant(ctx, { allowArchived: true });
  return stageDetail(pc, ctx.params.sid);
});

route("GET", "/stages/:sid/entries", (ctx) => {
  const pc = requireParticipant(ctx, { allowArchived: true });
  const a = stageAccess(pc, ctx.params.sid);
  const groupId = str(pc.group!.id);
  const rows = groupEntries(groupId, ctx.params.sid);
  const syn = synthesisOf(groupId, ctx.params.sid);
  const sub = submissionState(groupId, ctx.params.sid);
  const rcfg = reactionConfig(pc.session);
  const ccfg = critiqueConfig(pc.session);
  const ids = rows.map((r) => str(r.id));
  // Revealing or hiding a question changes the tag, so open pages pick up newly revealed questions within seconds.
  const qStamp = all("SELECT id FROM stage_questions WHERE stage_id=? AND deleted_at IS NULL AND visible=1 ORDER BY position", ctx.params.sid).map((q) => str(q.id)).join(",");
  const tag = etagFor(rows, syn, `${a.availability}:${a.canWrite}:${sub.status}:${sub.revision}:${engagementStamp("entry", ids)}:${rcfg.enabled}:${ccfg.enabled}:${qStamp}`);
  if (ctx.req.query.etag === tag) return { unchanged: true, etag: tag };
  const me = str(pc.participant.id);
  const groupOn = (sc: string) => sc === "group" || sc === "both";
  const reacts = reactionSummary("entry", ids, me, rcfg);
  const comments = commentsFor("entry", ids, me, () => false);
  const engagement = {
    reactions: { enabled: rcfg.enabled && groupOn(rcfg.scope), types: rcfg.types },
    critique: { enabled: ccfg.enabled && groupOn(ccfg.scope), prompts: ccfg.prompts.filter((p) => p.enabled) },
    byEntry: Object.fromEntries(ids.map((id) => [id, { reactions: reacts[id], comments: comments[id] }])),
  };
  return { etag: tag, canWrite: a.canWrite, availability: a.availability, blockedReason: a.blocked, entries: rows.map((e) => entryForParticipant(e, me)), synthesis: syn, engagement, submission: { status: sub.status, revision: sub.revision, submittedAt: sub.submittedAt, submittedByName: sub.submittedByName } };
});

function validateEntryInput(b: Record<string, unknown>, stage: Row, pc: ParticipantCtx, keepQuestionId: string | null = null) {
  const types = parseJson<string[]>(stage.contribution_types_json, []);
  const kind = b.kind === "table" ? "table" : "text";
  if (!types.includes(kind)) throw badRequest(`${kind === "table" ? "Tables are" : "Text is"} not allowed in this part.`);
  const tags = validateTags(b.tags, parseJson<string[]>(stage.tags_json, []));
  let body = "";
  let table: string | null = null;
  if (kind === "text") body = text(b.body, "Your contribution", { max: CONTENT_LIMITS.body });
  else {
    table = JSON.stringify(validateTable(b.table));
    body = text(b.body, "Caption", { max: CONTENT_LIMITS.caption, optional: true });
  }
  let questionId: string | null = null;
  if (b.questionId !== undefined && b.questionId !== null && b.questionId !== "") {
    // Hidden questions cannot be answered yet, except that an entry already linked to one may be edited and keep its link.
    const q = get("SELECT id, visible FROM stage_questions WHERE id=? AND stage_id=? AND deleted_at IS NULL", str(b.questionId), str(stage.id));
    if (!q || (!num(q.visible) && str(q.id) !== keepQuestionId)) throw badRequest("That question is not part of this part.");
    questionId = str(q.id);
  }
  let attachmentId: string | null = null;
  if (b.attachmentId !== undefined && b.attachmentId !== null && b.attachmentId !== "") {
    if (!types.includes("image")) throw badRequest("Images are not allowed in this part.");
    const att = get("SELECT * FROM attachments WHERE id=? AND deleted_at IS NULL AND purpose='entry'", str(b.attachmentId));
    // Only the uploader, in their own group, can attach a picture, and a picture belongs to at most one entry.
    if (!att || att.owner_participant_id !== pc.participant.id || att.group_id !== pc.group!.id) throw badRequest("That picture was not found. Upload it again.");
    attachmentId = str(att.id);
  }
  return { kind, body, tags, table, questionId, attachmentId };
}

function saveVersion(id: string, v: number, c: ReturnType<typeof validateEntryInput>) {
  run("INSERT INTO entry_versions(entry_id,version,question_id,kind,body,tags_json,table_json,attachment_id,saved_at) VALUES(?,?,?,?,?,?,?,?,?)", id, v, c.questionId, c.kind, c.body, JSON.stringify(c.tags), c.table, c.attachmentId, now());
}

route("POST", "/stages/:sid/entries", (ctx) => {
  const pc = requireParticipant(ctx);
  const a = stageAccess(pc, ctx.params.sid);
  assertWritable(a);
  hit(`entry:${pc.participant.id}`, 120, 60_000);
  const b = obj(ctx.req.body);
  const c = validateEntryInput(b, a.stage, pc);
  const key = b.clientKey === undefined ? null : text(b.clientKey, "clientKey", { max: 64 });
  const pid = str(pc.participant.id);
  const id = newId("ent");
  const out = tx(() => {
    // A retry with the same clientKey returns the entry that was already saved instead of creating a duplicate.
    if (key) {
      const dup = get("SELECT * FROM entries WHERE author_id=? AND client_key=?", pid, key);
      if (dup) return { entry: entryForParticipant(dup, pid), duplicate: true };
    }
    if (num(get("SELECT COUNT(*) AS c FROM entries WHERE author_id=? AND stage_id=? AND deleted_at IS NULL", pid, ctx.params.sid)!.c) >= 100) throw badRequest("You have reached the limit of 100 entries in this part.");
    if (c.attachmentId && get("SELECT 1 AS x FROM entries WHERE attachment_id=? AND deleted_at IS NULL", c.attachmentId)) throw badRequest("That picture is already attached to another entry.");
    run("INSERT INTO entries(id,session_id,group_id,stage_id,question_id,author_id,author_name,kind,body,tags_json,table_json,attachment_id,version,client_key,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,1,?,?,?)",
      id, str(pc.session.id), str(pc.group!.id), ctx.params.sid, c.questionId, pid, str(pc.participant.display_name), c.kind, c.body, JSON.stringify(c.tags), c.table, c.attachmentId, key, now(), now());
    saveVersion(id, 1, c);
    return { entry: entryForParticipant(get("SELECT * FROM entries WHERE id=?", id)!, pid), duplicate: false };
  });
  return out;
});

/** The participant's own entry in their own group. Anything else answers 404. */
function ownEntry(pc: ParticipantCtx, id: string): Row {
  const e = get("SELECT * FROM entries WHERE id=? AND deleted_at IS NULL", id);
  if (!e || e.author_id !== pc.participant.id || !pc.group || e.group_id !== pc.group.id) throw notFound("Entry not found");
  if (e.hidden_at) throw forbidden("Your facilitator has hidden this entry, so it cannot be changed.", "entry_hidden");
  return e;
}

route("PATCH", "/entries/:id", (ctx) => {
  const pc = requireParticipant(ctx);
  const e0 = ownEntry(pc, ctx.params.id);
  const a = stageAccess(pc, str(e0.stage_id));
  assertWritable(a);
  hit(`entry:${pc.participant.id}`, 120, 60_000);
  const b = obj(ctx.req.body);
  const base = int(b.baseVersion, "baseVersion", { min: 1 })!;
  const c = validateEntryInput(b, a.stage, pc, e0.question_id ? str(e0.question_id) : null);
  return tx(() => {
    const cur = get("SELECT * FROM entries WHERE id=? AND deleted_at IS NULL", str(e0.id))!;
    const me = str(pc.participant.id);
    // Optimistic concurrency: the edit applies only if it was made on top of the latest saved version.
    if (num(cur.version) !== base) throw new HttpError(409, "edit_conflict", "This entry was changed somewhere else (for example on another device) since you opened it. Your text has not been lost: it is still on your screen.", { current: entryForParticipant(cur, me) });
    if (c.attachmentId && get("SELECT 1 AS x FROM entries WHERE attachment_id=? AND id<>? AND deleted_at IS NULL", c.attachmentId, str(cur.id))) throw badRequest("That picture is already attached to another entry.");
    const v = base + 1;
    run("UPDATE entries SET question_id=?, kind=?, body=?, tags_json=?, table_json=?, attachment_id=?, version=?, updated_at=? WHERE id=?", c.questionId, c.kind, c.body, JSON.stringify(c.tags), c.table, c.attachmentId, v, now(), str(cur.id));
    saveVersion(str(cur.id), v, c);
    return { entry: entryForParticipant(get("SELECT * FROM entries WHERE id=?", str(cur.id))!, me) };
  });
});

route("DELETE", "/entries/:id", (ctx) => {
  const pc = requireParticipant(ctx);
  const e = ownEntry(pc, ctx.params.id);
  assertWritable(stageAccess(pc, str(e.stage_id)));
  // Soft delete: the row and its versions stay for the audit trail and for any snapshot taken earlier.
  run("UPDATE entries SET deleted_at=?, updated_at=? WHERE id=?", now(), now(), str(e.id));
  audit("participant", str(pc.participant.id), "entry_deleted", { sessionId: str(pc.session.id), target: str(e.id) });
  return { ok: true };
});

/* ----- group synthesis: one jointly agreed response; never replaces individual entries ----- */

route("PUT", "/stages/:sid/synthesis", (ctx) => {
  const pc = requireParticipant(ctx);
  const a = stageAccess(pc, ctx.params.sid);
  assertWritable(a);
  const b = obj(ctx.req.body);
  const base = int(b.baseVersion, "baseVersion", { min: 0 })!;
  const body = text(b.body, "Group response", { max: CONTENT_LIMITS.body, optional: true });
  const gid = str(pc.group!.id);
  return tx(() => {
    const cur = synthesisOf(gid, ctx.params.sid);
    if (cur.version !== base) throw new HttpError(409, "edit_conflict", "Someone in your group changed the group response since you opened it. Your text is still on your screen: compare, then save again.", { current: cur });
    const v = base + 1;
    run("INSERT INTO group_synthesis(group_id,stage_id,body,version,updated_by,updated_at) VALUES(?,?,?,?,?,?) ON CONFLICT(group_id,stage_id) DO UPDATE SET body=excluded.body, version=excluded.version, updated_by=excluded.updated_by, updated_at=excluded.updated_at", gid, ctx.params.sid, body, v, str(pc.participant.id), now());
    run("INSERT INTO group_synthesis_versions(group_id,stage_id,version,body,updated_by,saved_at) VALUES(?,?,?,?,?,?)", gid, ctx.params.sid, v, body, str(pc.participant.id), now());
    return { synthesis: synthesisOf(gid, ctx.params.sid) };
  });
});

/* ----- picture upload for entries ----- */

route("POST", "/stages/:sid/uploads", (ctx) => {
  const pc = requireParticipant(ctx);
  const a = stageAccess(pc, ctx.params.sid);
  assertWritable(a);
  if (!parseJson<string[]>(a.stage.contribution_types_json, []).includes("image")) throw badRequest("Images are not allowed in this part.");
  hit(`upload:${pc.participant.id}`, 30, 10 * 60_000);
  const buf = ctx.req.raw;
  if (!buf) throw badRequest("No file received.");
  const pid = str(pc.participant.id);
  if (num(get("SELECT COUNT(*) AS c FROM attachments WHERE owner_participant_id=? AND deleted_at IS NULL", pid)!.c) >= FILE_LIMITS.perParticipantFiles) throw conflict("You have reached the limit of pictures for this session.", "quota_exceeded");
  const used = num(get("SELECT COALESCE(SUM(bytes),0) AS b FROM attachments WHERE session_id=? AND deleted_at IS NULL", str(pc.session.id))!.b);
  if (used + buf.length > FILE_LIMITS.sessionQuotaBytes) throw conflict("This session has reached its storage limit. Tell your facilitator.", "quota_exceeded");
  const saved = validateAndStore(buf, { who: "participant", originalName: ctx.req.headers["x-filename"] });
  run("INSERT INTO attachments(id,session_id,group_id,owner_participant_id,purpose,mime,bytes,sha256,stored_name,original_name,created_at) VALUES(?,?,?,?, 'entry',?,?,?,?,?,?)", saved.id, str(pc.session.id), str(pc.group!.id), pid, saved.mime, saved.bytes, saved.sha, saved.storedName, saved.originalName, now());
  return { attachment: { id: saved.id, mime: saved.mime, bytes: saved.bytes, name: saved.originalName } };
}, { raw: true });

void (null as unknown as Ctx);
