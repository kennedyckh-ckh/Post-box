"use client";
import { useCallback, useEffect, useState } from "react";
import { api, errText, ApiError } from "@/lib/client/api";
import { uploadFile } from "@/lib/client/upload";
import { Card, Button, TextField, Field, Alert, Badge, inputCls } from "@/components/ui";
import type { Detail, Act } from "./types";

interface StageFull {
  id: string; position: number; title: string; enabled: boolean; visible: boolean; availability: "locked" | "open" | "closed"; instructions: string;
  tags: string[]; contributionTypes: string[]; referenceStageIds: string[]; entryCount: number;
  questions: { id: string; text: string; required: boolean; visible: boolean; parentId: string | null }[];
  resources: { id: string; kind: "link" | "file"; title: string; url: string | null; mime: string | null }[];
}
interface GS { groupId: string; stageId: string; availabilityOverride: "locked" | "open" | "closed" | null; excluded: boolean }

function StageCard({ st, all, d, gs, act, reload }: { st: StageFull; all: StageFull[]; d: Detail; gs: GS[]; act: Act; reload: () => void }) {
  const [title, setTitle] = useState(st.title);
  const [instr, setInstr] = useState(st.instructions);
  const [tags, setTags] = useState(st.tags.join(", "));
  const [types, setTypes] = useState(st.contributionTypes);
  const [refs, setRefs] = useState(st.referenceStageIds);
  const [q, setQ] = useState("");
  const [qReq, setQReq] = useState(false);
  const [qHidden, setQHidden] = useState(true);
  const [lt, setLt] = useState("");
  const [lu, setLu] = useState("");
  const [fileTitle, setFileTitle] = useState("");
  const live = d.session.status === "live";
  const archived = d.session.status === "archived";
  const earlier = all.filter((o) => o.position < st.position);
  const mains = st.questions.filter((x) => !x.parentId);
  const visibleCount = mains.filter((x) => x.visible).length;
  const hiddenCount = mains.length - visibleCount;
  const [subFor, setSubFor] = useState<string | null>(null);
  const [subText, setSubText] = useState("");
  const [subReq, setSubReq] = useState(false);
  const run: Act = async (fn, ok) => { await act(fn, ok); reload(); };
  const setAvail = (a: string, confirmText: string) => {
    if (!confirm(confirmText)) return;
    void run(async () => {
      try { await api("PATCH", `/stages/${st.id}`, { availability: a }); } catch (e) {
        // opening a part before the expected groups finished the previous one needs a recorded reason
        if (e instanceof ApiError && e.code === "groups_not_submitted") {
          const names = ((e.data.missing as { name: string }[]) || []).map((m) => m.name).join(", ");
          const reason = prompt(`${e.message}\nNot yet submitted: ${names}\n\nType a reason to open it anyway (this is recorded):`);
          if (!reason || !reason.trim()) throw new Error("Not opened. The groups above have not submitted yet.");
          await api("PATCH", `/stages/${st.id}`, { availability: a, proceedReason: reason.trim() });
        } else throw e;
      }
    }, `${st.title} is now ${a}.`);
  };

  return (
    <li className="min-w-0">
      <Card as="div">
        <div className="mb-3 flex flex-wrap items-center gap-2">
          <h2 className="text-xl font-semibold">{st.title}</h2>
          <Badge tone={!st.enabled ? "gray" : st.availability === "open" ? "green" : st.availability === "closed" ? "amber" : "gray"}>{!st.enabled ? "Not used" : st.availability === "open" ? "Open" : st.availability === "closed" ? "Closed (read only)" : "Locked"}</Badge>
          <Badge tone={st.visible ? "blue" : "gray"}>{st.visible ? "Visible to participants" : "Hidden from participants"}</Badge>
          <Badge>{st.entryCount} entries</Badge>
        </div>

        <div className="mb-4 flex flex-wrap gap-2" role="group" aria-label={`Controls for ${st.title}`}>
          {st.availability !== "open" && <Button disabled={!live || !st.enabled} onClick={() => setAvail("open", `Open ${st.title} for all groups? Nothing is published and no other part changes.`)}>{st.availability === "closed" ? "Reopen" : "Open for all groups"}</Button>}
          {st.availability === "open" && <Button variant="secondary" disabled={!live} onClick={() => setAvail("closed", `Close ${st.title}? Participants can still read it but not change it.`)}>Close (read only)</Button>}
          {st.availability !== "locked" && <Button variant="secondary" disabled={!live || st.entryCount > 0} onClick={() => setAvail("locked", `Lock ${st.title} again?`)}>Lock again{st.entryCount > 0 ? " (not possible: has entries)" : ""}</Button>}
          <Button variant="secondary" disabled={archived} onClick={() => void run(() => api("PATCH", `/stages/${st.id}`, { visible: !st.visible }), st.visible ? "Hidden from participants." : "Visible to participants.")}>{st.visible ? "Hide from participants" : "Show to participants"}</Button>
          <Button variant="secondary" disabled={archived} onClick={() => void run(() => api("PATCH", `/stages/${st.id}`, { enabled: !st.enabled }), st.enabled ? "Part switched off." : "Part switched on.")}>{st.enabled ? "Switch off (don't use)" : "Switch on"}</Button>
        </div>
        {!live && <p className="mb-3 text-sm text-slate-700">Opening and closing parts is available once the session is started.</p>}

        <TextField label="Part title" value={title} onChange={setTitle} maxLength={100} />
        <Field label="Instructions">{(id) => <textarea id={id} className={`${inputCls} min-h-24`} value={instr} maxLength={4000} onChange={(e) => setInstr(e.target.value)} />}</Field>
        <TextField label="Entry tags (comma separated, optional)" value={tags} onChange={setTags} hint="Participants can tag their entries with these." />
        <fieldset className="mb-4">
          <legend className="mb-1 text-sm font-semibold">What participants can add</legend>
          <div className="flex flex-wrap gap-4">{["text", "table", "image"].map((t) => <label key={t} className="flex min-h-11 items-center gap-2"><input type="checkbox" className="h-5 w-5" checked={types.includes(t)} onChange={(e) => setTypes(e.target.checked ? [...types, t] : types.filter((x) => x !== t))} /> {t === "text" ? "Text" : t === "table" ? "Data tables" : "Pictures"}</label>)}</div>
        </fieldset>
        {earlier.length > 0 && (
          <fieldset className="mb-4">
            <legend className="mb-1 text-sm font-semibold">Reference panel: show each group's own work from</legend>
            <div className="flex flex-wrap gap-4">{earlier.map((e) => <label key={e.id} className="flex min-h-11 items-center gap-2"><input type="checkbox" className="h-5 w-5" checked={refs.includes(e.id)} onChange={(ev) => setRefs(ev.target.checked ? [...refs, e.id] : refs.filter((x) => x !== e.id))} /> {e.title}</label>)}</div>
          </fieldset>
        )}
        <Button disabled={archived || !title.trim() || !(types.includes("text") || types.includes("table"))} onClick={() => void run(() => api("PATCH", `/stages/${st.id}`, { title, instructions: instr, tags: tags.split(",").map((t) => t.trim()).filter(Boolean), contributionTypes: types, referenceStageIds: refs }), "Part saved.")}>Save this part</Button>

        <div className="mt-8 rounded-xl border border-line bg-surface-2 p-4 sm:p-5">
          <div className="mb-3 flex flex-wrap items-start justify-between gap-3">
            <div>
              <h3 className="text-lg font-semibold text-ink">Guiding questions</h3>
              <p className="text-sm text-muted">
                {mains.length === 0 ? "No questions yet. Add as many as you need, each with optional sub-questions." : <><strong className="text-ink">{visibleCount} of {mains.length}</strong> shown to participants. Hidden questions stay private until you reveal them.</>}
              </p>
            </div>
            {mains.length > 0 && (
              <div className="flex flex-wrap gap-2" role="group" aria-label={`Reveal questions for ${st.title}`}>
                <Button disabled={archived || hiddenCount === 0} onClick={() => void run(() => api("POST", `/stages/${st.id}/questions/reveal`, { mode: "next" }), "Next question revealed to participants.")}>Reveal next question{hiddenCount > 0 ? ` (${hiddenCount} hidden)` : ""}</Button>
                <Button variant="secondary" disabled={archived || hiddenCount === 0} onClick={() => void run(() => api("POST", `/stages/${st.id}/questions/reveal`, { mode: "all" }), "All questions are now shown to participants.")}>Show all</Button>
                <Button variant="secondary" disabled={archived || visibleCount === 0} onClick={() => { if (confirm("Hide every question from participants? Answers already written are kept.")) void run(() => api("POST", `/stages/${st.id}/questions/reveal`, { mode: "none" }), "All questions hidden from participants."); }}>Hide all</Button>
              </div>
            )}
          </div>
          <ol className="mb-4 space-y-2">
            {mains.map((qq, i) => {
              const subs = st.questions.filter((x) => x.parentId === qq.id);
              return (
                <li key={qq.id} className={`rounded-lg border p-3 ${qq.visible ? "border-line bg-surface" : "border-dashed border-line-strong bg-transparent"}`}>
                  <div className="flex flex-wrap items-center gap-3">
                    <span aria-hidden="true" className={`flex h-7 w-7 shrink-0 items-center justify-center rounded-full text-sm font-semibold ${qq.visible ? "bg-brand-strong text-white" : "bg-[#eeebe4] text-muted"}`}>{i + 1}</span>
                    <span className={`min-w-48 flex-1 ${qq.visible ? "text-ink" : "text-muted"}`}>{qq.text}</span>
                    <Badge tone={qq.visible ? "green" : "gray"}>{qq.visible ? "Shown" : "Hidden"}</Badge>
                    <Button variant={qq.visible ? "secondary" : "primary"} disabled={archived} aria-label={`${qq.visible ? "Hide" : "Reveal"} question ${i + 1}`} onClick={() => void run(() => api("PATCH", `/questions/${qq.id}`, { visible: !qq.visible }), qq.visible ? `Question ${i + 1} hidden from participants.` : `Question ${i + 1} revealed to participants.`)}>{qq.visible ? "Hide" : "Reveal"}</Button>
                    <label className="flex min-h-11 items-center gap-2 text-sm"><input type="checkbox" className="h-5 w-5" checked={qq.required} disabled={archived} onChange={(e) => void run(() => api("PATCH", `/questions/${qq.id}`, { required: e.target.checked }))} /> Required</label>
                    <Button variant="ghost" disabled={archived} onClick={() => { if (confirm(subs.length ? `Remove this question and its ${subs.length} sub-question${subs.length === 1 ? "" : "s"}? Earlier entries keep their link.` : "Remove this question? Earlier entries keep their link to it.")) void run(() => api("DELETE", `/questions/${qq.id}`)); }}>Remove</Button>
                  </div>
                  {subs.length > 0 && (
                    <ol className="ml-10 mt-2 space-y-1.5 border-l-2 border-line pl-4" aria-label={`Sub-questions of question ${i + 1}`}>
                      {subs.map((sq, k) => (
                        <li key={sq.id} className="flex flex-wrap items-center gap-3">
                          <span className="w-7 shrink-0 text-sm font-semibold text-muted">{i + 1}{String.fromCharCode(97 + k)}</span>
                          <span className={`min-w-40 flex-1 text-sm ${qq.visible ? "text-ink" : "text-muted"}`}>{sq.text}</span>
                          <label className="flex min-h-11 items-center gap-2 text-sm"><input type="checkbox" className="h-5 w-5" checked={sq.required} disabled={archived} onChange={(e) => void run(() => api("PATCH", `/questions/${sq.id}`, { required: e.target.checked }))} /> Required</label>
                          <Button variant="ghost" disabled={archived} aria-label={`Remove sub-question ${i + 1}${String.fromCharCode(97 + k)}`} onClick={() => { if (confirm("Remove this sub-question? Earlier entries keep their link to it.")) void run(() => api("DELETE", `/questions/${sq.id}`)); }}>Remove</Button>
                        </li>
                      ))}
                    </ol>
                  )}
                  {subFor === qq.id ? (
                    <form className="ml-10 mt-2 flex flex-wrap items-end gap-2 border-l-2 border-line pl-4" onSubmit={(e) => { e.preventDefault(); if (!subText.trim()) return; void run(async () => { await api("POST", `/stages/${st.id}/questions`, { text: subText, parentId: qq.id, required: subReq }); setSubText(""); setSubReq(false); }, "Sub-question added."); }}>
                      <div className="min-w-56 flex-1"><TextField label={`New sub-question for question ${i + 1}`} value={subText} onChange={setSubText} maxLength={500} /></div>
                      <label className="mb-4 flex min-h-11 items-center gap-2 text-sm"><input type="checkbox" className="h-5 w-5" checked={subReq} onChange={(e) => setSubReq(e.target.checked)} /> Required</label>
                      <div className="mb-4 flex gap-2"><Button type="submit" disabled={archived || !subText.trim()}>Add</Button><Button variant="ghost" onClick={() => { setSubFor(null); setSubText(""); }}>Cancel</Button></div>
                    </form>
                  ) : (
                    !archived && subs.length < 10 && <button type="button" className="ml-10 mt-1 min-h-9 rounded-md px-2 text-sm font-semibold text-brand-strong hover:bg-brand-soft" onClick={() => { setSubFor(qq.id); setSubText(""); setSubReq(false); }}>+ Add sub-question <span className="font-normal text-muted">(optional)</span></button>
                  )}
                </li>
              );
            })}
          </ol>
          <div className="flex flex-wrap items-end gap-x-4 gap-y-1">
            <div className="min-w-64 flex-1"><TextField label="New main question" value={q} onChange={setQ} maxLength={500} /></div>
            <label className="mb-4 flex min-h-11 items-center gap-2 text-sm"><input type="checkbox" className="h-5 w-5" checked={qHidden} onChange={(e) => setQHidden(e.target.checked)} /> Keep hidden until I reveal it</label>
            <label className="mb-4 flex min-h-11 items-center gap-2 text-sm"><input type="checkbox" className="h-5 w-5" checked={qReq} onChange={(e) => setQReq(e.target.checked)} /> Required</label>
            <div className="mb-4"><Button disabled={archived || !q.trim()} onClick={() => void run(async () => { await api("POST", `/stages/${st.id}/questions`, { text: q, required: qReq, visible: !qHidden }); setQ(""); setQReq(false); }, qHidden ? "Question added (hidden until you reveal it)." : "Question added and shown to participants.")}>Add question</Button></div>
          </div>
          <p className="text-sm text-muted">Sub-questions are optional and appear together with their main question. Required questions only count once they are shown. You can also reveal questions from the projector view.</p>
        </div>

        <h3 className="mb-2 mt-8 text-lg font-semibold text-ink">Links and files</h3>
        <ul className="mb-3 space-y-1">
          {st.resources.map((r) => <li key={r.id} className="flex flex-wrap items-center gap-2"><span className="flex-1">{r.kind === "link" ? <a href={r.url ?? "#"} className="underline" target="_blank" rel="noopener noreferrer">{r.title}</a> : <span>{r.title} ({r.mime === "application/pdf" ? "PDF" : "image"})</span>}</span><Button variant="secondary" disabled={archived} onClick={() => { if (confirm(`Remove ${r.title}?`)) void run(() => api("DELETE", `/resources/${r.id}`)); }}>Remove</Button></li>)}
          {st.resources.length === 0 && <li className="text-sm">None yet.</li>}
        </ul>
        <div className="grid gap-x-4 sm:grid-cols-2">
          <TextField label="Link title" value={lt} onChange={setLt} maxLength={100} />
          <TextField label="Web address" value={lu} onChange={setLu} hint="Starts with https://" />
        </div>
        <Button variant="secondary" disabled={archived || !lt.trim() || !lu.trim()} onClick={() => void run(async () => { await api("POST", `/stages/${st.id}/resources`, { title: lt, url: lu }); setLt(""); setLu(""); }, "Link added.")}>Add link</Button>
        <div className="mt-4">
          <TextField label="File title (optional)" value={fileTitle} onChange={setFileTitle} maxLength={100} />
          <label className="mb-1 block text-sm font-semibold" htmlFor={`f-${st.id}`}>Add a PDF or image (PDF up to 10 MB; PNG, JPEG or WebP)</label>
          <input id={`f-${st.id}`} type="file" accept="application/pdf,image/png,image/jpeg,image/webp" disabled={archived} onChange={(e) => { const f = e.target.files?.[0]; e.target.value = ""; if (f) void run(async () => { await uploadFile(`/stages/${st.id}/resources/file?title=${encodeURIComponent(fileTitle || f.name)}`, f); setFileTitle(""); }, "File added."); }} />
        </div>

        {d.groups.length > 0 && (
          <div className="mt-6">
            <h3 className="mb-2 text-lg font-semibold">Per-group settings for this part</h3>
            <p className="mb-2 text-sm text-slate-700">Open or close this part for one group only, or leave a group out. Other groups are not affected.</p>
            <div className="overflow-x-auto">
              <table className="w-full text-left text-sm">
                <caption className="sr-only">Per-group settings for {st.title}</caption>
                <thead><tr className="border-b border-line"><th scope="col" className="p-2">Group</th><th scope="col" className="p-2">State for this group</th><th scope="col" className="p-2">Not taking part</th></tr></thead>
                <tbody>
                  {d.groups.map((g) => {
                    const cur = gs.find((x) => x.groupId === g.id && x.stageId === st.id);
                    return (
                      <tr key={g.id} className="border-b border-line">
                        <th scope="row" className="p-2">{g.name}</th>
                        <td className="p-2">
                          <label className="sr-only" htmlFor={`o-${g.id}-${st.id}`}>State of {st.title} for {g.name}</label>
                          <select id={`o-${g.id}-${st.id}`} className={inputCls} disabled={archived || !live} value={cur?.availabilityOverride ?? ""} onChange={(e) => void run(() => api("PUT", `/groups/${g.id}/stages/${st.id}`, { availabilityOverride: e.target.value || null }))}>
                            <option value="">Same as the whole part</option><option value="open">Open for this group</option><option value="closed">Closed for this group</option><option value="locked">Locked for this group</option>
                          </select>
                        </td>
                        <td className="p-2"><label className="flex min-h-11 items-center gap-2"><input type="checkbox" className="h-5 w-5" disabled={archived} checked={!!cur?.excluded} onChange={(e) => void run(() => api("PUT", `/groups/${g.id}/stages/${st.id}`, { excluded: e.target.checked }))} /> Excluded</label></td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </div>
        )}
      </Card>
    </li>
  );
}

export function StagesTab({ d, act }: { d: Detail; act: Act }) {
  const [stages, setStages] = useState<StageFull[] | null>(null);
  const [gs, setGs] = useState<GS[]>([]);
  const [err, setErr] = useState("");
  const load = useCallback(() => api<{ stages: StageFull[]; groupSettings: GS[] }>("GET", `/sessions/${d.session.id}/stages`).then((r) => { setStages(r.stages); setGs(r.groupSettings); }).catch((e) => setErr(errText(e))), [d.session.id]);
  useEffect(() => { void load(); }, [load, d.stages]);
  if (err) return <Alert kind="error">{err}</Alert>;
  if (!stages) return <p role="status">Loading…</p>;
  return <ul className="grid grid-cols-[minmax(0,1fr)] gap-4">{stages.map((s) => <StageCard key={s.id + s.title + s.instructions + s.questions.length + s.resources.length + s.availability} st={s} all={stages} d={d} gs={gs} act={act} reload={load} />)}</ul>;
}
