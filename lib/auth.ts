import { get, run, now, num, type Row } from "./db";
import { randomToken, sha256 } from "./crypto";
import { cookie, type Ctx } from "./router";

export const STAFF_COOKIE = "gw_staff";
export const PART_COOKIE = "gw_part";
const STAFF_TTL_SEC = 12 * 3600;
const PART_TTL_SEC = 30 * 24 * 3600;

export interface StaffUser {
  id: string;
  email: string;
  name: string;
  isAdmin: boolean;
  mustChangePassword: boolean;
}

export function startStaffSession(ctx: Ctx, userId: string) {
  const token = randomToken();
  run("INSERT INTO auth_sessions(token_hash,kind,user_id,created_at,expires_at) VALUES(?,?,?,?,?)", sha256(token), "staff", userId, now(), now() + STAFF_TTL_SEC * 1000);
  ctx.cookiesOut.push(cookie(STAFF_COOKIE, token, STAFF_TTL_SEC));
}

export function startParticipantSession(ctx: Ctx, participantId: string) {
  const token = randomToken();
  run("INSERT INTO auth_sessions(token_hash,kind,participant_id,created_at,expires_at) VALUES(?,?,?,?,?)", sha256(token), "participant", participantId, now(), now() + PART_TTL_SEC * 1000);
  ctx.cookiesOut.push(cookie(PART_COOKIE, token, PART_TTL_SEC));
}

export function endSession(ctx: Ctx, name: string) {
  const token = ctx.req.cookies[name];
  if (token) run("UPDATE auth_sessions SET revoked_at=? WHERE token_hash=? AND revoked_at IS NULL", now(), sha256(token));
  ctx.cookiesOut.push(cookie(name, "", 0));
}

export const revokeUserSessions = (userId: string) => run("UPDATE auth_sessions SET revoked_at=? WHERE user_id=? AND revoked_at IS NULL", now(), userId);
export const revokeParticipantSessions = (participantId: string) => run("UPDATE auth_sessions SET revoked_at=? WHERE participant_id=? AND revoked_at IS NULL", now(), participantId);

function liveToken(ctx: Ctx, name: string, kind: "staff" | "participant"): Row | undefined {
  const token = ctx.req.cookies[name];
  if (!token) return undefined;
  return get("SELECT * FROM auth_sessions WHERE token_hash=? AND kind=? AND revoked_at IS NULL AND expires_at>?", sha256(token), kind, now());
}

export function staffFrom(ctx: Ctx): StaffUser | null {
  if ("staff" in ctx.cache) return ctx.cache.staff as StaffUser | null;
  let out: StaffUser | null = null;
  const t = liveToken(ctx, STAFF_COOKIE, "staff");
  if (t) {
    const u = get("SELECT * FROM users WHERE id=? AND disabled_at IS NULL", String(t.user_id));
    if (u) out = { id: String(u.id), email: String(u.email), name: String(u.name), isAdmin: !!num(u.is_admin), mustChangePassword: !!num(u.must_change_password) };
  }
  ctx.cache.staff = out;
  return out;
}

export function participantIdFrom(ctx: Ctx): string | null {
  const t = liveToken(ctx, PART_COOKIE, "participant");
  return t ? String(t.participant_id) : null;
}
