"use client";
import { use, useCallback, useEffect, useRef, useState } from "react";
import Link from "next/link";
import { ParticipantTimer } from "@/components/timer";
import { api, errText, ApiError } from "@/lib/client/api";
import { Shell, Card, Button, Alert, Badge, inputCls, LogoffButton } from "@/components/ui";
import { EntryEditor } from "@/components/participant/entry-editor";
import { EntryBody, timeText } from "@/components/participant/entry-view";
import { SubmitPanel } from "@/components/participant/submit-panel";
import { ReactionBar, CommentList, CommentBox } from "@/components/participant/engagement";
import type { Entry, EntryList, SaveState, StageDetail } from "@/components/participant/types";

const SAVE_TEXT: Record<SaveState, string> = {
  idle: "",
  saving: "Saving…",
  saved: "Saved. Your group can see this.",
  unsaved: "Unsaved changes. Press Save entry to keep them.",
  offline: "Offline. Your changes are not saved yet. Reconnect and press Save entry.",
  error: "Not saved.",
};

export default function StagePage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const [detail, setDetail] = useState<StageDetail | null>(null);
  const [list, setList] = useState<EntryList | null>(null);
  const [error, setError] = useState("");
  const [offline, setOffline] = useState(false);
  const [editing, setEditing] = useState<Entry | "new" | null>(null);
  const [save, setSave] = useState<{ s: SaveState; msg?: string }>({ s: "idle" });
  const etag = useRef("");
  const editingRef = useRef(false);
  editingRef.current = editing !== null;

  const loadDetail = useCallback(async () => {
    try { setDetail(await api<StageDetail>("GET", `/stages/${id}`)); setError(""); } catch (e) {
      if (e instanceof ApiError && e.status === 401) window.location.href = "/recover";
      else setError(errText(e));
    }
  }, [id]);

  const poll = useCallback(async (force = false) => {
    try {
      const r = await api<EntryList>("GET", `/stages/${id}/entries${!force && etag.current ? `?etag=${etag.current}` : ""}`);
      setOffline(false);
      if (r.unchanged) return;
      etag.current = r.etag;
      setList(r);
      // the facilitator changed this part's state (opened/closed/submitted): refresh instructions and permissions too
      void loadDetail();
    } catch (e) {
      if (e instanceof ApiError && e.status === 0) setOffline(true);
      else if (e instanceof ApiError && (e.status === 403 || e.status === 404)) setError(e.message);
    }
  }, [id, loadDetail]);

  useEffect(() => { void loadDetail(); void poll(true); }, [loadDetail, poll]);
  useEffect(() => { const t = setInterval(() => void poll(), 4000); return () => clearInterval(t); }, [poll]);
  // tell teammates' submit screen that an editor is open here (so they can be warned), and say when it is closed again
  useEffect(() => {
    if (editing === null) return;
    const beat = () => { void api("POST", `/stages/${id}/presence`, { editing: true }).catch(() => {}); };
    beat();
    const t = setInterval(beat, 8000);
    return () => { clearInterval(t); void api("POST", `/stages/${id}/presence`, { editing: false }).catch(() => {}); };
  }, [editing, id]);

  const qText = (qid: string | null) => detail?.questions.find((q) => q.id === qid)?.text;
  // Questions already on screen at first load are not highlighted; ones the facilitator reveals later are, once.
  const seenQ = useRef<Set<string> | null>(null);
  useEffect(() => {
    if (!detail) return;
    const t = setTimeout(() => { seenQ.current = new Set([...(seenQ.current ?? []), ...detail.questions.map((q) => q.id)]); }, seenQ.current === null ? 0 : 2000);
    return () => clearTimeout(t);
  }, [detail]);

  if (error && !detail) return <Shell title="This part"><Alert kind="warning">{error}</Alert><Link href="/session" className="underline">Back to my session</Link></Shell>;
  if (!detail || !list) return <Shell title="Loading…"><p role="status">Loading…</p></Shell>;
  const st = detail.stage;
  const canWrite = list.canWrite;

  return (
    <Shell wide right={<LogoffButton />} banner={<ParticipantTimer />}>
      <p className="mb-4 text-sm"><Link href="/session" className="font-semibold text-muted hover:text-brand-strong">← My session</Link></p>
      <div className="mb-4 flex flex-wrap items-center gap-3">
        <h1 className="text-3xl text-ink sm:text-[2.1rem]">{st.title}</h1>
        <Badge tone={canWrite ? "green" : "amber"}>{canWrite ? "Open: you can add and edit" : st.availability === "closed" ? "Closed: read only" : "Read only"}</Badge>
      </div>
      {offline && <Alert kind="warning">You appear to be offline. Entries already saved are safe. We will keep trying to reconnect.</Alert>}
      {error && <Alert kind="error">{error}</Alert>}
      {!canWrite && list.blockedReason && <Alert kind="info">{list.blockedReason.message}</Alert>}
      <div role="status" aria-live="polite" className="mb-3 min-h-6 text-sm font-semibold">{save.s !== "idle" && `${SAVE_TEXT[save.s]}${save.msg ? ` ${save.msg}` : ""}`}</div>

      <div className="grid gap-6 lg:grid-cols-3">
        <div className="space-y-6 lg:col-span-2">
          <Card>
            {st.instructions && <p className="mb-3 whitespace-pre-wrap">{st.instructions}</p>}
            {(detail.questions.length > 0 || detail.hiddenQuestions > 0) && (
              <>
                <h2 className="mb-2 text-xl text-ink">Guiding questions</h2>
                <ol className="mb-3 space-y-2" aria-live="polite">
                  {detail.questions.filter((q) => !q.parentId).map((q, i) => {
                    const subs = detail.questions.filter((x) => x.parentId === q.id);
                    return (
                      <li key={q.id} className={`rounded-lg px-2 py-1.5 ${seenQ.current !== null && !seenQ.current.has(q.id) ? "reveal-in" : ""}`}>
                        <div className="flex gap-3">
                          <span aria-hidden="true" className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-brand-strong text-sm font-semibold text-white">{i + 1}</span>
                          <span className="pt-0.5 text-ink"><span className="sr-only">Question {i + 1}: </span>{q.text} {q.required && <Badge tone="amber">Required</Badge>}</span>
                        </div>
                        {subs.length > 0 && (
                          <ol className="ml-10 mt-2 space-y-1.5 border-l-2 border-line pl-4">
                            {subs.map((sq, k) => (
                              <li key={sq.id} className="flex gap-2 text-ink">
                                <span className="w-6 shrink-0 font-semibold text-brand" aria-hidden="true">{String.fromCharCode(97 + k)}.</span>
                                <span><span className="sr-only">Question {i + 1}{String.fromCharCode(97 + k)}: </span>{sq.text} {sq.required && <Badge tone="amber">Required</Badge>}</span>
                              </li>
                            ))}
                          </ol>
                        )}
                      </li>
                    );
                  })}
                </ol>
                {detail.hiddenQuestions > 0 && <p className="mb-3 flex items-center gap-2 text-sm text-muted"><span aria-hidden="true" className="h-1.5 w-1.5 rounded-full bg-accent" />{detail.questions.length === 0 ? "Your facilitator will reveal the questions for this part soon." : "More questions will appear here when your facilitator reveals them."}</p>}
              </>
            )}
            {detail.resources.length > 0 && (
              <>
                <h2 className="mb-1 text-xl text-ink">Resources</h2>
                <ul className="list-disc pl-6">
                  {detail.resources.map((r) => (
                    <li key={r.id}>
                      {r.kind === "link" ? <a className="font-semibold underline" href={r.url ?? "#"} target="_blank" rel="noopener noreferrer">{r.title} <span className="text-sm">(opens in a new tab)</span></a>
                        : <a className="font-semibold underline" href={`/api/attachments/${r.attachmentId}`} target="_blank" rel="noopener noreferrer">{r.title} <span className="text-sm">({r.mime === "application/pdf" ? "PDF" : "image"})</span></a>}
                    </li>
                  ))}
                </ul>
              </>
            )}
          </Card>

          <section aria-label="Your group's entries">
            <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
              <h2 className="text-xl font-semibold">Your group's entries <Badge>{list.entries.length}</Badge></h2>
              {canWrite && editing === null && <Button onClick={() => { setEditing("new"); setSave({ s: "idle" }); }}>Add an entry</Button>}
            </div>
            {editing !== null && <div className="mb-4"><EntryEditor key={editing === "new" ? "new" : editing.id + editing.version} detail={detail} editing={editing === "new" ? null : editing} onState={(s, msg) => setSave({ s, msg })} onDone={() => { setEditing(null); void poll(true); }} /></div>}
            {list.entries.length === 0 ? <Card><p>No entries yet. Be the first to add one.</p></Card> : (
              <ul className="space-y-3">
                {list.entries.map((e) => (
                  <li key={e.id}>
                    <Card as="div" className={e.mine ? "border-brand" : ""}>
                      <div className="mb-1 flex flex-wrap items-center justify-between gap-2 text-sm">
                        <span><strong>{e.authorName}</strong>{e.mine && " (you)"} · {timeText(e.updatedAt)}{e.version > 1 && " · edited"}</span>
                        {e.mine && canWrite && editing === null && (
                          <span className="flex gap-2">
                            <Button variant="secondary" aria-label={`Edit your entry from ${timeText(e.createdAt)}`} onClick={() => { setEditing(e); setSave({ s: "idle" }); }}>Edit</Button>
                            <Button variant="danger" aria-label={`Delete your entry from ${timeText(e.createdAt)}`} onClick={async () => { if (confirm("Delete this entry?")) { try { await api("DELETE", `/entries/${e.id}`); void poll(true); } catch (er) { setError(errText(er)); } } }}>Delete</Button>
                          </span>
                        )}
                      </div>
                      <EntryBody e={e} questionText={qText(e.questionId)} />
                      {list.engagement.reactions.enabled && <ReactionBar targetType="entry" targetId={e.id} types={list.engagement.reactions.types} summary={list.engagement.byEntry[e.id]?.reactions} onChange={() => void poll(true)} />}
                      <CommentList comments={list.engagement.byEntry[e.id]?.comments ?? []} onChange={() => void poll(true)} />
                      {list.engagement.critique.enabled && !e.mine && <CommentBox targetType="entry" targetId={e.id} prompts={list.engagement.critique.prompts} onPosted={() => void poll(true)} />}
                    </Card>
                  </li>
                ))}
              </ul>
            )}
          </section>

          <GroupResponse stageId={st.id} synth={list.synthesis} canWrite={canWrite} onSaved={() => void poll(true)} />

          <SubmitPanel stageId={st.id} groupName="your group" sub={list.submission} canWrite={canWrite || list.submission.status === "reopened"} busyEditing={editing !== null || save.s === "saving" || save.s === "unsaved"} onSubmitted={() => void poll(true)} />
        </div>

        <aside aria-label="Reference from earlier parts">
          {detail.reference.length > 0 ? detail.reference.map((r) => (
            <details key={r.stageId} className="mb-3 rounded-xl border border-line bg-white p-4" open>
              <summary className="cursor-pointer font-semibold">Reference: {r.title} <Badge tone={r.source === "submitted" ? "green" : "amber"}>{r.source === "submitted" ? "Submitted snapshot" : "Current draft, not submitted"}</Badge></summary>
              <p className="mt-2 text-sm text-slate-700">Your group's earlier work, for reference only. It is separate from this part.</p>
              {r.entries.length === 0 ? <p className="mt-2 text-sm">No entries.</p> : <ul className="mt-2 space-y-2">{r.entries.map((e) => <li key={e.id} className="rounded-lg bg-slate-50 p-2 text-sm"><strong>{e.authorName}:</strong> <EntryBody e={e} /></li>)}</ul>}
              {r.synthesis && <p className="mt-2 rounded-lg bg-brand-soft p-2 text-sm"><strong>Group response:</strong> {r.synthesis}</p>}
            </details>
          )) : <Card><p className="text-sm">No reference material for this part.</p></Card>}
        </aside>
      </div>
    </Shell>
  );
}

function GroupResponse({ stageId, synth, canWrite, onSaved }: { stageId: string; synth: { body: string; version: number }; canWrite: boolean; onSaved: () => void }) {
  const [text, setText] = useState(synth.body);
  const [base, setBase] = useState(synth.version);
  const [dirty, setDirty] = useState(false);
  const [msg, setMsg] = useState<{ kind: "error" | "success" | "warning"; text: string } | null>(null);
  const [conflict, setConflict] = useState<{ body: string; version: number } | null>(null);

  // adopt teammates' saved changes only while this person has no unsaved edits of their own
  useEffect(() => { if (!dirty) { setText(synth.body); setBase(synth.version); } }, [synth.body, synth.version, dirty]);

  async function put(b = base) {
    setMsg(null);
    try {
      const r = await api<{ synthesis: { body: string; version: number } }>("PUT", `/stages/${stageId}/synthesis`, { body: text, baseVersion: b });
      setBase(r.synthesis.version); setDirty(false); setConflict(null); setMsg({ kind: "success", text: "Group response saved." }); onSaved();
    } catch (e) {
      if (e instanceof ApiError && e.code === "edit_conflict") { setConflict(e.data.current as { body: string; version: number }); setMsg({ kind: "warning", text: "A teammate saved a different group response first. Nothing was overwritten." }); }
      else setMsg({ kind: "error", text: errText(e) });
    }
  }

  return (
    <Card label="Group response">
      <h2 className="mb-1 text-xl font-semibold">Group response (optional)</h2>
      <p className="mb-3 text-sm text-slate-700">One jointly agreed answer. It does not replace anyone's individual entries.</p>
      {msg && <Alert kind={msg.kind}>{msg.text}</Alert>}
      {conflict && (
        <div className="mb-3 rounded-lg border border-amber-700 bg-amber-50 p-3 text-sm">
          <p className="font-semibold">Saved by a teammate (version {conflict.version}):</p>
          <p className="my-2 whitespace-pre-wrap rounded bg-white p-2">{conflict.body || "(empty)"}</p>
          <div className="flex flex-wrap gap-2">
            <Button onClick={() => void put(conflict.version)}>Save mine over theirs</Button>
            <Button variant="secondary" onClick={() => { setText(conflict.body); setBase(conflict.version); setDirty(false); setConflict(null); setMsg(null); }}>Use theirs</Button>
          </div>
        </div>
      )}
      <label className="sr-only" htmlFor="synth">Group response</label>
      <textarea id="synth" className={`${inputCls} min-h-28`} value={text} maxLength={4000} readOnly={!canWrite} onChange={(e) => { setText(e.target.value); setDirty(true); }} />
      {canWrite && <div className="mt-2"><Button disabled={!dirty} onClick={() => void put()}>Save group response</Button> {dirty && <span className="ml-2 text-sm font-semibold">Unsaved changes</span>}</div>}
    </Card>
  );
}
