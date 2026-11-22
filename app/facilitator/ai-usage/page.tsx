"use client";
import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { api, errText, ApiError } from "@/lib/client/api";
import { Shell, Card, Button, Alert, Badge, TextField } from "@/components/ui";

interface Sum { requests: number; ok: number; failed: number; promptTokens: number; completionTokens: number; simulated: number }
interface Report {
  periods: { today: Sum; week: Sum; month: Sum; all: Sum };
  bySession: ({ label: string } & Sum)[]; byKind: ({ label: string } & Sum)[]; byFacilitator: ({ label: string } & Sum)[];
  recent: { at: number; session: string | null; facilitator?: string | null; kind: string; provider: string; model: string; status: string; errorCode: string | null; promptTokens: number | null; completionTokens: number | null; latencyMs: number | null }[];
}
interface Usage {
  status: { provider: string; model: string; configured: boolean; problems: string[]; simulated: boolean };
  limits: { requestsPerDay: number; tokensPerMonth: number; source: string };
  usage: { requestsToday: number; tokensThisMonth: number };
  remaining: { requestsToday: number; tokensThisMonth: number };
  note: string; mine: Report; everyone: Report | null; isAdmin: boolean;
}

const KIND: Record<string, string> = { group_summary: "Group summary", cross_group: "Comparison across groups", discussion_points: "Discussion questions", test: "Connection test" };
const n = (x: number | null | undefined) => (x === null || x === undefined ? "–" : x.toLocaleString("en"));

function Meter({ label, used, max }: { label: string; used: number; max: number }) {
  const pct = max > 0 ? Math.min(100, Math.round((used / max) * 100)) : 100;
  return (
    <div className="mb-4">
      <p className="mb-1 font-semibold">{label}: {n(used)} of {n(max)} used ({pct}%)</p>
      <div className="h-4 w-full overflow-hidden rounded-full bg-slate-200" role="progressbar" aria-valuemin={0} aria-valuemax={max} aria-valuenow={Math.min(used, max)} aria-label={label}>
        <div className={`h-4 ${pct >= 90 ? "bg-red-700" : pct >= 70 ? "bg-amber-600" : "bg-brand"}`} style={{ width: `${pct}%` }} />
      </div>
      <p className="mt-1 text-sm">{max - used > 0 ? `${n(max - used)} left` : "None left. New live requests are paused until the allowance resets."}</p>
    </div>
  );
}

function PeriodTable({ r }: { r: Report }) {
  const rows: [string, Sum][] = [["Today", r.periods.today], ["This week", r.periods.week], ["This month", r.periods.month], ["All time", r.periods.all]];
  return (
    <div className="overflow-x-auto"><table className="w-full text-left text-sm"><caption className="sr-only">Usage by period</caption>
      <thead><tr className="border-b border-line">{["Period", "Live requests", "Succeeded", "Failed", "Tokens in", "Tokens out", "Demo requests"].map((h) => <th key={h} scope="col" className="p-2">{h}</th>)}</tr></thead>
      <tbody>{rows.map(([l, s]) => <tr key={l} className="border-b border-line"><th scope="row" className="p-2">{l}</th><td className="p-2">{n(s.requests)}</td><td className="p-2">{n(s.ok)}</td><td className="p-2">{n(s.failed)}</td><td className="p-2">{n(s.promptTokens)}</td><td className="p-2">{n(s.completionTokens)}</td><td className="p-2">{n(s.simulated)}</td></tr>)}</tbody></table></div>
  );
}

function Breakdown({ title, rows, kind }: { title: string; rows: ({ label: string } & Sum)[]; kind?: boolean }) {
  return (
    <Card>
      <h3 className="mb-2 text-lg font-semibold">{title}</h3>
      {rows.length === 0 ? <p>Nothing yet.</p> : (
        <div className="overflow-x-auto"><table className="w-full text-left text-sm"><caption className="sr-only">{title}</caption>
          <thead><tr className="border-b border-line"><th scope="col" className="p-2">Name</th><th scope="col" className="p-2">Live requests</th><th scope="col" className="p-2">Tokens (in + out)</th><th scope="col" className="p-2">Demo requests</th></tr></thead>
          <tbody>{rows.map((r) => <tr key={r.label} className="border-b border-line"><th scope="row" className="p-2">{kind ? KIND[r.label] ?? r.label : r.label}</th><td className="p-2">{n(r.requests)}</td><td className="p-2">{n(r.promptTokens + r.completionTokens)}</td><td className="p-2">{n(r.simulated)}</td></tr>)}</tbody></table></div>
      )}
    </Card>
  );
}

function Recent({ r, withWho }: { r: Report; withWho?: boolean }) {
  return (
    <Card>
      <h3 className="mb-1 text-lg font-semibold">Most recent requests</h3>
      <p className="mb-2 text-sm">Only details such as time, type and size are kept. What was sent and what came back is never stored here.</p>
      {r.recent.length === 0 ? <p>No requests yet.</p> : (
        <div className="overflow-x-auto"><table className="w-full text-left text-sm"><caption className="sr-only">Recent AI requests</caption>
          <thead><tr className="border-b border-line">{["Time", ...(withWho ? ["Facilitator"] : []), "Session", "Type", "Mode", "Result", "Tokens in/out", "Time taken"].map((h) => <th key={h} scope="col" className="p-2">{h}</th>)}</tr></thead>
          <tbody>{r.recent.map((x, i) => <tr key={i} className="border-b border-line"><td className="p-2 whitespace-nowrap">{new Date(x.at).toLocaleString()}</td>{withWho && <td className="p-2">{x.facilitator ?? "–"}</td>}<td className="p-2">{x.session ?? "–"}</td><td className="p-2">{KIND[x.kind] ?? x.kind}</td><td className="p-2">{x.provider === "simulated" ? <Badge tone="amber">Demo</Badge> : <Badge tone="blue">Live</Badge>}</td><td className="p-2">{x.status === "ok" ? "Succeeded" : x.status === "invalid_output" ? "Reply rejected (invalid)" : `Failed${x.errorCode ? ` (${x.errorCode})` : ""}`}</td><td className="p-2">{n(x.promptTokens)} / {n(x.completionTokens)}</td><td className="p-2">{x.latencyMs === null ? "–" : `${(x.latencyMs / 1000).toFixed(1)} s`}</td></tr>)}</tbody></table></div>
      )}
    </Card>
  );
}

export default function AiUsagePage() {
  const [u, setU] = useState<Usage | null>(null);
  const [err, setErr] = useState("");
  const [note, setNote] = useState<{ kind: "success" | "error" | "info"; text: string } | null>(null);
  const [testing, setTesting] = useState(false);
  const [lr, setLr] = useState("");
  const [lt, setLt] = useState("");
  const load = useCallback(async () => {
    try { const r = await api<Usage>("GET", "/ai/usage"); setU(r); setLr(String(r.limits.requestsPerDay)); setLt(String(r.limits.tokensPerMonth)); setErr(""); }
    catch (e) { if (e instanceof ApiError && e.status === 401) window.location.href = "/facilitator"; else setErr(errText(e)); }
  }, []);
  useEffect(() => { void load(); }, [load]);

  async function test() {
    setTesting(true); setNote(null);
    try { const r = await api<{ simulated: boolean; message: string; latencyMs?: number }>("POST", "/ai/test-connection", {}); setNote({ kind: r.simulated ? "info" : "success", text: r.simulated ? r.message : `${r.message} (${((r.latencyMs ?? 0) / 1000).toFixed(1)} s)` }); }
    catch (e) { setNote({ kind: "error", text: errText(e) }); }
    finally { setTesting(false); void load(); }
  }

  if (!u) return <Shell title="AI usage">{err ? <Alert kind="error">{err}</Alert> : <p role="status">Loading…</p>}</Shell>;
  const s = u.status;
  return (
    <Shell wide title="AI usage">
      <p className="mb-4"><Link href="/facilitator" className="underline">← Your sessions</Link></p>
      {err && <Alert kind="error">{err}</Alert>}
      <Card className="mb-6">
        <h2 className="mb-2 text-xl font-semibold">Connection</h2>
        <p className="mb-2">Mode: {s.simulated ? <Badge tone="amber">Demo (simulated, not real AI)</Badge> : <Badge tone="blue">Live: HKU AI service ({s.model})</Badge>} {!s.simulated && (s.configured ? <Badge tone="green">Settings present</Badge> : <Badge tone="red">Settings missing</Badge>)}</p>
        {!s.simulated && !s.configured && <Alert kind="error">Live AI is selected but these settings are missing or invalid: {s.problems.join(", ")}. The administrator sets them on the host (never in this app).</Alert>}
        <p className="mb-3 text-sm">“Settings present” only means the settings exist. Press the test to find out whether a live request really works. It sends one harmless word (no participant data) and counts as one request.</p>
        {note && <Alert kind={note.kind}>{note.text}</Alert>}
        <Button onClick={() => void test()} disabled={testing}>{testing ? "Testing…" : "Test the connection"}</Button>
      </Card>

      <Card className="mb-6">
        <h2 className="mb-1 text-xl font-semibold">Your allowance</h2>
        <p className="mb-3 text-sm">Each facilitator has their own allowance of live AI requests (resets at midnight UTC) and tokens (resets on the 1st of the month UTC). Limits set by {u.limits.source === "administrator" ? "an administrator" : "the host default"}. Demo requests never count.</p>
        <Meter label="Live requests today" used={u.usage.requestsToday} max={u.limits.requestsPerDay} />
        <Meter label="Tokens this month" used={u.usage.tokensThisMonth} max={u.limits.tokensPerMonth} />
        <p className="text-sm">{u.note}</p>
      </Card>

      <section className="mb-6 space-y-6" aria-label="Your usage">
        <Card><h2 className="mb-2 text-xl font-semibold">Your usage</h2><PeriodTable r={u.mine} /></Card>
        <div className="grid gap-6 lg:grid-cols-2"><Breakdown title="By session" rows={u.mine.bySession} /><Breakdown title="By type of draft" rows={u.mine.byKind} kind /></div>
        <Recent r={u.mine} />
        {/* a file download, not a page link */}
        {/* eslint-disable-next-line @next/next/no-html-link-for-pages */}
        <a className="inline-flex min-h-11 items-center rounded-lg border border-brand px-4 font-semibold text-brand-strong" href="/api/ai/usage/export">Download my usage as CSV (details only)</a>
      </section>

      {u.isAdmin && u.everyone && (
        <section className="space-y-6" aria-label="Everyone's usage">
          <h2 className="text-2xl font-bold text-brand-strong">Everyone (administrator)</h2>
          <Card>
            <h3 className="mb-2 text-lg font-semibold">Limits for each facilitator</h3>
            <form onSubmit={async (e) => { e.preventDefault(); try { await api("PUT", "/admin/ai/limits", { requestsPerDay: Number(lr), tokensPerMonth: Number(lt) }); setNote({ kind: "success", text: "Limits saved." }); void load(); } catch (er) { setNote({ kind: "error", text: errText(er) }); } }}>
              <div className="grid gap-x-4 sm:grid-cols-2"><TextField label="Live requests per day" type="number" value={lr} onChange={setLr} /><TextField label="Tokens per month" type="number" value={lt} onChange={setLt} /></div>
              <Button type="submit">Save limits</Button>
            </form>
          </Card>
          <Card><h3 className="mb-2 text-lg font-semibold">Everyone's usage</h3><PeriodTable r={u.everyone} /></Card>
          <Breakdown title="By facilitator" rows={u.everyone.byFacilitator} />
          <Recent r={u.everyone} withWho />
          {/* eslint-disable-next-line @next/next/no-html-link-for-pages */}
          <a className="inline-flex min-h-11 items-center rounded-lg border border-brand px-4 font-semibold text-brand-strong" href="/api/ai/usage/export?scope=all">Download everyone's usage as CSV (details only)</a>
        </section>
      )}
    </Shell>
  );
}
