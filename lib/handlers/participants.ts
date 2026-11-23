import { all, get, run, tx, now, num, str, audit } from "../db";
import { newId, randomCode, sha256, encryptText, decryptText } from "../crypto";
import { route, badRequest, conflict, notFound, forbidden, type Ctx } from "../router";
import { requireStaff, facilitatorSession, participantForFacilitator, requireParticipant, mustBeEditable } from "../authz";
import { revokeParticipantSessions, startParticipantSession, endSession, PART_COOKIE } from "../auth";
import { hit, blocked, fail, clear } from "../throttle";
import { verifySecret } from "../crypto";
import { obj, text, bool, LIMITS } from "../validate";
import { parseFields } from "./sessions";
import { stageStates } from "../stages";

export function newRecoveryCode(): string {
  return [randomCode(4), randomCode(4), randomCode(4), randomCode(4)].join("-");
}
export const normaliseCode = (s: string) => s.toUpperCase().replace(/[^A-Z0-9]/g, "");
const lookupOf = (code: string) => sha256(`recovery:${normaliseCode(code)}`);

/* ---------- public: what a would-be participant may see ---------- */

route("GET", "/public/session", (ctx) => {
  hit(`lookup:${ctx.ip}`, 60, 10 * 60_000);
  const code = normaliseCode(String(ctx.req.query.code || ""));
  const s = code ? get("SELECT * FROM sessions WHERE join_code=?", code) : undefined;
  if (!s || s.status === "archived") throw notFound("That join code was not found.");
  const joinable = !!num(s.joining_open) && (s.status === "live" || !!num(s.early_join));
  const groups = all(
    "SELECT g.id,g.name,g.pin_hash,g.seat_cap,(SELECT COUNT(*) FROM participants p WHERE p.group_id=g.id AND p.status='active') AS n FROM groups g WHERE g.session_id=? ORDER BY g.position",
    String(s.id)
  );
  return {
    title: s.title,
    joinable,
    reason: joinable ? null : !num(s.joining_open) ? "joining_closed" : "not_started",
    groupJoinMode: s.group_join_mode,
    fields: parseFields(s.participant_fields_json),
    // Only what a joiner needs. Never the PIN, never member names.
    groups: s.group_join_mode === "choose" ? groups.map((g) => ({ id: g.id, name: g.name, hasPin: !!g.pin_hash, full: g.seat_cap !== null && num(g.n) >= num(g.seat_cap), seatsLeft: g.seat_cap === null ? null : Math.max(0, num(g.seat_cap) - num(g.n)) })) : [],
  };
});

/* ---------- join and recover ---------- */

route("POST", "/join", (ctx) => {
  const b = obj(ctx.req.body);
  hit(`join:${ctx.ip}`, 40, 10 * 60_000);
  const code = normaliseCode(text(b.joinCode, "Join code", { max: 20 }));
  const name = text(b.displayName, "Your name", { max: LIMITS.name });
  const s = get("SELECT * FROM sessions WHERE join_code=?", code);
  if (!s || s.status === "archived") throw notFound("That join code was not found.");
  if (!num(s.joining_open)) throw forbidden("Joining is closed for this session. Ask your facilitator.", "joining_closed");
  if (s.status !== "live" && !num(s.early_join)) throw forbidden("This session has not started yet.", "not_started");

  // Optional facilitator-configured fields (for example Class, Class Number). Unknown keys are dropped.
  const extraIn = obj(b.extra);
  const extra: Record<string, string> = {};
  for (const f of parseFields(s.participant_fields_json)) {
    const v = text(extraIn[f.key], f.label, { max: LIMITS.fieldValue, optional: true });
    if (!v && f.required) throw badRequest(`${f.label} is required.`);
    if (v) extra[f.key] = v;
  }

  let groupId: string | null = null;
  if (s.group_join_mode === "choose") {
    const gid = text(b.groupId, "Group", { max: 60 });
    const g = get("SELECT * FROM groups WHERE id=? AND session_id=?", gid, String(s.id));
    if (!g) throw badRequest("Choose one of the listed groups.");
    if (g.pin_hash) {
      // PIN attempts are throttled per group and client; scrypt makes each guess slow.
      const key = `pin:${g.id}:${ctx.ip}`;
      blocked(key);
      if (!verifySecret(str(b.pin), String(g.pin_hash))) {
        fail(key, 5, 10 * 60_000, 5 * 60_000);
        throw forbidden("That group PIN is not correct.", "wrong_pin");
      }
      clear(key);
    }
    groupId = String(g.id);
  }

  const id = newId("par");
  const recovery = newRecoveryCode();
  tx(() => {
    // Seat cap is checked and the row inserted inside one write transaction, so simultaneous joins cannot overfill a group.
    if (groupId) {
      const g = get("SELECT seat_cap FROM groups WHERE id=?", groupId)!;
      const used = num(get("SELECT COUNT(*) AS c FROM participants WHERE group_id=? AND status='active'", groupId)!.c);
      if (g.seat_cap !== null && used >= num(g.seat_cap)) throw conflict("That group is full. Please choose another group.", "group_full");
    }
    const fresh = get("SELECT status, joining_open FROM sessions WHERE id=?", String(s.id))!;
    if (fresh.status === "archived" || !num(fresh.joining_open)) throw forbidden("Joining is closed for this session.", "joining_closed");
    run("INSERT INTO participants(id,session_id,group_id,display_name,extra_json,recovery_lookup,recovery_enc,last_seen,created_at) VALUES(?,?,?,?,?,?,?,?,?)", id, String(s.id), groupId, name, JSON.stringify(extra), lookupOf(recovery), encryptText(recovery), now(), now());
    audit("participant", id, "joined", { sessionId: String(s.id), target: groupId ?? undefined });
  });
  startParticipantSession(ctx, id);
  // The recovery code is NOT shown at joining. The participant looks it up later, from this signed-in device, with
  // GET /me/recovery-code. A hash (for signing in) and an encrypted copy (for showing it again) are stored.
  return { participantId: id };
});

route("POST", "/recover", (ctx) => {
  hit(`recover:${ctx.ip}`, 20, 10 * 60_000);
  const code = text(obj(ctx.req.body).recoveryCode, "Recovery code", { max: 40 });
  const p = get("SELECT * FROM participants WHERE recovery_lookup=?", lookupOf(code));
  if (!p) throw forbidden("That recovery code did not work. Check it and try again, or ask your facilitator for a new one.", "bad_recovery_code");
  if (p.status !== "active") throw forbidden("Your access to this session was removed by the facilitator.", "access_removed");
  const s = get("SELECT status FROM sessions WHERE id=?", String(p.session_id))!;
  if (s.status === "archived") throw forbidden("This session has been archived.", "session_archived");
  startParticipantSession(ctx, String(p.id));
  audit("participant", String(p.id), "recovered_session", { sessionId: String(p.session_id) });
  return { participantId: p.id };
});

route("POST", "/leave", (ctx) => {
  endSession(ctx, PART_COOKIE);
  return { ok: true };
});

/* ---------- the signed-in participant ---------- */

route("GET", "/me", (ctx) => {
  const { participant, session, group } = requireParticipant(ctx, { allowArchived: true });
  const stages = stageStates(String(session.id), group ? String(group.id) : null);
  const fields = parseFields(session.participant_fields_json);
  const extra = JSON.parse(str(participant.extra_json)) as Record<string, string>;
  return {
    participant: { id: participant.id, displayName: participant.display_name, extra: fields.filter((f) => extra[f.key]).map((f) => ({ label: f.label, value: extra[f.key] })) },
    session: { title: session.title, status: session.status, archived: session.status === "archived" },
    group: group ? { id: group.id, name: group.name } : null,
    awaitingGroup: !group,
    // Titles and the state this group sees (a per-group override wins). Instructions and questions come from /stages/:id, which refuses locked parts.
    stages,
  };
});

/**
 * A signed-in participant can look up their own recovery code at any time. Only their own device's session can do
 * this; the code is never sent to facilitators or anyone else. Participants who joined before codes were stored in a
 * readable form get `recoveryCode: null` and can make a new one below.
 */
route("GET", "/me/recovery-code", (ctx) => {
  const { participant } = requireParticipant(ctx, { allowArchived: true });
  hit(`recovery-view:${String(participant.id)}`, 30, 10 * 60_000);
  const code = decryptText(participant.recovery_enc as string | null);
  if (code) audit("participant", String(participant.id), "recovery_code_viewed", { sessionId: String(participant.session_id) });
  return { recoveryCode: code };
});

/** A signed-in participant can replace their own recovery code (the old one stops working). */
route("POST", "/me/recovery-code", (ctx) => {
  const { participant } = requireParticipant(ctx);
  const code = newRecoveryCode();
  run("UPDATE participants SET recovery_lookup=?, recovery_enc=? WHERE id=?", lookupOf(code), encryptText(code), String(participant.id));
  audit("participant", String(participant.id), "recovery_code_replaced", { sessionId: String(participant.session_id) });
  return { recoveryCode: code };
});

/* ---------- facilitator: members ---------- */

route("GET", "/sessions/:id/participants", (ctx) => {
  const s = facilitatorSession(ctx, ctx.params.id);
  const fields = parseFields(s.participant_fields_json);
  const rows = all("SELECT * FROM participants WHERE session_id=? ORDER BY created_at", String(s.id));
  return {
    // No recovery data of any kind is ever returned.
    participants: rows.map((p) => {
      const extra = JSON.parse(str(p.extra_json)) as Record<string, string>;
      return { id: p.id, displayName: p.display_name, groupId: p.group_id ?? null, status: p.status, fields: fields.map((f) => ({ label: f.label, value: extra[f.key] ?? "" })), lastSeen: p.last_seen, joinedAt: p.created_at };
    }),
  };
});

function seatsFree(groupId: string): boolean {
  const g = get("SELECT seat_cap FROM groups WHERE id=?", groupId)!;
  const used = num(get("SELECT COUNT(*) AS c FROM participants WHERE group_id=? AND status='active'", groupId)!.c);
  return g.seat_cap === null || used < num(g.seat_cap);
}

/** Moves membership only. Contributions already written stay with the group and stage they were written in. */
route("POST", "/participants/:pid/move", (ctx) => {
  const u = requireStaff(ctx);
  const { participant, session } = participantForFacilitator(ctx, ctx.params.pid);
  mustBeEditable(session);
  if (participant.status !== "active") throw conflict("Restore this participant before moving them.", "not_active");
  const b = obj(ctx.req.body);
  const to = b.groupId === null ? null : text(b.groupId, "Group", { max: 60 });
  const overrideCap = b.overrideCap === true;
  tx(() => {
    if (to) {
      const g = get("SELECT id FROM groups WHERE id=? AND session_id=?", to, String(session.id));
      if (!g) throw badRequest("That group is not part of this session.");
      if (to !== participant.group_id && !overrideCap && !seatsFree(to)) throw conflict("That group is full. Raise its seat cap, or confirm to override.", "group_full");
    }
    const from = participant.group_id ? String(participant.group_id) : null;
    run("UPDATE participants SET group_id=? WHERE id=?", to, String(participant.id));
    if (from) run("UPDATE groups SET representative_id=NULL WHERE id=? AND representative_id=?", from, String(participant.id));
    run("INSERT INTO group_moves(id,participant_id,from_group_id,to_group_id,moved_by,at) VALUES(?,?,?,?,?,?)", newId("mov"), String(participant.id), from, to, u.id, now());
    audit("facilitator", u.id, "participant_moved", { sessionId: String(session.id), target: String(participant.id), detail: { from, to, overrideCap } });
  });
  return { ok: true };
});

route("POST", "/participants/:pid/remove", (ctx) => {
  const u = requireStaff(ctx);
  const { participant, session } = participantForFacilitator(ctx, ctx.params.pid);
  mustBeEditable(session);
  tx(() => {
    // Status change only: the row, and everything attributed to it, stays. Their seat is released.
    run("UPDATE participants SET status='removed', removed_at=? WHERE id=?", now(), String(participant.id));
    if (participant.group_id) run("UPDATE groups SET representative_id=NULL WHERE id=? AND representative_id=?", String(participant.group_id), String(participant.id));
    revokeParticipantSessions(String(participant.id));
    audit("facilitator", u.id, "participant_removed", { sessionId: String(session.id), target: String(participant.id) });
  });
  return { ok: true };
});

route("POST", "/participants/:pid/restore", (ctx) => {
  const u = requireStaff(ctx);
  const { participant, session } = participantForFacilitator(ctx, ctx.params.pid);
  mustBeEditable(session);
  if (participant.status === "active") throw conflict("This participant is already active.", "already_active");
  const overrideCap = obj(ctx.req.body).overrideCap === true;
  tx(() => {
    if (participant.group_id && !overrideCap && !seatsFree(String(participant.group_id))) throw conflict("Their group is full. Raise its seat cap, or confirm to override.", "group_full");
    run("UPDATE participants SET status='active', removed_at=NULL WHERE id=?", String(participant.id));
    audit("facilitator", u.id, "participant_restored", { sessionId: String(session.id), target: String(participant.id) });
  });
  return { ok: true };
});

/** Facilitator-assisted recovery: a new private code, shown once. The old code stops working. */
route("POST", "/participants/:pid/recovery-code", (ctx) => {
  const u = requireStaff(ctx);
  const { participant, session } = participantForFacilitator(ctx, ctx.params.pid);
  mustBeEditable(session);
  const revoke = obj(ctx.req.body).revokeDevices !== false;
  const code = newRecoveryCode();
  tx(() => {
    run("UPDATE participants SET recovery_lookup=?, recovery_enc=? WHERE id=?", lookupOf(code), encryptText(code), String(participant.id));
    if (revoke) revokeParticipantSessions(String(participant.id));
    audit("facilitator", u.id, "recovery_code_issued", { sessionId: String(session.id), target: String(participant.id), detail: { revokedDevices: revoke } });
  });
  return { recoveryCode: code };
});

void bool;
void (null as unknown as Ctx);
