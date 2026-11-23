import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";

/** 32 symbols, no 0/O/1/I, so codes are easy to read aloud. 256 % 32 == 0, so the mapping is unbiased. */
const ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";

export function randomCode(len: number): string {
  const bytes = crypto.randomBytes(len);
  let out = "";
  for (let i = 0; i < len; i++) out += ALPHABET[bytes[i] % 32];
  return out;
}

/** Unguessable record id such as `par_k3m9x2q7d4tz`. */
export function newId(prefix: string): string {
  return `${prefix}_${randomCode(12).toLowerCase()}`;
}

export function randomToken(): string {
  return crypto.randomBytes(32).toString("base64url");
}

export function sha256(s: string): string {
  return crypto.createHash("sha256").update(s).digest("hex");
}

export function safeEqual(a: string, b: string): boolean {
  const ab = Buffer.from(a);
  const bb = Buffer.from(b);
  return ab.length === bb.length && crypto.timingSafeEqual(ab, bb);
}

/** scrypt, format `scrypt$<salt hex>$<hash hex>`. Used for passwords, group PINs and recovery codes. */
export function hashSecret(secret: string): string {
  const salt = crypto.randomBytes(16);
  const hash = crypto.scryptSync(secret, salt, 32);
  return `scrypt$${salt.toString("hex")}$${hash.toString("hex")}`;
}

export function verifySecret(secret: string, stored: string | null | undefined): boolean {
  if (!stored) return false;
  const [kind, saltHex, hashHex] = stored.split("$");
  if (kind !== "scrypt" || !saltHex || !hashHex) return false;
  const expected = Buffer.from(hashHex, "hex");
  const actual = crypto.scryptSync(secret, Buffer.from(saltHex, "hex"), expected.length);
  return crypto.timingSafeEqual(actual, expected);
}

/* ---------- reversible encryption for values a person must be able to see again (recovery codes) ---------- */


let cachedKey: Buffer | null = null;

/**
 * 32-byte key for AES-256-GCM. Taken from APP_SECRET when set; otherwise generated once and kept in
 * `<DATA_DIR>/secret.key` (readable by the server only). The key is NOT inside the database, so a copied
 * database or backup alone cannot reveal recovery codes. If the key is lost, stored codes simply cannot be
 * shown again and a participant (or facilitator) issues a new one.
 */
function encryptionKey(): Buffer {
  if (cachedKey) return cachedKey;
  const fromEnv = (process.env.APP_SECRET || "").trim();
  if (fromEnv) return (cachedKey = crypto.createHash("sha256").update(`groupwork:${fromEnv}`).digest());
  const dir = process.env.DATA_DIR || path.join(process.cwd(), "data");
  const file = path.join(dir, "secret.key");
  fs.mkdirSync(dir, { recursive: true });
  if (!fs.existsSync(file)) {
    try { fs.writeFileSync(file, crypto.randomBytes(32).toString("hex"), { mode: 0o600, flag: "wx" }); } catch { /* another process created it first */ }
  }
  const hex = fs.readFileSync(file, "utf8").trim();
  return (cachedKey = Buffer.from(hex, "hex"));
}

/** Test helper: forget the cached key (DATA_DIR may change between test files). */
export function resetEncryptionKey() { cachedKey = null; }

/** Format `gcm1$<iv>$<tag>$<ciphertext>` (base64url). */
export function encryptText(plain: string): string {
  const iv = crypto.randomBytes(12);
  const c = crypto.createCipheriv("aes-256-gcm", encryptionKey(), iv);
  const enc = Buffer.concat([c.update(plain, "utf8"), c.final()]);
  return `gcm1$${iv.toString("base64url")}$${c.getAuthTag().toString("base64url")}$${enc.toString("base64url")}`;
}

/** Returns null when the value is missing, malformed or was encrypted with a different key. */
export function decryptText(stored: string | null | undefined): string | null {
  if (!stored) return null;
  const [kind, iv, tag, data] = stored.split("$");
  if (kind !== "gcm1" || !iv || !tag || !data) return null;
  try {
    const d = crypto.createDecipheriv("aes-256-gcm", encryptionKey(), Buffer.from(iv, "base64url"));
    d.setAuthTag(Buffer.from(tag, "base64url"));
    return Buffer.concat([d.update(Buffer.from(data, "base64url")), d.final()]).toString("utf8");
  } catch {
    return null;
  }
}
