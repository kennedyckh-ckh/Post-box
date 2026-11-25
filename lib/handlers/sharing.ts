import { all, get, run, tx, now, num, str, audit, type Row } from "../db";
import { stageTallies } from "../tally";
import { newId, randomToken, sha256 } from "../crypto";
import { route, badRequest, conflict, forbidden, notFound, type Ctx } from "../router";
import { requireStaff, requireParticipant, facilitatorSession, mustBeEditable, type ParticipantCtx } from "../authz";
import { stageAccess } from "../stages";
import { obj, text, bool, oneOf } from "../validate";
import { hit } from "../throttle";
import { parseJson } from "../content";
import { expectedGroups, submissionState, individualProgress } from "../submissions";
import { allQuestions } from "../questions";
import { timerView } from "../timer";
import { buildContent, sourceVersionOf, publicView, reactionConfig, critiqueConfig, reactionSummary, commentsFor, upsertPublication, type PubContent } from "../sharing";

/* ===================== facilitator: publish, update, unpublish ===================== */

function pubForFacilitator(ctx: Ctx, pid: string): { pub: Row; session: Row } {
  const pub = get("SELECT * FROM publications WHERE id=?", pid);
  if (!pub) throw notFound("Shared item not found");
  return { pub, session: facilitatorSession(ctx, str(pub.session_id)) };
}

/** Publish (or republish, to update) a selected entry, group submission or AI output as a frozen snapshot. */
route("POST", "/sessions/:id/publications", (ctx) => {
  const u = requireStaff(ctx);
  const s = facilitatorSession(ctx, ctx.params.id);
  mustBeEditable(s);
  const b = obj(ctx.req.body);
  const type = oneOf(b.sourceType, "sourceType", ["entry", "submission"] as const);
  const sourceId = text(b.sourceId, "sourceId", { max: 60 });
  const mode = b.labelMode === undefined ? (num(s.anonymise_default) ? "anonymous" : "group") : oneOf(b.labelMode, "labelMode", ["group", "anonymous"] as const);
  const built = buildContent(str(s.id), type, sourceId);
  if (!built) throw notFound("That item was not found in this session.");
  const id = upsertPublication({ sessionId: str(s.id), userId: u.id, type, sourceId, content: built.content, version: built.version, groupId: built.groupId, stageId: built.stageId, mode });
  return { id };
});

route("POST", "/publications/:pid/unpublish", (ctx) => {
  const u = requireStaff(ctx);
  const { pub, session } = pubForFacilitator(ctx, ctx.params.pid);
  mustBeEditable(session);
  // Removes access through the application. It cannot retract screenshots or anything already downloaded.
  run("UPDATE publications SET unpublished_at=?, present=0 WHERE id=?", now(), str(pub.id));
  audit("facilitator", u.id, "unpublished", { sessionId: str(session.id), target: str(pub.id) });
  return { ok: true };
});

route("POST", "/publications/:pid/present", (ctx) => {
  const u = requireStaff(ctx);
  const { pub, session } = pubForFacilitator(ctx, ctx.params.pid);
  mustBeEditable(session);
  const present = bool(obj(ctx.req.body).present, "present");
  if (present && pub.unpublished_at) throw conflict("Publish this item again before showing it on the projector.", "unpublished");
  run("UPDATE publications SET present=? WHERE id=?", present ? 1 : 0, str(pub.id));
  audit("facilitator", u.id, present ? "approved_for_projector" : "removed_from_projector", { sessionId: str(session.id), target: str(pub.id) });
  return { ok: true };
});

/** One toggle for every shared item: group labels or anonymous labels ("Sample Response 3"). */
route("POST", "/sessions/:id/label-mode", (ctx) => {
  const u = requireStaff(ctx);
  const s = facilitatorSession(ctx, ctx.params.id);
  mustBeEditable(s);
  const mode = oneOf(obj(ctx.req.body).mode, "mode", ["group", "anonymous"] as const);
  tx(() => {
    run("UPDATE publications SET label_mode=? WHERE session_id=?", mode, str(s.id));
    run("UPDATE sessions SET anonymise_default=?, updated_at=? WHERE id=?", mode === "anonymous" ? 1 : 0, now(), str(s.id));
    audit("facilitator", u.id, "label_mode_changed", { sessionId: str(s.id), detail: { mode } });
  });
  return { ok: true };
});

function facilitatorPubRow(p: Row, counts: { total: number; byType: Record<string, number> }) {
  const c = parseJson<PubContent>(p.snapshot_json, { type: "entry", stageTitle: "", entries: [], synthesis: null, internal: { groupName: null, groupId: null, authors: [] } });
  const cur = sourceVersionOf(str(p.source_type), str(p.source_id));
  return {
    id: p.id, sourceType: p.source_type, sourceId: p.source_id, status: p.unpublished_at ? "unpublished" : "published", labelMode: p.label_mode, labelNo: num(p.label_no),
    present: !!num(p.present), publishedAt: num(p.published_at), updatedAt: num(p.updated_at),
    // true when the live source no longer matches what is published (edited, hidden, deleted)
    differsFromSource: !cur || cur.version !== str(p.source_version),
    internal: c.internal, preview: publicView(p), reactions: counts,
  };
}

route("GET", "/sessions/:id/publications", (ctx) => {
  const s = facilitatorSession(ctx, ctx.params.id);
  const cfg = reactionConfig(s);
  const rows = all("SELECT * FROM publications WHERE session_id=?", str(s.id));
  const sums = reactionSummary("publication", rows.map((r) => str(r.id)), null, cfg);
  const sort = str(ctx.req.query.sort || "recent");
  const items = rows.map((p) => facilitatorPubRow(p, { total: sums[str(p.id)].total, byType: sums[str(p.id)].counts }));
  const key = (i: (typeof items)[number]) => (sort.startsWith("type:") ? i.reactions.byType[sort.slice(5)] ?? 0 : sort === "reactions" ? i.reactions.total : 0);
  // Stable order: higher count first; ties (and the default) fall back to publication order, then id.
  items.sort((a, b) => (sort === "recent" ? 0 : key(b) - key(a)) || a.labelNo - b.labelNo || str(a.id).localeCompare(str(b.id)));
  return { items, reactionTypes: cfg.types.filter(() => true), note: "Reaction counts show engagement, not whether an answer is correct." };
});

route("GET", "/sessions/:id/comments", (ctx) => {
  const s = facilitatorSession(ctx, ctx.params.id);
  const status = ctx.req.query.status;
  const rows = all(`SELECT c.*, g.name AS gname FROM peer_comments c LEFT JOIN groups g ON g.id=c.author_group_id WHERE c.session_id=? ${status ? "AND c.status=?" : ""} ORDER BY c.created_at DESC LIMIT 500`, ...(status ? [str(s.id), status] : [str(s.id)]));
  return { comments: rows.map((c) => ({ id: c.id, targetType: c.target_type, targetId: c.target_id, authorId: c.author_id, authorName: c.author_name, groupName: c.gname ?? null, promptKey: c.prompt_key, body: c.body, status: c.status, createdAt: num(c.created_at) })) };
});

route("POST", "/comments/:id/moderate", (ctx) => {
  const u = requireStaff(ctx);
  const c = get("SELECT * FROM peer_comments WHERE id=?", ctx.params.id);
  if (!c) throw notFound("Comment not found");
  const s = facilitatorSession(ctx, str(c.session_id));
  mustBeEditable(s);
  const status = oneOf(obj(ctx.req.body).status, "status", ["approved", "hidden"] as const);
  run("UPDATE peer_comments SET status=?, moderated_by=?, moderated_at=? WHERE id=?", status, u.id, now(), str(c.id));
  audit("facilitator", u.id, status === "hidden" ? "comment_hidden" : "comment_approved", { sessionId: str(s.id), target: str(c.id) });
  return { ok: true };
});

/* ===================== participants: class board, reactions, comments ===================== */

function livePublication(pc: ParticipantCtx, id: string): Row {
  const p = get("SELECT * FROM publications WHERE id=? AND session_id=? AND unpublished_at IS NULL", id, str(pc.session.id));
  if (!p) throw notFound("Shared item not found");
  return p;
}

route("GET", "/board", (ctx) => {
  const pc = requireParticipant(ctx, { allowArchived: true });
  const rcfg = reactionConfig(pc.session);
  const ccfg = critiqueConfig(pc.session);
  const rows = all("SELECT * FROM publications WHERE session_id=? AND unpublished_at IS NULL ORDER BY label_no", str(pc.session.id));
  const ids = rows.map((r) => str(r.id));
  const me = str(pc.participant.id);
  const reacts = reactionSummary("publication", ids, me, rcfg);
  const modeOf = new Map(rows.map((r) => [str(r.id), r.label_mode === "anonymous"]));
  const comments = commentsFor("publication", ids, me, (tid) => modeOf.get(tid) === true);
  const classOn = (sc: string) => sc === "published" || sc === "both";
  return {
    title: pc.session.title,
    reactions: { enabled: rcfg.enabled && classOn(rcfg.scope), types: rcfg.types },
    critique: { enabled: ccfg.enabled && classOn(ccfg.scope), prompts: ccfg.prompts.filter((p) => p.enabled), requireApproval: ccfg.requireApproval },
    items: rows.map((r) => ({ ...publicView(r), reactions: reacts[str(r.id)], comments: comments[str(r.id)] })),
    // discussion questions the facilitator has revealed, text only
    questions: visibleQuestions(str(pc.session.id), revealedIds(str(pc.session.id))),
  };
});

function entryTarget(pc: ParticipantCtx, id: string): Row {
  const e = get("SELECT * FROM entries WHERE id=? AND deleted_at IS NULL AND hidden_at IS NULL", id);
  if (!e || !pc.group || e.group_id !== pc.group.id) throw notFound("Entry not found");
  stageAccess(pc, str(e.stage_id)); // the participant must be able to see this stage at all
  return e;
}

route("POST", "/reactions", (ctx) => {
  const pc = requireParticipant(ctx);
  const b = obj(ctx.req.body);
  const targetType = oneOf(b.targetType, "targetType", ["entry", "publication"] as const);
  const targetId = text(b.targetId, "targetId", { max: 60 });
  const type = text(b.type, "type", { max: 24 });
  const on = bool(b.on, "on");
  const cfg = reactionConfig(pc.session);
  if (!cfg.enabled) throw forbidden("Reactions are switched off for this session.", "reactions_off");
  if (!cfg.types.some((t) => t.key === type)) throw badRequest("That reaction is not available.");
  // Inside a group: entries of your own group. Across groups: published content only.
  if (targetType === "entry") {
    if (cfg.scope === "published") throw forbidden("Reactions are only open on shared items.", "reactions_scope");
    entryTarget(pc, targetId);
  } else {
    if (cfg.scope === "group") throw forbidden("Reactions are only open inside your group.", "reactions_scope");
    livePublication(pc, targetId);
  }
  hit(`react:${pc.participant.id}`, 200, 60_000);
  const me = str(pc.participant.id);
  // One reaction of each type per person per item: the primary key makes repeated clicks harmless.
  if (on) run("INSERT OR IGNORE INTO reactions(target_type,target_id,participant_id,type,created_at) VALUES(?,?,?,?,?)", targetType, targetId, me, type, now());
  else run("DELETE FROM reactions WHERE target_type=? AND target_id=? AND participant_id=? AND type=?", targetType, targetId, me, type);
  return { summary: reactionSummary(targetType, [targetId], me, cfg)[targetId] };
});

route("POST", "/comments", (ctx) => {
  const pc = requireParticipant(ctx);
  const b = obj(ctx.req.body);
  const targetType = oneOf(b.targetType, "targetType", ["entry", "publication"] as const);
  const targetId = text(b.targetId, "targetId", { max: 60 });
  const cfg = critiqueConfig(pc.session);
  if (!cfg.enabled) throw forbidden("Peer responses are switched off for this session.", "critique_off");
  const promptKey = text(b.promptKey, "promptKey", { max: 24 });
  if (!cfg.prompts.some((p) => p.key === promptKey && p.enabled)) throw badRequest("Choose one of the response prompts.");
  const body = text(b.body, "Your response", { max: 1000 });
  let status: "approved" | "pending" = "approved";
  if (targetType === "entry") {
    if (cfg.scope === "published") throw forbidden("Peer responses are only open on shared items.", "critique_scope");
    const e = entryTarget(pc, targetId);
    if (e.author_id === pc.participant.id) throw badRequest("Respond to a teammate's entry, not your own.");
  } else {
    if (cfg.scope === "group") throw forbidden("Peer responses are only open inside your group.", "critique_scope");
    livePublication(pc, targetId);
    // Class-published responses can wait for the facilitator's approval; the author still sees their own while it waits.
    status = cfg.requireApproval ? "pending" : "approved";
  }
  hit(`comment:${pc.participant.id}`, 30, 10 * 60_000);
  const id = newId("cmt");
  run("INSERT INTO peer_comments(id,session_id,target_type,target_id,author_id,author_name,author_group_id,prompt_key,body,status,created_at) VALUES(?,?,?,?,?,?,?,?,?,?,?)", id, str(pc.session.id), targetType, targetId, str(pc.participant.id), str(pc.participant.display_name), pc.group ? str(pc.group.id) : null, promptKey, body, status, now());
  return { id, status };
});

/** A participant can withdraw their own response. */
route("DELETE", "/comments/:id", (ctx) => {
  const pc = requireParticipant(ctx);
  const r = run("DELETE FROM peer_comments WHERE id=? AND author_id=?", ctx.params.id, str(pc.participant.id));
  if (!r.changes) throw notFound("Comment not found");
  return { ok: true };
});

/* ===================== projector view ===================== */

route("GET", "/sessions/:id/presentation", (ctx) => {
  const s = facilitatorSession(ctx, ctx.params.id);
  const st = get("SELECT * FROM presentation_state WHERE session_id=?", str(s.id));
  return {
    hasLink: !!st?.token_hash, showSummaries: !!num(st?.show_summaries),
    revealedQuestions: parseJson<string[]>(st?.revealed_questions_json, []),
  };
});

/** Creates (or replaces) the projector link. The link is shown once; replacing it switches the old one off. */
route("POST", "/sessions/:id/presentation/link", (ctx) => {
  const u = requireStaff(ctx);
  const s = facilitatorSession(ctx, ctx.params.id);
  mustBeEditable(s);
  const token = randomToken();
  run("INSERT INTO presentation_state(session_id,token_hash,updated_at) VALUES(?,?,?) ON CONFLICT(session_id) DO UPDATE SET token_hash=excluded.token_hash, updated_at=excluded.updated_at", str(s.id), sha256(token), now());
  audit("facilitator", u.id, "projector_link_created", { sessionId: str(s.id) });
  return { token, path: `/present/${token}` };
});

route("POST", "/sessions/:id/presentation/revoke", (ctx) => {
  const u = requireStaff(ctx);
  const s = facilitatorSession(ctx, ctx.params.id);
  run("UPDATE presentation_state SET token_hash=NULL, updated_at=? WHERE session_id=?", now(), str(s.id));
  audit("facilitator", u.id, "projector_link_revoked", { sessionId: str(s.id) });
  return { ok: true };
});

/** Separate controls: show group summaries; reveal each discussion question. Neither happens by itself. */
route("POST", "/sessions/:id/presentation", (ctx) => {
  const u = requireStaff(ctx);
  const s = facilitatorSession(ctx, ctx.params.id);
  mustBeEditable(s);
  const b = obj(ctx.req.body);
  const cur = get("SELECT * FROM presentation_state WHERE session_id=?", str(s.id));
  let show = !!num(cur?.show_summaries);
  if (b.showSummaries !== undefined) show = bool(b.showSummaries, "showSummaries");
  run("INSERT INTO presentation_state(session_id,show_summaries,updated_at) VALUES(?,?,?) ON CONFLICT(session_id) DO UPDATE SET show_summaries=excluded.show_summaries, updated_at=excluded.updated_at", str(s.id), show ? 1 : 0, now());
  if (b.revealQuestion !== undefined) {
    const q = obj(b.revealQuestion);
    const qid = text(q.id, "question id", { max: 80 });
    if (q.revealed === true && !questionText(str(s.id), qid)) throw badRequest("That discussion question does not exist in this session.");
    setQuestionRevealed(str(s.id), qid, q.revealed === true);
  }
  const revealed = revealedIds(str(s.id));
  audit("facilitator", u.id, "presentation_changed", { sessionId: str(s.id), detail: { showSummaries: show, revealed: revealed.length } });
  return { ok: true };
});

/**
 * The facilitator's own projector view (signed in, no link needed). Everything a room screen may show: the join code,
 * each part's state and the guiding questions the facilitator has revealed (hidden ones are counted, never sent),
 * submission progress by group, the items approved for the projector (participant-facing form), and summaries and
 * discussion questions only when they are switched on / revealed. No names, PINs or recovery data.
 */
route("GET", "/sessions/:id/projector", (ctx) => {
  const s = facilitatorSession(ctx, ctx.params.id);
  const sid = str(s.id);
  const st = get("SELECT * FROM presentation_state WHERE session_id=?", sid);
  const groups = all("SELECT g.id,g.name,(SELECT COUNT(*) FROM participants p WHERE p.group_id=g.id AND p.status='active') AS n FROM groups g WHERE g.session_id=? ORDER BY g.position", sid);
  const stages = all("SELECT * FROM stages WHERE session_id=? AND enabled=1 ORDER BY position", sid).map((stg) => {
    const qs = allQuestions(str(stg.id));
    const expected = new Set(expectedGroups(sid, str(stg.id)).map((g) => str(g.id)));
    const perGroup = groups.map((g) => {
      const state = submissionState(str(g.id), str(stg.id));
      const entries = num(get("SELECT COUNT(*) AS c FROM entries WHERE group_id=? AND stage_id=? AND deleted_at IS NULL AND hidden_at IS NULL", str(g.id), str(stg.id))!.c);
      const submittedAnswers = num(get("SELECT COUNT(*) AS c FROM entries WHERE group_id=? AND stage_id=? AND deleted_at IS NULL AND hidden_at IS NULL AND submitted_at IS NOT NULL", str(g.id), str(stg.id))!.c);
      return { groupId: str(g.id), status: state.status, entries, submittedAnswers, expected: expected.has(str(g.id)) };
    });
    return {
      id: str(stg.id), position: num(stg.position), title: str(stg.title), visible: !!num(stg.visible), availability: str(stg.availability), instructions: str(stg.instructions),
      questions: qs.filter((q) => q.visible).map((q) => ({ id: q.id, heading: q.heading, text: q.text, required: q.required, parentId: q.parentId, options: q.options })),
      hiddenQuestions: qs.filter((q) => !q.visible && !q.parentId).length,
      // Class results (counts only, no names or texts) for revealed questions with response options such as Agree / Disagree.
      tallies: stageTallies(str(stg.id), { visibleOnly: true }).map((t) => ({ questionId: t.questionId, options: t.options, other: t.other, total: t.total, pending: t.pending, byGroup: t.byGroup })),
      submitMode: str(stg.submit_mode ?? "group"), individual: individualProgress(str(stg.id)),
      expected: expected.size, submitted: perGroup.filter((x) => x.expected && x.status === "submitted").length, perGroup,
    };
  });
  const rows = all("SELECT * FROM publications WHERE session_id=? AND present=1 AND unpublished_at IS NULL AND source_type<>'ai_output' ORDER BY label_no", sid);
  const extras = presentationExtras(sid, !!num(st?.show_summaries), parseJson<string[]>(st?.revealed_questions_json, []));
  return {
    title: s.title, status: s.status, joinCode: s.join_code, joiningOpen: !!num(s.joining_open),
    participants: num(get("SELECT COUNT(*) AS c FROM participants WHERE session_id=? AND status='active'", sid)!.c),
    groups: groups.map((g) => ({ id: str(g.id), name: str(g.name), members: num(g.n) })),
    stages, items: rows.map(publicView), summaries: extras.summaries, discussionQuestions: extras.questions,
    timer: timerView(sid),
  };
});

function presentationSession(token: string): Row {
  const st = get("SELECT * FROM presentation_state WHERE token_hash=?", sha256(token));
  if (!st) throw notFound("This projector link is not valid.");
  const s = get("SELECT * FROM sessions WHERE id=?", str(st.session_id));
  if (!s) throw notFound("This projector link is not valid.");
  return { ...s, _state: st } as Row;
}

/**
 * The projector page. No login: the secret link is the key. It only ever receives items the facilitator approved for the
 * projector, in their participant-facing form (so anonymous items carry no names), plus summaries and questions only after
 * the facilitator turns those on. Nothing private is sent and hidden by CSS.
 */
route("GET", "/present/:token", (ctx) => {
  const s = presentationSession(ctx.params.token);
  const st = s._state as Row;
  const rows = all("SELECT * FROM publications WHERE session_id=? AND present=1 AND unpublished_at IS NULL AND source_type<>'ai_output' ORDER BY label_no", str(s.id));
  const extras = presentationExtras(str(s.id), !!num(st.show_summaries), parseJson<string[]>(st.revealed_questions_json, []));
  return { title: s.title, items: rows.map(publicView), summaries: extras.summaries, questions: extras.questions, timer: timerView(str(s.id)) };
});

route("GET", "/present/:token/attachments/:id", (ctx) => {
  const s = presentationSession(ctx.params.token);
  const live = all("SELECT attachment_ids_json FROM publications WHERE session_id=? AND present=1 AND unpublished_at IS NULL", str(s.id));
  if (!live.some((r) => parseJson<string[]>(r.attachment_ids_json, []).includes(ctx.params.id))) throw notFound("File not found");
  const att = get("SELECT * FROM attachments WHERE id=? AND deleted_at IS NULL", ctx.params.id);
  if (!att) throw notFound("File not found");
  return servePublished(ctx, att);
});

import { readStored } from "../files";
import { presentationExtras, questionText, setQuestionRevealed, revealedIds, visibleQuestions } from "../presentation";

/** Files shared with the class or projector are served with a generic name, so the original filename cannot identify anyone. */
export function servePublished(ctx: Ctx, att: Row) {
  const data = readStored(str(att.stored_name));
  if (!data) throw notFound("File not found");
  const ext = str(att.mime) === "image/png" ? "png" : "jpg";
  ctx.headersOut["content-type"] = str(att.mime);
  ctx.headersOut["content-disposition"] = `inline; filename="image.${ext}"`;
  ctx.headersOut["x-content-type-options"] = "nosniff";
  ctx.headersOut["content-security-policy"] = "default-src 'none'; sandbox";
  ctx.headersOut["cache-control"] = "private, no-store";
  ctx.rawOut = data;
  return undefined;
}
