import crypto from "node:crypto";

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
