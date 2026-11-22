import fs from "node:fs";
import path from "node:path";
import { uploadDir } from "./db";
import { newId, sha256 } from "./crypto";
import { badRequest } from "./router";

export const FILE_LIMITS = {
  participantImageBytes: 3 * 1024 * 1024,
  resourceFileBytes: 10 * 1024 * 1024,
  sessionQuotaBytes: 100 * 1024 * 1024,
  perParticipantFiles: 25,
};

export type Mime = "image/png" | "image/jpeg" | "image/webp" | "application/pdf";

/** The file type comes from the file's own first bytes. The filename and the browser's content type are never trusted. */
export function detectMime(b: Buffer): Mime | null {
  if (b.length >= 8 && b.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))) return "image/png";
  if (b.length >= 3 && b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff) return "image/jpeg";
  if (b.length >= 12 && b.subarray(0, 4).toString("latin1") === "RIFF" && b.subarray(8, 12).toString("latin1") === "WEBP") return "image/webp";
  if (b.length >= 5 && b.subarray(0, 5).toString("latin1") === "%PDF-") return "application/pdf";
  return null;
}

/** Removes EXIF/XMP/Photoshop metadata (which can carry GPS location) from JPEGs. Returns null if the file is malformed. */
export function stripJpeg(b: Buffer): Buffer | null {
  const parts: Buffer[] = [b.subarray(0, 2)];
  let i = 2;
  while (i + 4 <= b.length) {
    if (b[i] !== 0xff) return null;
    const marker = b[i + 1];
    if (marker === 0xd9) { parts.push(b.subarray(i)); return Buffer.concat(parts); }
    if (marker === 0xda) { parts.push(b.subarray(i)); return Buffer.concat(parts); } // start of scan: the rest is image data
    const len = b.readUInt16BE(i + 2);
    if (len < 2 || i + 2 + len > b.length) return null;
    const drop = marker === 0xe1 || marker === 0xed || marker === 0xfe; // APP1 (EXIF/XMP), APP13, comments
    if (!drop) parts.push(b.subarray(i, i + 2 + len));
    i += 2 + len;
  }
  return null;
}

/** Removes text and time chunks (and EXIF) from PNGs. Returns null if the file is malformed. */
export function stripPng(b: Buffer): Buffer | null {
  const parts: Buffer[] = [b.subarray(0, 8)];
  let i = 8;
  let sawEnd = false;
  while (i + 12 <= b.length) {
    const len = b.readUInt32BE(i);
    const type = b.subarray(i + 4, i + 8).toString("latin1");
    const end = i + 12 + len;
    if (end > b.length) return null;
    if (!["eXIf", "tEXt", "iTXt", "zTXt", "tIME"].includes(type)) parts.push(b.subarray(i, end));
    i = end;
    if (type === "IEND") { sawEnd = true; break; }
  }
  return sawEnd ? Buffer.concat(parts) : null;
}

export interface Saved {
  id: string;
  mime: Mime;
  bytes: number;
  sha: string;
  storedName: string;
  originalName: string;
}

export function cleanName(raw: string | undefined, mime: Mime): string {
  const ext = { "image/png": ".png", "image/jpeg": ".jpg", "image/webp": ".webp", "application/pdf": ".pdf" }[mime];
  let decoded = raw || "file";
  try { decoded = decodeURIComponent(decoded); } catch { /* keep as sent */ }
  const base = decoded.split(/[\\/]/).pop()!.replace(/\.[^.]*$/, "").replace(/[^\p{L}\p{N} _-]/gu, "").trim().slice(0, 60) || "file";
  return base + ext;
}

/**
 * Validates and stores an upload. Participant uploads are PNG or JPEG only and are re-written without metadata.
 * The stored name is random and has no extension, so nothing in the upload folder can be executed or guessed.
 */
export function validateAndStore(buf: Buffer, opts: { who: "participant" | "facilitator"; originalName?: string }): Saved {
  if (!buf.length) throw badRequest("The file is empty.");
  const mime = detectMime(buf);
  if (!mime) throw badRequest("Unsupported file. Use a PNG or JPEG image" + (opts.who === "facilitator" ? ", a WebP image, or a PDF." : "."), "unsupported_file");
  if (opts.who === "participant" && mime !== "image/png" && mime !== "image/jpeg") throw badRequest("Use a PNG or JPEG image.", "unsupported_file");
  const max = opts.who === "participant" ? FILE_LIMITS.participantImageBytes : FILE_LIMITS.resourceFileBytes;
  if (buf.length > max) throw badRequest(`That file is too large. The limit is ${Math.floor(max / 1024 / 1024)} MB.`, "file_too_large");
  let data: Buffer = buf;
  if (mime === "image/jpeg" || mime === "image/png") {
    const cleaned = mime === "image/jpeg" ? stripJpeg(buf) : stripPng(buf);
    if (!cleaned) throw badRequest("That image file looks damaged.", "unsupported_file");
    data = cleaned;
  }
  const id = newId("att");
  const storedName = newId("f").slice(2);
  fs.mkdirSync(uploadDir(), { recursive: true });
  fs.writeFileSync(path.join(uploadDir(), storedName), data, { mode: 0o600 });
  return { id, mime, bytes: data.length, sha: sha256(data.toString("latin1")), storedName, originalName: cleanName(opts.originalName, mime) };
}

export function readStored(storedName: string): Buffer | null {
  if (!/^[a-z0-9_]+$/.test(storedName)) return null;
  try {
    return fs.readFileSync(path.join(uploadDir(), storedName));
  } catch {
    return null;
  }
}

/** Physical copy of a stored file under a new random name (used when a session is duplicated). */
export function copyStored(storedName: string): string | null {
  if (!/^[a-z0-9_]+$/.test(storedName)) return null;
  const next = newId("f").slice(2);
  try {
    fs.copyFileSync(path.join(uploadDir(), storedName), path.join(uploadDir(), next));
    return next;
  } catch {
    return null;
  }
}

export function removeStored(storedName: string) {
  if (!/^[a-z0-9_]+$/.test(storedName)) return;
  try {
    fs.unlinkSync(path.join(uploadDir(), storedName));
  } catch {
    /* already gone */
  }
}
