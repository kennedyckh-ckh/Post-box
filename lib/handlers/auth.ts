import { get, run, now, audit } from "../db";
import { hashSecret, verifySecret } from "../crypto";
import { route, badRequest, unauthenticated, forbidden } from "../router";
import { startStaffSession, endSession, staffFrom, revokeUserSessions, STAFF_COOKIE } from "../auth";
import { requireStaff } from "../authz";
import { blocked, fail, clear, hit } from "../throttle";
import { obj, text, emailAddr, LIMITS } from "../validate";

// A real-looking hash, verified when the email is unknown so that response time does not reveal which emails exist.
const DUMMY_HASH = hashSecret("not-a-real-password");

route("POST", "/auth/login", (ctx) => {
  const b = obj(ctx.req.body);
  const email = emailAddr(b.email);
  const password = text(b.password, "Password", { max: 200 });
  hit(`login:ip:${ctx.ip}`, 40, 10 * 60_000);
  blocked(`login:${email}`);
  const u = get("SELECT * FROM users WHERE email=?", email);
  const ok = verifySecret(password, u ? String(u.password_hash) : DUMMY_HASH) && !!u && !u.disabled_at;
  if (!ok || !u) {
    fail(`login:${email}`, 5, 10 * 60_000, 5 * 60_000);
    throw unauthenticated("Email or password is not correct.");
  }
  clear(`login:${email}`);
  startStaffSession(ctx, String(u.id));
  audit("facilitator", String(u.id), "login");
  return { user: { id: u.id, name: u.name, email: u.email, isAdmin: !!u.is_admin, mustChangePassword: !!u.must_change_password } };
});

route("POST", "/auth/logout", (ctx) => {
  endSession(ctx, STAFF_COOKIE);
  return { ok: true };
});

route("GET", "/auth/me", (ctx) => {
  const u = staffFrom(ctx);
  if (!u) throw unauthenticated();
  return { user: u };
});

route("POST", "/auth/change-password", (ctx) => {
  const u = requireStaff(ctx, { allowMustChange: true });
  const b = obj(ctx.req.body);
  const current = text(b.currentPassword, "Current password", { max: 200 });
  const next = text(b.newPassword, "New password", { max: 200 });
  if ([...next].length < LIMITS.passwordMin) throw badRequest(`The new password must be at least ${LIMITS.passwordMin} characters.`);
  if (next === current) throw badRequest("Choose a password different from the current one.");
  blocked(`pw:${u.id}`);
  const row = get("SELECT password_hash FROM users WHERE id=?", u.id)!;
  if (!verifySecret(current, String(row.password_hash))) {
    fail(`pw:${u.id}`, 5, 10 * 60_000, 5 * 60_000);
    throw forbidden("The current password is not correct.", "wrong_password");
  }
  clear(`pw:${u.id}`);
  run("UPDATE users SET password_hash=?, must_change_password=0 WHERE id=?", hashSecret(next), u.id);
  revokeUserSessions(u.id);
  startStaffSession(ctx, u.id);
  audit("facilitator", u.id, "password_changed");
  void now;
  return { ok: true };
});
