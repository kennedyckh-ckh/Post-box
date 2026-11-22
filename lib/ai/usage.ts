import { all, get, run, now, num, str, type Row } from "../db";
import { newId } from "../crypto";
import { HttpError } from "../router";
import { aiSettings } from "./config";

export interface Limits {
  requestsPerDay: number;
  tokensPerMonth: number;
  source: "administrator" | "default";
}

/** Limits apply to EACH facilitator. An administrator can change them in the app; otherwise the host's defaults apply. */
export function limits(): Limits {
  const r = get("SELECT * FROM ai_limits WHERE scope='global'");
  if (r) return { requestsPerDay: num(r.requests_per_day), tokensPerMonth: num(r.tokens_per_month), source: "administrator" };
  const s = aiSettings();
  return { requestsPerDay: s.defaultRequestsPerDay, tokensPerMonth: s.defaultTokensPerMonth, source: "default" };
}

export function setLimits(requestsPerDay: number, tokensPerMonth: number, userId: string) {
  run("INSERT INTO ai_limits(scope,requests_per_day,tokens_per_month,updated_by,updated_at) VALUES('global',?,?,?,?) ON CONFLICT(scope) DO UPDATE SET requests_per_day=excluded.requests_per_day, tokens_per_month=excluded.tokens_per_month, updated_by=excluded.updated_by, updated_at=excluded.updated_at", requestsPerDay, tokensPerMonth, userId, now());
}

export const utcDayStart = (t = now()) => { const d = new Date(t); return Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()); };
export const utcMonthStart = (t = now()) => { const d = new Date(t); return Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), 1); };
const weekStart = (t = now()) => utcDayStart(t) - ((new Date(t).getUTCDay() + 6) % 7) * 86_400_000;

/** Live (non-simulated) requests and tokens that count against a facilitator's limits. */
export function liveUsage(userId: string) {
  const day = get("SELECT COUNT(*) AS c FROM ai_usage WHERE user_id=? AND provider<>'simulated' AND at>=?", userId, utcDayStart())!;
  const mon = get("SELECT COALESCE(SUM(COALESCE(prompt_tokens,0)+COALESCE(completion_tokens,0)),0) AS t FROM ai_usage WHERE user_id=? AND provider<>'simulated' AND at>=?", userId, utcMonthStart())!;
  return { requestsToday: num(day.c), tokensThisMonth: num(mon.t) };
}

/** Called before any live request. Simulated mode is free and never blocked. */
export function checkQuota(userId: string, provider: string) {
  if (provider === "simulated") return;
  const l = limits();
  const u = liveUsage(userId);
  if (u.requestsToday >= l.requestsPerDay) throw new HttpError(429, "ai_quota_exceeded", `You have used all ${l.requestsPerDay} AI requests allowed today. The limit resets at midnight UTC, or an administrator can raise it. Everything else in the platform still works.`, { ...u, ...l });
  if (u.tokensThisMonth >= l.tokensPerMonth) throw new HttpError(429, "ai_quota_exceeded", `You have used this month's AI allowance (${l.tokensPerMonth.toLocaleString("en")} tokens). An administrator can raise it. Everything else in the platform still works.`, { ...u, ...l });
}

export interface UsageRow {
  userId: string; sessionId: string | null; outputId: string | null; kind: string; provider: string; model: string;
  status: "ok" | "error" | "invalid_output"; errorCode?: string | null; httpStatus?: number | null; promptTokens?: number | null; completionTokens?: number | null; latencyMs?: number | null; requestKey?: string | null;
}
/** Metadata only. No prompt, no participant text, no model reply. */
export function recordUsage(u: UsageRow): string {
  const id = newId("use");
  run("INSERT INTO ai_usage(id,user_id,session_id,output_id,kind,provider,model,status,error_code,http_status,prompt_tokens,completion_tokens,latency_ms,request_key,at) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)", id, u.userId, u.sessionId, u.outputId, u.kind, u.provider, u.model, u.status, u.errorCode ?? null, u.httpStatus ?? null, u.promptTokens ?? null, u.completionTokens ?? null, u.latencyMs ?? null, u.requestKey ?? null, now());
  return id;
}

export interface Summary { requests: number; ok: number; failed: number; promptTokens: number; completionTokens: number; simulated: number }
function summarise(rows: Row[]): Summary {
  const s: Summary = { requests: 0, ok: 0, failed: 0, promptTokens: 0, completionTokens: 0, simulated: 0 };
  for (const r of rows) {
    if (r.provider === "simulated") { s.simulated++; continue; }
    s.requests++;
    if (r.status === "ok") s.ok++; else s.failed++;
    s.promptTokens += num(r.prompt_tokens);
    s.completionTokens += num(r.completion_tokens);
  }
  return s;
}

/** The usage page's numbers. `userId` = one facilitator's own usage; null = everyone (administrator only). */
export function usageReport(userId: string | null) {
  const where = userId ? "WHERE u.user_id=?" : "";
  const args = userId ? [userId] : [];
  const rows = all(`SELECT u.*, s.title AS session_title, us.name AS user_name FROM ai_usage u LEFT JOIN sessions s ON s.id=u.session_id LEFT JOIN users us ON us.id=u.user_id ${where} ORDER BY u.at DESC`, ...args);
  const t = now();
  const within = (from: number) => rows.filter((r) => num(r.at) >= from);
  const group = (key: (r: Row) => string) => {
    const m = new Map<string, Row[]>();
    for (const r of rows) m.set(key(r), [...(m.get(key(r)) ?? []), r]);
    return [...m].map(([label, rs]) => ({ label, ...summarise(rs) })).sort((a, b) => b.requests - a.requests || b.simulated - a.simulated);
  };
  return {
    periods: { today: summarise(within(utcDayStart(t))), week: summarise(within(weekStart(t))), month: summarise(within(utcMonthStart(t))), all: summarise(rows) },
    bySession: group((r) => str(r.session_title) || "(deleted session or no session)").slice(0, 50),
    byKind: group((r) => str(r.kind)),
    byFacilitator: userId ? [] : group((r) => str(r.user_name) || "(removed account)").slice(0, 100),
    recent: rows.slice(0, 50).map((r) => ({ at: num(r.at), session: str(r.session_title) || null, facilitator: userId ? undefined : str(r.user_name) || null, kind: r.kind, provider: r.provider, model: r.model, status: r.status, errorCode: r.error_code ?? null, promptTokens: r.prompt_tokens === null ? null : num(r.prompt_tokens), completionTokens: r.completion_tokens === null ? null : num(r.completion_tokens), latencyMs: r.latency_ms === null ? null : num(r.latency_ms) })),
  };
}

export function usageCsv(userId: string | null): string {
  const rows = all(`SELECT u.*, s.title AS session_title, us.name AS user_name FROM ai_usage u LEFT JOIN sessions s ON s.id=u.session_id LEFT JOIN users us ON us.id=u.user_id ${userId ? "WHERE u.user_id=?" : ""} ORDER BY u.at DESC LIMIT 20000`, ...(userId ? [userId] : []));
  const cell = (v: unknown) => { let s = v === null || v === undefined ? "" : String(v); if (/^[=+\-@\t\r]/.test(s)) s = `'${s}`; return /[",\r\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s; };
  const head = ["time_utc", "facilitator", "session", "type", "provider", "model", "status", "error_code", "prompt_tokens", "completion_tokens", "latency_ms"];
  return "﻿" + [head.join(","), ...rows.map((r) => [new Date(num(r.at)).toISOString(), r.user_name, r.session_title, r.kind, r.provider, r.model, r.status, r.error_code, r.prompt_tokens, r.completion_tokens, r.latency_ms].map(cell).join(","))].join("\r\n") + "\r\n";
}
