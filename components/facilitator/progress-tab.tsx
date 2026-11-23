"use client";
import { useCallback, useEffect, useState } from "react";
import { api, errText, ApiError } from "@/lib/client/api";
import { Card, Button, Alert, Badge } from "@/components/ui";
import type { Detail, Act } from "./types";

interface Overview {
  groups: { id: string; name: string; members: number }[];
  stages: { id: string; title: string; position: number; enabled: boolean; availability: string; expected: number; submitted: number; missing: { id: string; name: string }[] }[];
  cells: { groupId: string; stageId: string; status: "draft" | "submitted" | "reopened"; revision: number; submittedAt: number | null; submittedByName: string | null; entryCount: number; excluded: boolean; empty: boolean; expected: boolean }[];
}
interface Snap { id: string; groupId: string; stageId: string; revision: number; submittedBy: string; submittedAt: number; reopenedAt: number | null; reopenNote: string | null; snapshot: { entries: { authorName: string; body: string; tags: string[]; table: { columns: string[]; rows: string[][] } | null; questionText: string | null }[]; synthesis: { body: string } | null } | null }

const STATUS = { draft: "Draft", submitted: "Submitted", reopened: "Reopened (being revised)" } as const;

export function ProgressTab({ d, act }: { d: Detail; act: Act }) {
  const [ov, setOv] = useState<Overview | null>(null);
  const [err, setErr] = useState("");
  const [snaps, setSnaps] = useState<{ title: string; list: Snap[] } | null>(null);
  const archived = d.session.status === "archived";
  const live = d.session.status === "live";
  const load = useCallback(() => api<Overview>("GET", `/sessions/${d.session.id}/overview`).then((r) => { setOv(r); setErr(""); }).catch((e) => setErr(errText(e))), [d.session.id]);
  useEffect(() => { void load(); const t = setInterval(load, 6000); return () => clearInterval(t); }, [load]);
  const run: Act = async (fn, ok) => { await act(fn, ok); await load(); };

  async function openStage(stageId: string, title: string) {
    if (!confirm(`Open ${title} for all groups? Nothing is published and no other part changes.`)) return;
    await run(async () => {
      try { await api("PATCH", `/stages/${stageId}`, { availability: "open" }); } catch (e) {
        if (e instanceof ApiError && e.code === "groups_not_submitted") {
          const names = ((e.data.missing as { name: string }[]) || []).map((m) => m.name).join(", ");
          const reason = prompt(`${e.message}\nNot yet submitted: ${names}\n\nType a reason to open it anyway (this is recorded):`);
          if (!reason || !reason.trim()) throw new Error("Not opened. The groups above have not submitted yet.");
          await api("PATCH", `/stages/${stageId}`, { availability: "open", proceedReason: reason.trim() });
        } else throw e;
      }
    }, `${title} is now open.`);
  }

  async function showVersions(groupId: string, stageId: string, label: string) {
    try { const r = await api<{ submissions: Snap[] }>("GET", `/sessions/${d.session.id}/submissions?groupId=${groupId}&stageId=${stageId}`); setSnaps({ title: label, list: r.submissions }); } catch (e) { setErr(errText(e)); }
  }

  if (!ov) return err ? <Alert kind="error">{err}</Alert> : <p role="status">Loading…</p>;
  const enabledStages = ov.stages.filter((s) => s.enabled);
  return (
    <div>
      {err && <Alert kind="error">{err}</Alert>}
      <div className="mb-4 grid gap-3 sm:grid-cols-3">
        {enabledStages.map((s, i) => (
          <Card key={s.id} as="div">
            <h2 className="font-semibold">{s.title}</h2>
            <p className="mt-1 text-2xl font-bold" aria-label={`${s.submitted} of ${s.expected} expected groups have submitted`}>{s.submitted} of {s.expected} <span className="text-base font-normal">groups submitted</span></p>
            <p className="mt-1 text-sm"><Badge tone={s.availability === "open" ? "green" : s.availability === "closed" ? "amber" : "gray"}>{s.availability === "open" ? "Open" : s.availability === "closed" ? "Closed" : "Locked"}</Badge></p>
            {s.missing.length > 0 && <p className="mt-2 text-sm">Waiting for: {s.missing.map((m) => m.name).join(", ")}</p>}
            {i > 0 && s.availability === "locked" && <div className="mt-3"><Button disabled={!live} onClick={() => void openStage(s.id, s.title)}>Open {s.title}</Button></div>}
          </Card>
        ))}
      </div>
      <p className="mb-3 text-sm text-slate-700">Empty groups and groups left out of a part are not counted as expected, so they never block progress. Submitting does not open the next part: you do that.</p>
      <Card>
        <div className="overflow-x-auto">
          <table className="w-full text-left text-sm">
            <caption className="sr-only">Submission status of each group in each part</caption>
            <thead><tr className="border-b border-line"><th scope="col" className="p-2">Group</th>{enabledStages.map((s) => <th key={s.id} scope="col" className="p-2">{s.title}</th>)}</tr></thead>
            <tbody>
              {ov.groups.map((g) => (
                <tr key={g.id} className="border-b border-line align-top">
                  <th scope="row" className="p-2">{g.name}<br /><span className="font-normal">{g.members} member{g.members === 1 ? "" : "s"}</span></th>
                  {enabledStages.map((s) => {
                    const c = ov.cells.find((x) => x.groupId === g.id && x.stageId === s.id)!;
                    return (
                      <td key={s.id} className="p-2">
                        {c.excluded ? <Badge>Left out</Badge> : c.empty ? <Badge>No members</Badge> : <Badge tone={c.status === "submitted" ? "green" : c.status === "reopened" ? "amber" : "gray"}>{STATUS[c.status]}{c.revision > 0 ? ` · version ${c.revision}` : ""}</Badge>}
                        <p className="mt-1">{c.entryCount} entries</p>
                        {c.submittedByName && <p className="text-xs">by {c.submittedByName}</p>}
                        <div className="mt-1 flex flex-wrap gap-1">
                          {c.status === "submitted" && <Button variant="secondary" disabled={archived} onClick={() => { const note = prompt(`Reopen ${g.name}'s ${s.title} for revision? Other groups are not affected, and the submitted version is kept.\nOptional note for the record:`); if (note !== null) void run(() => api("POST", `/groups/${g.id}/stages/${s.id}/reopen`, { note }), "Reopened for that group only."); }}>Reopen</Button>}
                          {c.revision > 0 && <Button variant="secondary" onClick={() => void showVersions(g.id, s.id, `${g.name}, ${s.title}`)}>Versions</Button>}
                        </div>
                      </td>
                    );
                  })}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Card>
      {snaps && (
        <Card className="mt-4" label="Submitted versions">
          <div className="mb-2 flex items-center justify-between"><h3 className="text-lg font-semibold">Submitted versions: {snaps.title}</h3><Button variant="secondary" onClick={() => setSnaps(null)}>Close</Button></div>
          {snaps.list.length === 0 ? <p>No versions yet.</p> : snaps.list.map((v) => (
            <details key={v.id} className="mb-2 rounded-lg border border-line p-3" open={v === snaps.list[0]}>
              <summary className="cursor-pointer font-semibold">Version {v.revision} · submitted by {v.submittedBy} · {new Date(v.submittedAt).toLocaleString()} {v.reopenedAt && <Badge tone="amber">Reopened {new Date(v.reopenedAt).toLocaleString()}{v.reopenNote ? `: ${v.reopenNote}` : ""}</Badge>}</summary>
              <div className="mt-2"><Button variant="secondary" disabled={archived} onClick={() => { if (confirm(`Share version ${v.revision} with the whole class? It becomes a frozen copy. Check the text for anything that could identify someone.`)) void run(() => api("POST", `/sessions/${d.session.id}/publications`, { sourceType: "submission", sourceId: v.id, labelMode: d.session.anonymiseDefault ? "anonymous" : "group" }), "Shared with the class. Manage it on the Sharing tab."); }}>Share this version with the class</Button></div>
              <ul className="mt-2 space-y-2 text-sm">
                {v.snapshot?.entries.map((e, i) => <li key={i} className="rounded bg-slate-50 p-2"><strong>{e.authorName}</strong>{e.questionText && <> · re: {e.questionText}</>}: {e.body}{e.table && <> [table: {e.table.columns.join(", ")}; {e.table.rows.length} rows]</>}{e.tags.length > 0 && <> · {e.tags.join(", ")}</>}</li>)}
                {v.snapshot?.synthesis?.body && <li className="rounded bg-brand-soft p-2"><strong>Group response:</strong> {v.snapshot.synthesis.body}</li>}
              </ul>
            </details>
          ))}
        </Card>
      )}
    </div>
  );
}
