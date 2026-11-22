import { get, run, now } from "./db";
import { newId, hashSecret } from "./crypto";

/**
 * Creates the first (admin) facilitator from private environment variables, only when no user exists yet.
 * There are no demo accounts. After the first sign-in the three variables should be deleted from the host.
 */
export function bootstrapAdmin() {
  if (get("SELECT 1 AS x FROM users LIMIT 1")) return;
  const email = (process.env.BOOTSTRAP_ADMIN_EMAIL || "").trim().toLowerCase();
  const name = (process.env.BOOTSTRAP_ADMIN_NAME || "").trim();
  const password = process.env.BOOTSTRAP_ADMIN_PASSWORD || "";
  if (!email || !password) return;
  if (password.length < 10) {
    console.error("BOOTSTRAP_ADMIN_PASSWORD must be at least 10 characters; no account was created.");
    return;
  }
  run(
    "INSERT INTO users(id,email,name,password_hash,is_admin,must_change_password,created_at) VALUES(?,?,?,?,1,1,?)",
    newId("usr"),
    email,
    name || "Administrator",
    hashSecret(password),
    now()
  );
}
