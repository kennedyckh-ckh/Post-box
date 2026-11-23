"use client";
import { useCallback, useEffect, useState } from "react";
import { api, errText } from "@/lib/client/api";
import { Card, Button, Alert, Badge, Field, TextField, inputCls } from "@/components/ui";
import { TableView } from "@/components/participant/entry-view";
import type { Detail, Act } from "./types";

interface Pub {
  id: string; sourceType: string; sourceId: string; status: "published" | "unpublished"; labelMode: "group" | "anonymous"; labelNo: number; present: boolean; publishedAt: number; updatedAt: number; differsFromSource: boolean;
  internal: { groupName: string | null; authors: { id: string; name: string }[] };
  preview: { label: string; stageTitle: string; entries: { questionText: string | null; body: string; table: { columns: string[]; rows: string[][] } | null; tags: string[]; attachmentId: string | null }[]; synthesis: string | null };
  reactions: { total: number; byType: Record<string, number> };
}
interface Cm { id: string; targetType: string; authorName: string; groupName: string | null; promptKey: string; body: string; status: string; createdAt: number }
interface Pres { hasLink: boolean; showSummaries: boolean; revealedQuestions: string[] }

export function SharingTab({ d, act }: { d: Detail; act: Act }) {
  const sid = d.session.id;
  const archived = d.session.status === "archived";
  const [items, setItems] = useState<Pub[] | null>(null);
  const [types, setTypes] = useState<{ key: string; label: string }[]>([]);
  const [sort, setSort] = useState("recent");
  const [comments, setComments] = useState<Cm[]>([]);
  const [pres, setPres] = useState<Pres | null>(null);
  const [link, setLink] = useState("");
  const [err, setErr] = useState("");
  const [preview, setPreview] = useState<Pub | null>(null);

  const load = useCallback(async () => {
    try {
      const [p, c, pr] = await Promise.all([
        api<{ items: Pub[]; reactionTypes: { key: string; label: string }[] }>("GET", `/sessions/${sid}/publications?sort=${encodeURIComponent(sort)}`),
        api<{ comments: Cm[] }>("GET", `/sessions/${sid}/comments`),
        api<Pres>("GET", `/sessions/${sid}/presentation`),
      ]);
      setItems(p.items); setTypes(p.reactionTypes); setComments(c.comments); setPres(pr); setErr("");
    } catch (e) { setErr(errText(e)); }
  }, [sid, sort]);
  useEffect(() => { void load(); const t = setInterval(load, 8000); return () => clearInterval(t); }, [load]);
  const run: Act = async (fn, ok) => { await act(fn, ok); await load(); };

  return (
    <div className="space-y-6">
      {err && <Alert kind="error">{err}</Alert>}

      <Card>
        <h2 className="mb-1 text-xl font-semibold">Shared with the class</h2>
        <p className="mb-3 text-sm text-slate-800">Choose what to share from the Contributions tab (single entries) or the Progress tab (a group's submitted version). A shared item is a frozen copy: later edits stay private until you update it. Nothing is shared automatically.</p>
        <div className="mb-3 flex flex-wrap items-end gap-3">
          <Field label="Show shared items in order of">
            {(id) => <select id={id} className={inputCls} value={sort} onChange={(e) => setSort(e.target.value)}><option value="recent">When shared</option><option value="reactions">Most reactions in total</option>{types.map((t) => <option key={t.key} value={`type:${t.key}`}>Most “{t.label}”</option>)}</select>}
          </Field>
          <div className="mb-4 flex gap-2">
            <Button variant="secondary" disabled={archived} onClick={() => void run(() => api("POST", `/sessions/${sid}/label-mode`, { mode: "anonymous" }), "All shared items now use anonymous labels (Sample Response 1, 2, …).")}>Use anonymous labels</Button>
            <Button variant="secondary" disabled={archived} onClick={() => void run(() => api("POST", `/sessions/${sid}/label-mode`, { mode: "group" }), "All shared items now show the group name.")}>Show group names</Button>
          </div>
        </div>
        <Alert kind="info">Reaction counts show engagement, not whether an answer is correct. Anonymous labels hide names, but the text or pictures themselves may still identify someone: check the preview before sharing.</Alert>
        {!items ? <p role="status">Loading…</p> : items.length === 0 ? <p>Nothing shared yet.</p> : (
          <ul className="space-y-3">
            {items.map((it) => (
              <li key={it.id} className="rounded-lg border border-line p-3">
                <div className="flex flex-wrap items-center gap-2">
                  <strong>{it.preview.label}</strong>
                  <Badge tone={it.status === "published" ? "green" : "gray"}>{it.status === "published" ? "Shared" : "Not shared (unpublished)"}</Badge>
                  <Badge>{it.sourceType === "submission" ? "Group submission" : "Entry"}</Badge>
                  <Badge>{it.labelMode === "anonymous" ? "Anonymous label" : "Group label"}</Badge>
                  {it.differsFromSource && <Badge tone="amber">Source has changed since sharing</Badge>}
                  {it.present && <Badge tone="blue">On the projector</Badge>}
                </div>
                <p className="mt-1 text-sm">Private to you: {it.internal.authors.map((a) => a.name).join(", ") || "unknown"} · {it.internal.groupName ?? "no group"} · {it.preview.stageTitle} · {it.reactions.total} reactions</p>
                <div className="mt-2 flex flex-wrap gap-2">
                  <Button variant="secondary" onClick={() => setPreview(preview?.id === it.id ? null : it)}>{preview?.id === it.id ? "Hide preview" : "Preview what the class sees"}</Button>
                  {(it.differsFromSource || it.status === "unpublished") && <Button variant="secondary" disabled={archived} onClick={() => { if (confirm(it.status === "unpublished" ? "Share this again with the current version?" : "Update the shared copy to the current version? The class will see the new text.")) void run(() => api("POST", `/sessions/${sid}/publications`, { sourceType: it.sourceType, sourceId: it.sourceId, labelMode: it.labelMode }), "Shared copy updated."); }}>{it.status === "unpublished" ? "Share again" : "Update shared copy"}</Button>}
                  {it.status === "published" && <Button variant="secondary" disabled={archived} onClick={() => void run(() => api("POST", `/publications/${it.id}/present`, { present: !it.present }), it.present ? "Removed from the projector." : "Approved for the projector.")}>{it.present ? "Remove from projector" : "Show on projector"}</Button>}
                  {it.status === "published" && <Button variant="danger" disabled={archived} onClick={() => { if (confirm("Stop sharing this? It disappears from the class board and projector. It cannot take back screenshots or anything already downloaded.")) void run(() => api("POST", `/publications/${it.id}/unpublish`, {}), "Stopped sharing."); }}>Stop sharing</Button>}
                </div>
                {preview?.id === it.id && (
                  <div className="mt-3 rounded-lg bg-slate-50 p-3" aria-label="Preview of what participants see">
                    <p className="mb-2 text-sm font-semibold">Preview: this is exactly what participants see.</p>
                    {it.preview.entries.map((e, i) => <div key={i} className="mb-2">{e.questionText && <p className="text-sm font-semibold">{e.questionText}</p>}<p className="whitespace-pre-wrap">{e.body}</p>{e.table && <TableView table={e.table} />}{e.attachmentId && <p className="text-sm">[A picture is included]</p>}</div>)}
                    {it.preview.synthesis && <p><strong>Group response:</strong> {it.preview.synthesis}</p>}
                  </div>
                )}
              </li>
            ))}
          </ul>
        )}
      </Card>

      <Card>
        <h2 className="mb-2 text-xl font-semibold">Peer responses waiting for you</h2>
        {comments.length === 0 ? <p>No peer responses yet.</p> : (
          <ul className="space-y-2">
            {comments.map((c) => (
              <li key={c.id} className="rounded-lg border border-line p-3 text-sm">
                <p><strong>{c.authorName}</strong> ({c.groupName ?? "no group"}) · {c.targetType === "publication" ? "on shared item" : "inside a group"} · <Badge tone={c.status === "approved" ? "green" : c.status === "hidden" ? "red" : "amber"}>{c.status === "pending" ? "Waiting for approval" : c.status === "approved" ? "Visible" : "Hidden"}</Badge></p>
                <p className="my-1 whitespace-pre-wrap">{c.body}</p>
                <div className="flex gap-2">
                  {c.status !== "approved" && <Button variant="secondary" disabled={archived} onClick={() => void run(() => api("POST", `/comments/${c.id}/moderate`, { status: "approved" }))}>Approve</Button>}
                  {c.status !== "hidden" && <Button variant="secondary" disabled={archived} onClick={() => void run(() => api("POST", `/comments/${c.id}/moderate`, { status: "hidden" }))}>Hide</Button>}
                </div>
              </li>
            ))}
          </ul>
        )}
      </Card>

      <EngagementSettings d={d} act={act} />

      <Card>
        <h2 className="mb-2 text-xl font-semibold">Projector view</h2>
        <p className="mb-3 text-sm">A full-screen, large-text view for the room: the join code with a QR code, each part's revealed questions, progress by group, and the items you approve with “Show on projector”, with the same labels the class sees.</p>
        <div className="mb-5 flex flex-wrap items-center gap-3 rounded-xl bg-surface-2 p-4 ring-1 ring-line">
          <a href={`/facilitator/sessions/${sid}/projector`} target="_blank" rel="noopener noreferrer" className="inline-flex min-h-11 items-center justify-center rounded-lg bg-accent px-4 text-sm font-semibold text-white transition hover:bg-[#9a5622]">Open projector view <span className="sr-only">(opens in a new window)</span></a>
          <p className="text-sm text-muted">On this computer, signed in as you. Drag the window to the room screen and press F for full screen.</p>
        </div>
        <h3 className="mb-1 font-semibold">Show it on another device</h3>
        <p className="mb-3 text-sm">A separate link that needs no sign-in, for a room computer you are not signed in on. It shows shared items, summaries and discussion questions only. Anyone with the link can view it, so replace or switch off the link when you are done.</p>
        {link && <Alert kind="warning">Projector link (shown once): <span className="select-all break-all font-mono">{typeof window !== "undefined" ? window.location.origin : ""}{link}</span> <a className="ml-2 font-semibold underline" href={link} target="_blank" rel="noopener noreferrer">Open it</a></Alert>}
        <div className="flex flex-wrap gap-2">
          <Button disabled={archived} onClick={() => void run(async () => { const r = await api<{ path: string }>("POST", `/sessions/${sid}/presentation/link`, {}); setLink(r.path); }, pres?.hasLink ? "New projector link created. The old one stopped working." : "Projector link created.")}>{pres?.hasLink ? "Make a new link (switches the old one off)" : "Create projector link"}</Button>
          {pres?.hasLink && <Button variant="secondary" onClick={() => void run(async () => { await api("POST", `/sessions/${sid}/presentation/revoke`, {}); setLink(""); }, "Projector link switched off.")}>Switch the link off</Button>}
        </div>
        <fieldset className="mt-4">
          <legend className="mb-1 text-sm font-semibold">What else the projector shows (separate switches)</legend>
          <label className="flex min-h-11 items-center gap-2"><input type="checkbox" className="h-5 w-5" checked={!!pres?.showSummaries} disabled={archived} onChange={(e) => void run(() => api("POST", `/sessions/${sid}/presentation`, { showSummaries: e.target.checked }))} /> Show group summaries (only summaries you have published)</label>
          <p className="text-sm">Discussion questions are revealed one at a time from the AI analysis tab, once you have generated and reviewed them.</p>
        </fieldset>
      </Card>

      <Card>
        <h2 className="mb-2 text-xl font-semibold">Export session data</h2>
        <p className="mb-3 text-sm">Original participant work, your setup, and any AI content are kept in separate sections. Files such as pictures are referenced by id, not embedded. No PINs, codes or keys are ever included.</p>
        <div className="grid gap-4 sm:grid-cols-2">
          <div><h3 className="font-semibold">With names (identified)</h3><p className="mb-2 text-sm">Includes names and optional fields such as Class. Handle under your data policy.</p>
            <div className="flex flex-wrap gap-2"><a className="inline-flex min-h-11 items-center rounded-lg border border-line-strong bg-surface px-3 text-sm font-semibold text-brand-strong transition hover:border-brand hover:bg-brand-soft" href={`/api/sessions/${sid}/export?format=json&identified=true`}>JSON</a>{["entries", "comments", "submissions", "participants"].map((t) => <a key={t} className="inline-flex min-h-11 items-center rounded-lg border border-line-strong bg-surface px-3 text-sm font-semibold text-brand-strong transition hover:border-brand hover:bg-brand-soft" href={`/api/sessions/${sid}/export?format=csv&identified=true&table=${t}`}>CSV: {t}</a>)}</div></div>
          <div><h3 className="font-semibold">Without names (de-identified)</h3><p className="mb-2 text-sm">Names become P001, G1… Free text and pictures may still identify people.</p>
            <div className="flex flex-wrap gap-2"><a className="inline-flex min-h-11 items-center rounded-lg border border-line-strong bg-surface px-3 text-sm font-semibold text-brand-strong transition hover:border-brand hover:bg-brand-soft" href={`/api/sessions/${sid}/export?format=json&identified=false`}>JSON</a>{["entries", "comments", "submissions"].map((t) => <a key={t} className="inline-flex min-h-11 items-center rounded-lg border border-line-strong bg-surface px-3 text-sm font-semibold text-brand-strong transition hover:border-brand hover:bg-brand-soft" href={`/api/sessions/${sid}/export?format=csv&identified=false&table=${t}`}>CSV: {t}</a>)}</div></div>
        </div>
      </Card>
    </div>
  );
}

function EngagementSettings({ d, act }: { d: Detail; act: Act }) {
  const s = d.session;
  type RC = { enabled: boolean; scope: string; types: { key?: string; label: string }[] };
  type CC = { enabled: boolean; scope: string; requireApproval: boolean; prompts: { key?: string; label: string; enabled: boolean }[] };
  const [r, setR] = useState<RC>(s.reactionConfig);
  const [c, setC] = useState<CC>(s.critiqueConfig);
  const archived = s.status === "archived";
  const scopeSel = (v: string, on: (x: string) => void, label: string) => (
    <Field label={label}>{(id) => <select id={id} className={inputCls} value={v} onChange={(e) => on(e.target.value)}><option value="both">Inside groups and on shared items</option><option value="group">Inside groups only</option><option value="published">On shared items only</option></select>}</Field>
  );
  return (
    <div className="grid gap-6 lg:grid-cols-2">
      <Card>
        <h2 className="mb-2 text-xl font-semibold">Reactions</h2>
        <label className="mb-3 flex min-h-11 items-center gap-2"><input type="checkbox" className="h-5 w-5" checked={r.enabled} onChange={(e) => setR({ ...r, enabled: e.target.checked })} /> Allow reactions</label>
        {scopeSel(r.scope, (x) => setR({ ...r, scope: x }), "Where reactions are allowed")}
        <p className="mb-1 text-sm font-semibold">Reaction types (up to 6)</p>
        {r.types.map((t, i) => <div key={i} className="mb-2 flex gap-2"><input aria-label={`Reaction ${i + 1} label`} className={inputCls} maxLength={20} value={t.label} onChange={(e) => setR({ ...r, types: r.types.map((x, j) => (j === i ? { ...x, label: e.target.value } : x)) })} /><Button variant="secondary" onClick={() => setR({ ...r, types: r.types.filter((_, j) => j !== i) })}>Remove</Button></div>)}
        {r.types.length < 6 && <Button variant="secondary" onClick={() => setR({ ...r, types: [...r.types, { label: "" }] })}>Add a type</Button>}
        <div className="mt-3"><Button disabled={archived} onClick={() => void act(() => api("PATCH", `/sessions/${s.id}`, { reactionConfig: { ...r, types: r.types.filter((t) => t.label.trim()) } }), "Reaction settings saved.")}>Save reaction settings</Button></div>
      </Card>
      <Card>
        <h2 className="mb-2 text-xl font-semibold">Structured peer responses</h2>
        <label className="mb-3 flex min-h-11 items-center gap-2"><input type="checkbox" className="h-5 w-5" checked={c.enabled} onChange={(e) => setC({ ...c, enabled: e.target.checked })} /> Allow peer responses</label>
        {scopeSel(c.scope, (x) => setC({ ...c, scope: x }), "Where peer responses are allowed")}
        <label className="mb-3 flex min-h-11 items-center gap-2"><input type="checkbox" className="h-5 w-5" checked={c.requireApproval} onChange={(e) => setC({ ...c, requireApproval: e.target.checked })} /> I approve responses on shared items before the class sees them</label>
        <p className="mb-1 text-sm font-semibold">Response prompts (up to 8)</p>
        {c.prompts.map((p, i) => <div key={i} className="mb-2 flex flex-wrap items-center gap-2"><input aria-label={`Prompt ${i + 1}`} className={`${inputCls} max-w-xs`} maxLength={80} value={p.label} onChange={(e) => setC({ ...c, prompts: c.prompts.map((x, j) => (j === i ? { ...x, label: e.target.value } : x)) })} /><label className="flex min-h-11 items-center gap-1 text-sm"><input type="checkbox" className="h-5 w-5" checked={p.enabled} onChange={(e) => setC({ ...c, prompts: c.prompts.map((x, j) => (j === i ? { ...x, enabled: e.target.checked } : x)) })} /> On</label><Button variant="secondary" onClick={() => setC({ ...c, prompts: c.prompts.filter((_, j) => j !== i) })}>Remove</Button></div>)}
        {c.prompts.length < 8 && <Button variant="secondary" onClick={() => setC({ ...c, prompts: [...c.prompts, { label: "", enabled: true }] })}>Add a prompt</Button>}
        <div className="mt-3"><Button disabled={archived} onClick={() => void act(() => api("PATCH", `/sessions/${s.id}`, { critiqueConfig: { ...c, prompts: c.prompts.filter((p) => p.label.trim()) } }), "Peer response settings saved.")}>Save peer response settings</Button></div>
      </Card>
    </div>
  );
}

void TextField;
