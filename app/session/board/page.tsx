"use client";
import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { api, errText, ApiError } from "@/lib/client/api";
import { Shell, Card, Alert, Badge, LogoffButton } from "@/components/ui";
import { TableView } from "@/components/participant/entry-view";
import { ReactionBar, CommentList, CommentBox, type ReactionSummary, type CommentView, type Types } from "@/components/participant/engagement";

interface Item {
  id: string; label: string; kind: string; stageTitle: string; revision: number | null;
  entries: { questionText: string | null; kind: string; body: string; tags: string[]; table: { columns: string[]; rows: string[][] } | null; attachmentId: string | null }[];
  synthesis: string | null; reactions: ReactionSummary; comments: CommentView[];
  ai: { overview: string; points: { heading: string; text: string; kind: string }[]; simulated: boolean; label: string } | null;
}
interface Board { title: string; questions: { id: string; text: string }[]; reactions: { enabled: boolean; types: Types[] }; critique: { enabled: boolean; prompts: { key: string; label: string }[] }; items: Item[] }

export default function BoardPage() {
  const [b, setB] = useState<Board | null>(null);
  const [error, setError] = useState("");
  const load = useCallback(async () => {
    try { setB(await api<Board>("GET", "/board")); setError(""); } catch (e) { if (e instanceof ApiError && e.status === 401) window.location.href = "/recover"; else setError(errText(e)); }
  }, []);
  useEffect(() => { void load(); const t = setInterval(load, 6000); return () => clearInterval(t); }, [load]);
  if (!b) return <Shell title="Class board">{error ? <Alert kind="error">{error}</Alert> : <p role="status">Loading…</p>}</Shell>;
  return (
    <Shell wide right={<LogoffButton />}>
      <p className="mb-3"><Link href="/session" className="underline">← My session</Link></p>
      <h1 className="mb-2 text-3xl font-bold text-brand-strong">Shared with the class</h1>
      <p className="mb-6 text-slate-800">Your facilitator chose these items to share. Names are not shown unless your facilitator chose to show a group name.</p>
      {error && <Alert kind="error">{error}</Alert>}
      {b.questions.length > 0 && (
        <Card className="mb-6" label="Discussion questions">
          <h2 className="mb-2 text-xl font-semibold">Questions to discuss</h2>
          <ul className="list-disc space-y-1 pl-6 text-lg">{b.questions.map((q) => <li key={q.id}>{q.text}</li>)}</ul>
        </Card>
      )}
      {b.items.length === 0 ? <Card><p>Nothing has been shared yet. Items appear here when your facilitator shares them.</p></Card> : (
        <ul className="space-y-4">
          {b.items.map((it) => (
            <li key={it.id}>
              <Card as="div">
                <div className="mb-2 flex flex-wrap items-center gap-2"><h2 className="text-xl font-semibold">{it.label}</h2><Badge>{it.stageTitle}</Badge>{it.kind === "submission" && <Badge tone="blue">Group submission</Badge>}</div>
                <div className="space-y-3">
                  {it.entries.map((e, i) => (
                    <div key={i}>
                      {e.questionText && <p className="text-sm font-semibold text-brand-strong">Responding to: {e.questionText}</p>}
                      {e.body && <p className="whitespace-pre-wrap break-words">{e.body}</p>}
                      {e.table && <TableView table={e.table} />}
                      {e.attachmentId && (
                        // eslint-disable-next-line @next/next/no-img-element
                        <img src={`/api/attachments/${e.attachmentId}`} alt="Picture shared with the class" className="mt-2 max-h-72 max-w-full rounded-lg border border-line" />
                      )}
                      {e.tags.length > 0 && <p className="mt-1 flex flex-wrap gap-1">{e.tags.map((t) => <Badge key={t} tone="blue">{t}</Badge>)}</p>}
                    </div>
                  ))}
                  {it.ai && (
                    <div className="rounded-lg bg-indigo-50 p-3">
                      <p className="mb-1 text-sm font-semibold">{it.ai.label}</p>
                      <p className="mb-2">{it.ai.overview}</p>
                      <ul className="list-disc space-y-1 pl-5">{it.ai.points.map((p, i) => <li key={i}><strong>{p.heading}:</strong> {p.text}</li>)}</ul>
                    </div>
                  )}
                  {it.synthesis && <p className="rounded-lg bg-indigo-50 p-3"><strong>Group response:</strong> {it.synthesis}</p>}
                </div>
                {b.reactions.enabled && <ReactionBar targetType="publication" targetId={it.id} types={b.reactions.types} summary={it.reactions} onChange={load} />}
                <CommentList comments={it.comments} onChange={load} />
                {b.critique.enabled && <CommentBox targetType="publication" targetId={it.id} prompts={b.critique.prompts} onPosted={load} />}
              </Card>
            </li>
          ))}
        </ul>
      )}
    </Shell>
  );
}
