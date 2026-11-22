"use client";
import { useState } from "react";
import { api, errText } from "@/lib/client/api";
import { Button, Alert, inputCls } from "@/components/ui";

export interface ReactionSummary { counts: Record<string, number>; mine: string[]; total: number }
export interface CommentView { id: string; author: string; mine: boolean; promptKey: string; body: string; status: string; createdAt: number }
export interface Types { key: string; label: string }

/** One reaction of each type per person. Counts are a sign of engagement, not of whether an answer is right. */
export function ReactionBar({ targetType, targetId, types, summary, onChange }: { targetType: "entry" | "publication"; targetId: string; types: Types[]; summary?: ReactionSummary; onChange: () => void }) {
  const [err, setErr] = useState("");
  const s = summary ?? { counts: {}, mine: [], total: 0 };
  return (
    <div className="mt-2" role="group" aria-label="Reactions">
      <div className="flex flex-wrap gap-2">
        {types.map((t) => {
          const on = s.mine.includes(t.key);
          return (
            <button key={t.key} type="button" aria-pressed={on} className={`min-h-11 rounded-full border px-3 text-sm font-semibold ${on ? "border-brand bg-brand text-white" : "border-brand bg-white text-brand-strong"}`}
              onClick={async () => { setErr(""); try { await api("POST", "/reactions", { targetType, targetId, type: t.key, on: !on }); onChange(); } catch (e) { setErr(errText(e)); } }}>
              {on ? "✓ " : ""}{t.label} <span aria-label={`${s.counts[t.key] ?? 0} people`}>({s.counts[t.key] ?? 0})</span>
            </button>
          );
        })}
      </div>
      {err && <p role="alert" className="mt-1 text-sm text-red-800">{err}</p>}
    </div>
  );
}

export function CommentList({ comments, onChange }: { comments: CommentView[]; onChange: () => void }) {
  if (!comments.length) return null;
  return (
    <ul className="mt-3 space-y-2" aria-label="Peer responses">
      {comments.map((c) => (
        <li key={c.id} className="rounded-lg border border-line bg-slate-50 p-3 text-sm">
          <p className="font-semibold">{c.author} {c.status === "pending" && <span className="font-normal">(waiting for your facilitator to approve)</span>}</p>
          <p className="whitespace-pre-wrap break-words">{c.body}</p>
          {c.mine && <Button variant="secondary" className="mt-1" onClick={async () => { if (confirm("Withdraw your response?")) { await api("DELETE", `/comments/${c.id}`).catch(() => {}); onChange(); } }}>Withdraw</Button>}
        </li>
      ))}
    </ul>
  );
}

/** A structured peer response: pick one of the facilitator's prompts, then write. It sits beside the entry, never inside it. */
export function CommentBox({ targetType, targetId, prompts, onPosted }: { targetType: "entry" | "publication"; targetId: string; prompts: { key: string; label: string }[]; onPosted: () => void }) {
  const [open, setOpen] = useState(false);
  const [key, setKey] = useState(prompts[0]?.key ?? "");
  const [body, setBody] = useState("");
  const [err, setErr] = useState("");
  const [note, setNote] = useState("");
  if (!prompts.length) return null;
  if (!open) return <Button variant="secondary" className="mt-2" onClick={() => setOpen(true)}>Respond to this</Button>;
  return (
    <form className="mt-3 rounded-lg border border-line p-3" onSubmit={async (e) => { e.preventDefault(); setErr(""); try { const r = await api<{ status: string }>("POST", "/comments", { targetType, targetId, promptKey: key, body }); setBody(""); setOpen(false); setNote(r.status === "pending" ? "Sent. It will appear once your facilitator approves it." : ""); onPosted(); } catch (er) { setErr(errText(er)); } }}>
      {err && <Alert kind="error">{err}</Alert>}
      {note && <Alert kind="info">{note}</Alert>}
      <label className="mb-1 block text-sm font-semibold" htmlFor={`p-${targetId}`}>What kind of response?</label>
      <select id={`p-${targetId}`} className={`${inputCls} mb-2`} value={key} onChange={(e) => setKey(e.target.value)}>{prompts.map((p) => <option key={p.key} value={p.key}>{p.label}</option>)}</select>
      <label className="mb-1 block text-sm font-semibold" htmlFor={`b-${targetId}`}>Your response</label>
      <textarea id={`b-${targetId}`} className={`${inputCls} min-h-20`} maxLength={1000} value={body} onChange={(e) => setBody(e.target.value)} />
      <div className="mt-2 flex gap-2"><Button type="submit" disabled={!body.trim()}>Send response</Button><Button variant="secondary" onClick={() => setOpen(false)}>Cancel</Button></div>
    </form>
  );
}
