import { get, run, now, num, type Row } from "./db";
import { staffFrom, participantIdFrom, type StaffUser } from "./auth";
import { forbidden, notFound, unauthenticated, type Ctx } from "./router";

export function requireStaff(ctx: Ctx, opts: { allowMustChange?: boolean } = {}): StaffUser {
  const u = staffFrom(ctx);
  if (!u) throw unauthenticated();
  if (u.mustChangePassword && !opts.allowMustChange) throw forbidden("Please choose a new password first.", "must_change_password");
  return u;
}

export function requireAdmin(ctx: Ctx): StaffUser {
  const u = requireStaff(ctx);
  if (!u.isAdmin) throw forbidden("Administrator account required.", "admin_required");
  return u;
}

/**
 * The session, only if the signed-in facilitator owns it or was explicitly added to it.
 * Anything else answers 404 so session ids do not leak. Administrators get no automatic access.
 */
export function facilitatorSession(ctx: Ctx, sessionId: string, opts: { owner?: boolean } = {}): Row {
  const u = requireStaff(ctx);
  const s = get(
    "SELECT s.*, f.role AS my_role FROM sessions s JOIN session_facilitators f ON f.session_id=s.id AND f.user_id=? WHERE s.id=?",
    u.id,
    sessionId
  );
  if (!s) throw notFound("Session not found");
  if (opts.owner && s.my_role !== "owner") throw forbidden("Only the session owner can do this.", "owner_required");
  return s;
}

export function mustBeEditable(session: Row) {
  if (session.status === "archived") throw forbidden("This session is archived. Restore it to make changes.", "session_archived");
}

export function groupForFacilitator(ctx: Ctx, groupId: string): { group: Row; session: Row } {
  const group = get("SELECT * FROM groups WHERE id=?", groupId);
  if (!group) throw notFound("Group not found");
  const session = facilitatorSession(ctx, String(group.session_id));
  return { group, session };
}

export function participantForFacilitator(ctx: Ctx, participantId: string): { participant: Row; session: Row } {
  const participant = get("SELECT * FROM participants WHERE id=?", participantId);
  if (!participant) throw notFound("Participant not found");
  const session = facilitatorSession(ctx, String(participant.session_id));
  return { participant, session };
}

export interface ParticipantCtx {
  participant: Row;
  session: Row;
  group: Row | null;
}

/** Signed-in participant. Removed participants and archived sessions are refused here, once, for every route. */
export function requireParticipant(ctx: Ctx, opts: { allowArchived?: boolean } = {}): ParticipantCtx {
  const pid = participantIdFrom(ctx);
  if (!pid) throw unauthenticated("Please join your session again, or use your recovery code.");
  const participant = get("SELECT * FROM participants WHERE id=?", pid);
  if (!participant) throw unauthenticated("Please join your session again.");
  if (participant.status !== "active") throw forbidden("Your access to this session was removed by the facilitator.", "access_removed");
  const session = get("SELECT * FROM sessions WHERE id=?", String(participant.session_id))!;
  if (!opts.allowArchived && session.status === "archived") throw forbidden("This session has been archived and is read-only.", "session_archived");
  const group = participant.group_id ? get("SELECT * FROM groups WHERE id=?", String(participant.group_id)) ?? null : null;
  if (now() - num(participant.last_seen) > 20000) run("UPDATE participants SET last_seen=? WHERE id=?", now(), pid);
  return { participant, session, group };
}
