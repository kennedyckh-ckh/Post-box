"use client";
import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { api, errText, ApiError } from "@/lib/client/api";
import { Card, Button, Alert, Badge, TextField, Field, inputCls } from "@/components/ui";
import type { Detail, Act } from "./types";

interface Point { heading: string; text: string; kind: string; cites: string[] }
interface Content { overview: string; points: Point[] }
interface Out {
  id: string; kind: "group_summary" | "cross_group" | "discussion_points"; groupName: string | null; status: string; simulated: boolean; simulatedLabel: string | null; provider: string; model: string; createdAt: number;
  original: Content; edited: Content | null; content: Content; outdated: boolean; reviewed: boolean; published: boolean; publicationId: string | null;
  scope: { includeDrafts: boolean; includeComments: boolean } | null; criteria: { language: string; detail: string } | null;
}
interface Status { status: { provider: string; model: string; configured: boolean; problems: string[]; simulated: boolean }; simulatedLabel: string | null }
interface Src { alias: string; group: string | null; part: string | null; author: string | null; text: string | null; tags: string[] }
interface Preview { entries: number; chars: number; maxChars: number; tooLarge: boolean; skipped: { group: string; part: string; reason: string }[]; excludedByDefault: string[]; willBeSentTo: string; samplePrompt: string }
interface StageLite { id: string; title: string; enabled: boolean; questions: { id: string; text: string }[] }
interface Preset { key: string; label: string; criteria: string }

const KIND_LABEL = { group_summary: "Group summary", cross_group: "Comparison across groups", discussion_points: "Discussion questions" } as const;

export function AiTab({ d, act }: { d: Detail; act: Act }) {
  const sid = d.session.id;
  const archived = d.session.status === "archived";
  const [st, setSt] = useState<Status | null>(null);
  const [presets, setPresets] = useState<Preset[]>([]);
  const [stages, setStages] = useState<StageLite[]>([]);
  const [outs, setOuts] = useState<Out[]>([]);
  const [err, setErr] = useState("");
  const [msg, setMsg] = useState("");
  const [kind, setKind] = useState<Out["kind"]>("group_summary");
  const [partIds, setPartIds] = useState<string[]>([]);
  const [groupIds, setGroupIds] = useState<string[]>([]);
  const [qIds, setQIds] = useState<string[]>([]);
  const [drafts, setDrafts] = useState(false);
  const [comments, setComments] = useState(false);
  const [preview, setPreview] = useState<Preview | null>(null);
  const [busy, setBusy] = useState(false);
  const crit = d.session.aiCriteria;
  const [c, setC] = useState(crit);

  const load = useCallback(async () => {
    try {
      const [s, o, sg, p] = await Promise.all([api<Status>("GET", "/ai/status"), api<{ outputs: Out[] }>("GET", `/sessions/${sid}/ai/outputs`), api<{ stages: StageLite[] }>("GET", `/sessions/${sid}/stages`), api<{ presets: Preset[] }>("GET", "/ai/presets")]);
      setSt(s); setOuts(o.outputs); setStages(sg.stages); setPresets(p.presets); setErr("");
    } catch (e) { setErr(errText(e)); }
  }, [sid]);
  useEffect(() => { void load(); }, [load]);

  const scope = { stageIds: partIds, groupIds, questionIds: qIds, includeDrafts: drafts, includeComments: comments };
  const run: Act = async (fn, ok) => { setMsg(""); await act(fn, ok); await load(); };

  async function doPreview() {
    setErr(""); setPreview(null);
    try { setPreview(await api<Preview>("POST", `/sessions/${sid}/ai/preview`, { kind, scope, criteria: c })); } catch (e) { setErr(errText(e)); }
  }
  async function generate() {
    setErr(""); setMsg(""); setBusy(true);
    try {
      const r = await api<{ output: Out; duplicate: boolean }>("POST", `/sessions/${sid}/ai/generate`, { kind, scope, criteria: c, requestKey: `${Date.now()}-${Math.random().toString(36).slice(2)}` });
      setMsg(r.duplicate ? "That analysis had already been made." : "Draft created. It is private to you until you review and publish it."); setPreview(null); await load();
    } catch (e) { setErr(e instanceof ApiError && e.code === "nothing_to_analyse" ? `${e.message}` : errText(e)); }
    finally { setBusy(false); }
  }
  const toggle = (list: string[], set: (x: string[]) => void, id: string) => set(list.includes(id) ? list.filter((x) => x !== id) : [...list, id]);
  const single = kind === "group_summary";
  const questions = stages.filter((s) => partIds.includes(s.id)).flatMap((s) => s.questions.map((q) => ({ ...q, part: s.title })));

  return (
    <div className="space-y-6">
      {err && <Alert kind="error">{err}</Alert>}
      {msg && <Alert kind="success">{msg}</Alert>}
      {st && (st.status.simulated
        ? <Alert kind="warning"><strong>{st.simulatedLabel}</strong> Outputs below come from a simple built-in demo that groups entries by tag. Nothing leaves this server. To use the real service, the administrator sets AI_PROVIDER=hku and the HKU settings on the host. <Link href="/facilitator/ai-usage" className="font-semibold underline">AI usage and connection test</Link></Alert>
        : st.status.configured
          ? <Alert kind="info">Live AI is switched on ({st.status.model}). Selected work is sent to the HKU AI service only when you press Generate. <Link href="/facilitator/ai-usage" className="font-semibold underline">AI usage and connection test</Link></Alert>
          : <Alert kind="error">Live AI is selected but not set up. The administrator needs to set: {st.status.problems.join(", ")}. Everything else in the platform works without AI.</Alert>)}
      <Alert kind="info">AI is optional and only ever a private draft. It can be wrong, so you review and edit everything before sharing. It cannot change groups, open parts, share anything or grade people. Reactions are never treated as evidence.</Alert>

      <Card>
        <h2 className="mb-2 text-xl font-semibold">What to look for</h2>
        <div className="grid gap-x-4 sm:grid-cols-2">
          <Field label="Starting point">{(id) => <select id={id} className={inputCls} value={c.preset} onChange={(e) => { const p = presets.find((x) => x.key === e.target.value); setC({ ...c, preset: e.target.value, criteria: p && p.criteria ? p.criteria : c.criteria }); }}>{presets.map((p) => <option key={p.key} value={p.key}>{p.label}</option>)}</select>}</Field>
          <TextField label="Output language" value={c.language} onChange={(v) => setC({ ...c, language: v })} hint="For example English or 繁體中文" maxLength={40} />
        </div>
        <TextField label="Purpose of the activity (optional)" value={c.purpose} onChange={(v) => setC({ ...c, purpose: v })} maxLength={500} />
        <Field label="Criteria (you can change every word)">{(id) => <textarea id={id} className={`${inputCls} min-h-20`} value={c.criteria} maxLength={1500} onChange={(e) => setC({ ...c, criteria: e.target.value, preset: "custom" })} />}</Field>
        <Field label="Level of detail">{(id) => <select id={id} className={inputCls} value={c.detail} onChange={(e) => setC({ ...c, detail: e.target.value as typeof c.detail })}><option value="brief">Brief</option><option value="standard">Standard</option><option value="detailed">Detailed</option></select>}</Field>
        <Button variant="secondary" disabled={archived} onClick={() => void run(() => api("PUT", `/sessions/${sid}/ai/criteria`, c), "Criteria saved as this session's default.")}>Save as the session default</Button>
      </Card>

      <Card>
        <h2 className="mb-2 text-xl font-semibold">Make a draft</h2>
        <fieldset className="mb-4"><legend className="mb-1 text-sm font-semibold">What kind of draft?</legend>
          <div className="flex flex-wrap gap-4">{(Object.keys(KIND_LABEL) as Out["kind"][]).map((k) => <label key={k} className="flex min-h-11 items-center gap-2"><input type="radio" name="kind" checked={kind === k} onChange={() => { setKind(k); setGroupIds([]); setPreview(null); }} /> {KIND_LABEL[k]}</label>)}</div>
        </fieldset>
        <fieldset className="mb-4"><legend className="mb-1 text-sm font-semibold">Parts to include</legend>
          <div className="flex flex-wrap gap-4">{stages.filter((s) => s.enabled).map((s) => <label key={s.id} className="flex min-h-11 items-center gap-2"><input type="checkbox" className="h-5 w-5" checked={partIds.includes(s.id)} onChange={() => toggle(partIds, setPartIds, s.id)} /> {s.title}</label>)}</div>
        </fieldset>
        <fieldset className="mb-4"><legend className="mb-1 text-sm font-semibold">{single ? "Which group (choose one)" : "Which groups"}</legend>
          <div className="flex flex-wrap gap-4">{d.groups.map((g) => <label key={g.id} className="flex min-h-11 items-center gap-2"><input type={single ? "radio" : "checkbox"} name="grp" className="h-5 w-5" checked={groupIds.includes(g.id)} onChange={() => (single ? setGroupIds([g.id]) : toggle(groupIds, setGroupIds, g.id))} /> {g.name}</label>)}</div>
        </fieldset>
        {questions.length > 0 && <fieldset className="mb-4"><legend className="mb-1 text-sm font-semibold">Only these guiding questions (leave all unticked to include everything)</legend>
          <div className="flex flex-col gap-1">{questions.map((q) => <label key={q.id} className="flex min-h-11 items-center gap-2"><input type="checkbox" className="h-5 w-5" checked={qIds.includes(q.id)} onChange={() => toggle(qIds, setQIds, q.id)} /> {q.part}: {q.text}</label>)}</div></fieldset>}
        <label className="mb-1 flex min-h-11 items-center gap-2"><input type="checkbox" className="h-5 w-5" checked={drafts} onChange={(e) => setDrafts(e.target.checked)} /> Also use work that groups have <strong>not submitted yet</strong> (their current drafts). Leave unticked to use submitted work only.</label>
        <label className="mb-4 flex min-h-11 items-center gap-2"><input type="checkbox" className="h-5 w-5" checked={comments} onChange={(e) => setComments(e.target.checked)} /> Include peer responses (without names)</label>
        <div className="flex flex-wrap gap-2">
          <Button variant="secondary" disabled={archived || !partIds.length || !groupIds.length} onClick={() => void doPreview()}>1. Show what will be sent</Button>
          <Button disabled={archived || busy || !preview || preview.tooLarge || preview.entries === 0} onClick={() => void generate()}>{busy ? "Working…" : "2. Make the draft"}</Button>
        </div>
        {preview && (
          <div className="mt-4 rounded-lg border-2 border-brand p-4" role="region" aria-label="What will be sent">
            <p className="mb-2 font-semibold">{preview.entries} entries ({preview.chars.toLocaleString("en")} characters) will be used. They go to: {preview.willBeSentTo}</p>
            <p className="mb-1 text-sm">Left out on purpose: {preview.excludedByDefault.join("; ")}.</p>
            {preview.skipped.length > 0 && <Alert kind="warning">Not included: {preview.skipped.map((s) => `${s.group}, ${s.part} (${s.reason})`).join("; ")}.</Alert>}
            {preview.tooLarge && <Alert kind="error">This is too long to analyse in one go (limit {preview.maxChars.toLocaleString("en")} characters). Choose fewer parts, groups or questions. Nothing is cut automatically.</Alert>}
            {preview.entries === 0 && <Alert kind="error">There is nothing to analyse in this selection.</Alert>}
            <details><summary className="cursor-pointer text-sm font-semibold">Show the start of the exact text that would be sent</summary><pre className="mt-2 max-h-72 overflow-auto whitespace-pre-wrap rounded bg-slate-100 p-2 text-xs">{preview.samplePrompt}</pre></details>
          </div>
        )}
      </Card>

      <section aria-label="Drafts">
        <h2 className="mb-3 text-xl font-semibold">Your drafts</h2>
        {outs.length === 0 ? <Card><p>No drafts yet.</p></Card> : <ul className="space-y-4">{outs.map((o) => <OutCard key={o.id + o.status + o.createdAt + (o.edited?.overview ?? "") + o.published} o={o} archived={archived} run={run} />)}</ul>}
      </section>
    </div>
  );
}

function OutCard({ o, archived, run }: { o: Out; archived: boolean; run: Act }) {
  const [edit, setEdit] = useState<Content | null>(null);
  const [sources, setSources] = useState<Src[] | null>(null);
  const [showOrig, setShowOrig] = useState(false);
  const [err, setErr] = useState("");
  const [revealed, setRevealed] = useState<Record<number, boolean>>({});
  async function showSources() { try { setSources((await api<{ sources: Src[] }>("GET", `/ai/outputs/${o.id}/sources`)).sources); } catch (e) { setErr(errText(e)); } }
  const mine = o.content;
  return (
    <li>
      <Card as="div">
        <div className="mb-2 flex flex-wrap items-center gap-2">
          <h3 className="text-lg font-semibold">{KIND_LABEL[o.kind]}{o.groupName ? `: ${o.groupName}` : ""}</h3>
          {o.simulated && <Badge tone="amber">Demo: simulated, not real AI</Badge>}
          <Badge tone={o.published ? "green" : o.status === "reviewed" ? "blue" : "gray"}>{o.published ? "Shared with the class" : o.status === "reviewed" ? "Reviewed" : o.status === "edited" ? "Edited, not yet reviewed" : "Draft (private)"}</Badge>
          {o.outdated && <Badge tone="red">Potentially outdated: the work has changed since this was made</Badge>}
          {o.edited && <Badge>Edited by you</Badge>}
          <span className="text-xs">{new Date(o.createdAt).toLocaleString()} · {o.provider === "simulated" ? "demo" : o.model}</span>
        </div>
        {err && <Alert kind="error">{err}</Alert>}
        {edit ? (
          <div>
            <Field label="Overview">{(id) => <textarea id={id} className={`${inputCls} min-h-16`} value={edit.overview} onChange={(e) => setEdit({ ...edit, overview: e.target.value })} />}</Field>
            {edit.points.map((p, i) => (
              <div key={i} className="mb-3 rounded border border-line p-2">
                <TextField label={`Point ${i + 1} heading`} value={p.heading} onChange={(v) => setEdit({ ...edit, points: edit.points.map((x, j) => (j === i ? { ...x, heading: v } : x)) })} />
                <Field label={`Point ${i + 1} text`}>{(id) => <textarea id={id} className={`${inputCls} min-h-16`} value={p.text} onChange={(e) => setEdit({ ...edit, points: edit.points.map((x, j) => (j === i ? { ...x, text: e.target.value } : x)) })} />}</Field>
                <p className="text-xs">Based on: {p.cites.join(", ") || "no entry"} · <button type="button" className="underline" onClick={() => setEdit({ ...edit, points: edit.points.filter((_, j) => j !== i) })}>Remove this point</button></p>
              </div>
            ))}
            <div className="flex gap-2"><Button onClick={async () => { setErr(""); try { await run(() => api("PUT", `/ai/outputs/${o.id}/edit`, edit), "Edit saved. Review it again before sharing."); setEdit(null); } catch (e) { setErr(errText(e)); } }}>Save my edit</Button><Button variant="secondary" onClick={() => setEdit(null)}>Cancel</Button></div>
          </div>
        ) : (
          <>
            <p className="mb-2">{mine.overview}</p>
            <ul className="space-y-2">
              {mine.points.map((p, i) => (
                <li key={i} className="rounded-lg bg-slate-50 p-3">
                  <p className="font-semibold">{p.heading} <Badge tone={p.kind === "insufficient" ? "amber" : p.kind === "disagreement" || p.kind === "minority" ? "blue" : "gray"}>{p.kind === "insufficient" ? "Not enough evidence" : p.kind}</Badge></p>
                  <p>{p.text}</p>
                  <p className="mt-1 text-xs">Based on: {p.cites.length ? p.cites.join(", ") : "—"}</p>
                  {o.kind === "discussion_points" && (
                    <Button variant="secondary" className="mt-2" disabled={archived || !o.reviewed} onClick={() => void run(async () => { const r = await api<{ revealed: boolean }>("POST", `/ai/outputs/${o.id}/reveal`, { index: i, revealed: !revealed[i] }); setRevealed({ ...revealed, [i]: r.revealed }); }, revealed[i] ? "Question hidden again." : "Question revealed to the class and projector.")}>{revealed[i] ? "Hide this question again" : "Reveal this question"}</Button>
                  )}
                </li>
              ))}
            </ul>
            {o.kind === "discussion_points" && !o.reviewed && <p className="mt-2 text-sm">Mark the draft as reviewed to be able to reveal questions.</p>}
          </>
        )}
        {showOrig && o.edited && <div className="mt-3 rounded border border-line p-3 text-sm"><p className="font-semibold">The AI's original wording:</p><p className="mb-1">{o.original.overview}</p><ul className="list-disc pl-5">{o.original.points.map((p, i) => <li key={i}><strong>{p.heading}:</strong> {p.text}</li>)}</ul></div>}
        {sources && (
          <div className="mt-3 rounded border border-line p-3 text-sm" role="region" aria-label="Supporting entries">
            <p className="mb-1 font-semibold">The entries this was based on (private to you; names shown only here):</p>
            <ul className="space-y-1">{sources.map((s) => <li key={s.alias}><Badge>{s.alias}</Badge> {s.group}, {s.part}, written by {s.author ?? "unknown"}: {s.text}{s.tags.length > 0 && ` [${s.tags.join(", ")}]`}</li>)}</ul>
          </div>
        )}
        <div className="mt-3 flex flex-wrap gap-2">
          <Button variant="secondary" onClick={() => (sources ? setSources(null) : void showSources())}>{sources ? "Hide supporting entries" : "Show supporting entries"}</Button>
          {o.edited && <Button variant="secondary" onClick={() => setShowOrig(!showOrig)}>{showOrig ? "Hide the AI's original" : "Compare with the AI's original"}</Button>}
          {!edit && <Button variant="secondary" disabled={archived} onClick={() => setEdit(JSON.parse(JSON.stringify(o.content)))}>Edit</Button>}
          {o.edited && <Button variant="secondary" disabled={archived} onClick={() => { if (confirm("Go back to the AI's original wording? Your edits will be removed.")) void run(() => api("POST", `/ai/outputs/${o.id}/revert`, {}), "Back to the AI's original."); }}>Undo my edits</Button>}
          <Button variant={o.reviewed ? "secondary" : "primary"} disabled={archived || o.published} onClick={() => void run(() => api("POST", `/ai/outputs/${o.id}/review`, { reviewed: !o.reviewed }), o.reviewed ? "Review withdrawn." : "Marked as reviewed.")}>{o.reviewed ? "Withdraw my review" : "I have reviewed this"}</Button>
          {o.kind !== "discussion_points" && <Button disabled={archived || !o.reviewed} onClick={() => { if (confirm(`${o.simulated ? "This is a DEMO output made by a simple built-in simulator, not an AI model. " : ""}Share this ${o.published ? "updated " : ""}draft with the class? They will see the points but not the entries behind them.`)) void run(() => api("POST", `/ai/outputs/${o.id}/publish`, { acknowledgeSimulated: true }), "Shared with the class. Manage it on the Sharing tab."); }}>{o.published ? "Update the shared copy" : "Share with the class"}</Button>}
          {!o.published && <Button variant="danger" disabled={archived} onClick={() => { if (confirm("Discard this draft?")) void run(() => api("DELETE", `/ai/outputs/${o.id}`), "Draft discarded."); }}>Discard</Button>}
        </div>
        {o.kind !== "discussion_points" && !o.reviewed && <p className="mt-2 text-sm">You need to mark the draft as reviewed before you can share it.</p>}
        <p className="mt-1 text-xs">Generation never shares anything by itself. Sharing a summary and revealing a question are separate actions.</p>
      </Card>
    </li>
  );
}
