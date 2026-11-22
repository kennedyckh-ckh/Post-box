import { all, get, run, tx, now, num, str, audit } from "../db";
import { newId } from "../crypto";
import { route, badRequest, conflict, forbidden, notFound, HttpError } from "../router";
import { requireStaff, requireParticipant, facilitatorSession, groupForFacilitator, mustBeEditable } from "../authz";
import { stageAccess } from "../stages";
import { submissionState, buildSnapshot, missingRequired, expectedGroups, type SubState } from "../submissions";
import { obj, text, bool } from "../validate";
import { parseJson } from "../content";

const PRESENCE_WINDOW_MS = 20_000;

function subView(s: SubState) {
  return { status: s.status, revision: s.revision, submittedAt: s.submittedAt, submittedByName: s.submittedByName };
}

function whoCanSubmit(session: Record<string, unknown>, group: Record<string, unknown>, participantId: string): { ok: boolean; why: string | null } {
  if (session.submit_policy === "representative" && group.representative_id !== participantId) return { ok: false, why: "Only your group's nominated representative can submit. Ask your facilitator who that is." };
  return { ok: true, why: null };
}

/** Heartbeat from a member who has the editor open, so a submit can warn about connected members' unsaved edits. */
route("POST", "/stages/:sid/presence", (ctx) => {
  const pc = requireParticipant(ctx);
  stageAccess(pc, ctx.params.sid);
  const editing = bool(obj(ctx.req.body).editing, "editing");
  run("INSERT INTO presence(participant_id,stage_id,editing,last_beat) VALUES(?,?,?,?) ON CONFLICT(participant_id) DO UPDATE SET stage_id=excluded.stage_id, editing=excluded.editing, last_beat=excluded.last_beat", str(pc.participant.id), ctx.params.sid, editing ? 1 : 0, now());
  return { ok: true };
});

/** What the confirmation screen needs before a group submits. */
route("GET", "/stages/:sid/submission", (ctx) => {
  const pc = requireParticipant(ctx, { allowArchived: true });
  const a = stageAccess(pc, ctx.params.sid);
  const gid = str(pc.group!.id);
  const state = submissionState(gid, ctx.params.sid);
  const who = whoCanSubmit(pc.session, pc.group!, str(pc.participant.id));
  const editingNow = all(
    "SELECT p.display_name FROM presence pr JOIN participants p ON p.id=pr.participant_id WHERE p.group_id=? AND p.status='active' AND pr.stage_id=? AND pr.editing=1 AND pr.last_beat>? AND pr.participant_id<>?",
    gid, ctx.params.sid, now() - PRESENCE_WINDOW_MS, str(pc.participant.id)
  ).map((r) => str(r.display_name));
  const canSubmit = a.canWrite && who.ok;
  return {
    submission: subView(state),
    missingRequired: missingRequired(gid, ctx.params.sid),
    // Only members who currently have the page open are detectable. Work typed on a device that is offline cannot be seen from here.
    editingNow,
    canSubmit,
    whyNot: !a.canWrite ? a.blocked?.message ?? null : who.why,
  };
});

/**
 * Submit the group's work for one stage. Atomic: the snapshot is read inside the same write transaction that records it,
 * so every entry the server has acknowledged as saved is in it, and nothing can sneak in afterwards.
 */
route("POST", "/stages/:sid/submit", (ctx) => {
  const pc = requireParticipant(ctx);
  const a = stageAccess(pc, ctx.params.sid);
  const b = obj(ctx.req.body);
  if (b.confirm !== true) throw badRequest("Please confirm that you want to submit. Submitting locks this part for your group.", "confirmation_required");
  const key = b.requestKey === undefined ? null : text(b.requestKey, "requestKey", { max: 64 });
  const gid = str(pc.group!.id);
  const pid = str(pc.participant.id);

  return tx(() => {
    // A retry or double click with the same key returns the version that was already created.
    if (key) {
      const dup = get("SELECT * FROM submissions WHERE group_id=? AND stage_id=? AND request_key=?", gid, ctx.params.sid, key);
      if (dup) return { submission: subView(submissionState(gid, ctx.params.sid)), duplicate: true };
    }
    const state = submissionState(gid, ctx.params.sid);
    if (state.status === "submitted") throw conflict("Your group has already submitted this part.", "already_submitted");
    const fresh = stageAccess(requireParticipant(ctx), ctx.params.sid); // re-check inside the lock
    if (!fresh.canWrite) throw forbidden(fresh.blocked?.message ?? "This part cannot be submitted now.", fresh.blocked?.code ?? "blocked");
    void a;
    const who = whoCanSubmit(pc.session, pc.group!, pid);
    if (!who.ok) throw forbidden(who.why!, "not_representative");
    const missing = missingRequired(gid, ctx.params.sid);
    if (missing.length) throw new HttpError(422, "missing_required", "Some required questions have no response yet.", { missing });
    const snap = buildSnapshot(gid, ctx.params.sid, now());
    const id = newId("sub");
    const revision = state.revision + 1;
    run("INSERT INTO submissions(id,session_id,group_id,stage_id,revision,submitted_by,submitted_by_name,submitted_at,snapshot_json,request_key) VALUES(?,?,?,?,?,?,?,?,?,?)", id, str(pc.session.id), gid, ctx.params.sid, revision, pid, str(pc.participant.display_name), now(), JSON.stringify(snap), key);
    audit("participant", pid, "group_submitted", { sessionId: str(pc.session.id), target: id, detail: { groupId: gid, stageId: ctx.params.sid, revision, entries: snap.entries.length } });
    return { submission: subView(submissionState(gid, ctx.params.sid)), duplicate: false };
  });
});

/* ---------- facilitator ---------- */

/** Progress matrix: every group by every stage, and the submitted-of-expected counts. */
route("GET", "/sessions/:id/overview", (ctx) => {
  const s = facilitatorSession(ctx, ctx.params.id);
  const sid = str(s.id);
  const stages = all("SELECT * FROM stages WHERE session_id=? ORDER BY position", sid);
  const groups = all("SELECT g.id,g.name,(SELECT COUNT(*) FROM participants p WHERE p.group_id=g.id AND p.status='active') AS n FROM groups g WHERE g.session_id=? ORDER BY g.position", sid);
  const cells: unknown[] = [];
  const perStage = stages.map((st) => {
    const expected = expectedGroups(sid, str(st.id));
    const expectedIds = new Set(expected.map((g) => str(g.id)));
    let submitted = 0;
    for (const g of groups) {
      const state = submissionState(str(g.id), str(st.id));
      const excluded = !!num(get("SELECT excluded FROM group_stage_settings WHERE group_id=? AND stage_id=?", str(g.id), str(st.id))?.excluded);
      const entryCount = num(get("SELECT COUNT(*) AS c FROM entries WHERE group_id=? AND stage_id=? AND deleted_at IS NULL", str(g.id), str(st.id))!.c);
      if (state.status === "submitted" && expectedIds.has(str(g.id))) submitted++;
      cells.push({ groupId: g.id, stageId: st.id, ...subView(state), entryCount, excluded, empty: num(g.n) === 0, expected: expectedIds.has(str(g.id)) });
    }
    return { id: st.id, title: st.title, position: num(st.position), enabled: !!num(st.enabled), availability: st.availability, expected: expected.length, submitted, missing: expected.filter((g) => submissionState(str(g.id), str(st.id)).status !== "submitted").map((g) => ({ id: g.id, name: g.name })) };
  });
  return { groups: groups.map((g) => ({ id: g.id, name: g.name, members: num(g.n) })), stages: perStage, cells };
});

/** Reopen ONE group's submission for ONE stage. Other groups, other stages and earlier versions are untouched. */
route("POST", "/groups/:gid/stages/:sid/reopen", (ctx) => {
  const u = requireStaff(ctx);
  const { group, session } = groupForFacilitator(ctx, ctx.params.gid);
  mustBeEditable(session);
  const stage = get("SELECT id,title FROM stages WHERE id=? AND session_id=?", ctx.params.sid, str(session.id));
  if (!stage) throw notFound("Part not found");
  const note = text(obj(ctx.req.body).note, "Note", { max: 300, optional: true });
  tx(() => {
    const state = submissionState(str(group.id), str(stage.id));
    if (state.status !== "submitted") throw conflict(state.status === "reopened" ? "This group's work is already reopened." : "This group has not submitted this part.", "not_submitted");
    run("UPDATE submissions SET reopened_at=?, reopened_by=?, reopen_note=? WHERE id=?", now(), u.id, note || null, state.submissionId!);
    audit("facilitator", u.id, "submission_reopened", { sessionId: str(session.id), target: state.submissionId!, detail: { groupId: group.id, stageId: stage.id, revision: state.revision, note } });
  });
  return { ok: true };
});

/** Every submitted version for the session (newest first), so the facilitator can see the version history. */
route("GET", "/sessions/:id/submissions", (ctx) => {
  const s = facilitatorSession(ctx, ctx.params.id);
  const where = ["session_id=?"];
  const args: unknown[] = [str(s.id)];
  if (ctx.req.query.groupId) { where.push("group_id=?"); args.push(ctx.req.query.groupId); }
  if (ctx.req.query.stageId) { where.push("stage_id=?"); args.push(ctx.req.query.stageId); }
  const rows = all(`SELECT * FROM submissions WHERE ${where.join(" AND ")} ORDER BY submitted_at DESC`, ...args);
  return {
    submissions: rows.map((r) => ({
      id: r.id, groupId: r.group_id, stageId: r.stage_id, revision: num(r.revision), submittedBy: r.submitted_by_name, submittedAt: num(r.submitted_at),
      reopenedAt: r.reopened_at ? num(r.reopened_at) : null, reopenNote: r.reopen_note ?? null, snapshot: parseJson(r.snapshot_json, null),
    })),
  };
});
