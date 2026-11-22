import { all, get, run, now, audit } from "../db";
import { newId, hashSecret, randomCode } from "../crypto";
import { route, notFound, conflict, badRequest } from "../router";
import { requireAdmin } from "../authz";
import { revokeUserSessions } from "../auth";
import { obj, text, emailAddr, bool } from "../validate";

/** Facilitator accounts are created by an administrator; there is no open sign-up. */
const tempPassword = () => `${randomCode(4)}-${randomCode(4)}-${randomCode(4)}`.toLowerCase();

route("GET", "/admin/users", (ctx) => {
  requireAdmin(ctx);
  return {
    users: all("SELECT id,email,name,is_admin,must_change_password,disabled_at,created_at FROM users ORDER BY created_at").map((u) => ({
      id: u.id, email: u.email, name: u.name, isAdmin: !!u.is_admin, mustChangePassword: !!u.must_change_password, disabled: !!u.disabled_at, createdAt: u.created_at,
    })),
  };
});

route("POST", "/admin/users", (ctx) => {
  const admin = requireAdmin(ctx);
  const b = obj(ctx.req.body);
  const email = emailAddr(b.email);
  const name = text(b.name, "Name", { max: 80 });
  if (get("SELECT 1 AS x FROM users WHERE email=?", email)) throw conflict("An account with that email already exists.", "email_taken");
  const id = newId("usr");
  const pw = tempPassword();
  run("INSERT INTO users(id,email,name,password_hash,is_admin,must_change_password,created_at) VALUES(?,?,?,?,0,1,?)", id, email, name, hashSecret(pw), now());
  audit("admin", admin.id, "facilitator_created", { target: id });
  // The temporary password is shown once and is not stored in readable form.
  return { user: { id, email, name }, temporaryPassword: pw };
});

route("POST", "/admin/users/:id/reset-password", (ctx) => {
  const admin = requireAdmin(ctx);
  const u = get("SELECT id FROM users WHERE id=?", ctx.params.id);
  if (!u) throw notFound("User not found");
  const pw = tempPassword();
  run("UPDATE users SET password_hash=?, must_change_password=1 WHERE id=?", hashSecret(pw), ctx.params.id);
  revokeUserSessions(ctx.params.id);
  audit("admin", admin.id, "password_reset", { target: ctx.params.id });
  return { temporaryPassword: pw };
});

route("POST", "/admin/users/:id/disabled", (ctx) => {
  const admin = requireAdmin(ctx);
  const b = obj(ctx.req.body);
  const disabled = bool(b.disabled, "disabled");
  if (ctx.params.id === admin.id) throw badRequest("You cannot disable your own account.");
  const r = run("UPDATE users SET disabled_at=? WHERE id=?", disabled ? now() : null, ctx.params.id);
  if (!r.changes) throw notFound("User not found");
  if (disabled) revokeUserSessions(ctx.params.id);
  audit("admin", admin.id, disabled ? "facilitator_disabled" : "facilitator_enabled", { target: ctx.params.id });
  return { ok: true };
});
