import { badRequest } from "./router";

export function obj(v: unknown): Record<string, unknown> {
  if (v === undefined || v === null) return {};
  if (typeof v !== "object" || Array.isArray(v)) throw badRequest("A JSON object is required.");
  return v as Record<string, unknown>;
}

export function text(v: unknown, name: string, o: { min?: number; max?: number; optional?: boolean } = {}): string {
  if (v === undefined || v === null || v === "") {
    if (o.optional) return "";
    throw badRequest(`${name} is required.`);
  }
  if (typeof v !== "string") throw badRequest(`${name} must be text.`);
  // Strip control characters except newline/tab; keep all Unicode (English and Traditional Chinese) intact.
  const s = v.normalize("NFC").replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g, "").trim();
  if (!s && !o.optional) throw badRequest(`${name} is required.`);
  if (o.min && [...s].length < o.min) throw badRequest(`${name} must be at least ${o.min} characters.`);
  if (o.max && [...s].length > o.max) throw badRequest(`${name} must be at most ${o.max} characters.`);
  return s;
}

export function int(v: unknown, name: string, o: { min?: number; max?: number; optional?: boolean } = {}): number | null {
  if (v === undefined || v === null || v === "") {
    if (o.optional) return null;
    throw badRequest(`${name} is required.`);
  }
  const n = Number(v);
  if (!Number.isInteger(n)) throw badRequest(`${name} must be a whole number.`);
  if (o.min !== undefined && n < o.min) throw badRequest(`${name} must be at least ${o.min}.`);
  if (o.max !== undefined && n > o.max) throw badRequest(`${name} must be at most ${o.max}.`);
  return n;
}

export function bool(v: unknown, name: string): boolean {
  if (typeof v !== "boolean") throw badRequest(`${name} must be true or false.`);
  return v;
}

export function oneOf<T extends string>(v: unknown, name: string, allowed: readonly T[]): T {
  if (typeof v !== "string" || !(allowed as readonly string[]).includes(v)) throw badRequest(`${name} must be one of: ${allowed.join(", ")}.`);
  return v as T;
}

export function emailAddr(v: unknown): string {
  const s = text(v, "Email", { max: 200 }).toLowerCase();
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(s)) throw badRequest("Enter a valid email address.");
  return s;
}

export const LIMITS = {
  title: 120,
  name: 60,
  fieldValue: 60,
  fieldLabel: 40,
  maxFields: 6,
  maxGroups: 40,
  pinMin: 4,
  pinMax: 20,
  seatCapMax: 200,
  passwordMin: 10,
};
