"use client";
import { useCallback, useEffect, useState } from "react";
import { api, errText } from "@/lib/client/api";
import { Card, Button, Alert, Badge, Field, inputCls } from "@/components/ui";
import { TableView, timeText } from "@/components/participant/entry-view";
import type { Detail, Act } from "./types";
import type { TableData } from "@/components/participant/types";

interface E { reactions?: { total: number; byType: Record<string, number> }; id: string; groupId: string; stageId: string; questionId: string | null; authorId: string; authorName: string; kind: "text" | "table"; body: string; tags: string[]; table: TableData | null; attachmentId: string | null; version: number; updatedAt: number; hidden: boolean }

export function ContributionsTab({ d, act }: { d: Detail; act: Act }) {
  const [stageId, setStageId] = useState("");
  const [groupId, setGroupId] = useState("");
  const [sort, setSort] = useState("");
  const [entries, setEntries] = useState<E[] | null>(null);
  const [err, setErr] = useState("");
  const load = useCallback(() => {
    const q = new URLSearchParams();
    if (stageId) q.set("stageId", stageId);
    if (groupId) q.set("groupId", groupId);
    if (sort) q.set("sort", sort);
    return api<{ entries: E[] }>("GET", `/sessions/${d.session.id}/entries?${q}`).then((r) => { setEntries(r.entries); setErr(""); }).catch((e) => setErr(errText(e)));
  }, [d.session.id, stageId, groupId, sort]);
  useEffect(() => { void load(); const t = setInterval(load, 6000); return () => clearInterval(t); }, [load]);
  const gname = (id: string) => d.groups.find((g) => g.id === id)?.name ?? "?";
  const sname = (id: string) => d.stages.find((s) => s.id === id)?.title ?? "?";

  return (
    <div>
      <Card className="mb-4">
        <div className="grid gap-x-4 sm:grid-cols-3">
          <Field label="Order">{(id) => <select id={id} className={inputCls} value={sort} onChange={(e) => setSort(e.target.value)}><option value="">Oldest first</option><option value="reactions">Most reactions (engagement, not correctness)</option>{d.session.reactionConfig.types.map((t) => <option key={t.key} value={`type:${t.key}`}>Most “{t.label}”</option>)}</select>}</Field>
          <Field label="Part">{(id) => <select id={id} className={inputCls} value={stageId} onChange={(e) => setStageId(e.target.value)}><option value="">All parts</option>{d.stages.map((s) => <option key={s.id} value={s.id}>{s.title}</option>)}</select>}</Field>
          <Field label="Group">{(id) => <select id={id} className={inputCls} value={groupId} onChange={(e) => setGroupId(e.target.value)}><option value="">All groups</option>{d.groups.map((g) => <option key={g.id} value={g.id}>{g.name}</option>)}</select>}</Field>
        </div>
        <p className="text-sm text-slate-700">You see every group's entries with the author's name. Participants only ever see their own group's entries until you share something.</p>
      </Card>
      {err && <Alert kind="error">{err}</Alert>}
      {!entries ? <p role="status">Loading…</p> : entries.length === 0 ? <Card><p>No contributions yet.</p></Card> : (
        <ul className="space-y-3">
          {entries.map((e) => (
            <li key={e.id}>
              <Card as="div">
                <div className="mb-1 flex flex-wrap items-center justify-between gap-2 text-sm">
                  <span><strong>{e.authorName}</strong> · {gname(e.groupId)} · {sname(e.stageId)} · {timeText(e.updatedAt)} · version {e.version} {e.reactions && e.reactions.total > 0 && <Badge>{e.reactions.total} reactions</Badge>} {e.hidden && <Badge tone="red">Hidden from group</Badge>}</span>
                  <span className="flex flex-wrap gap-2">
                    <Button variant="secondary" disabled={d.session.status === "archived" || e.hidden} onClick={() => { if (confirm("Share this entry with the whole class? It becomes a frozen copy. Check the text for anything that could identify someone.")) void act(() => api("POST", `/sessions/${d.session.id}/publications`, { sourceType: "entry", sourceId: e.id, labelMode: d.session.anonymiseDefault ? "anonymous" : "group" }), "Shared with the class. Manage it on the Sharing tab."); }}>Share with class</Button>
                    <Button variant="secondary" disabled={d.session.status === "archived"} onClick={() => void act(() => api("POST", `/entries/${e.id}/hide`, { hidden: !e.hidden }), e.hidden ? "Entry is visible to the group again." : "Entry hidden from the group.").then(load)}>{e.hidden ? "Show to group again" : "Hide from group"}</Button>
                  </span>
                </div>
                {e.body && <p className="whitespace-pre-wrap break-words">{e.body}</p>}
                {e.table && <TableView table={e.table} />}
                {e.attachmentId && (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img src={`/api/attachments/${e.attachmentId}`} alt={`Picture by ${e.authorName}`} className="mt-2 max-h-60 rounded border border-line" />
                )}
                {e.tags.length > 0 && <p className="mt-2 flex flex-wrap gap-1">{e.tags.map((t) => <Badge key={t} tone="blue">{t}</Badge>)}</p>}
              </Card>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
