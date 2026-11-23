"use client";
import { useEffect, useRef, useState } from "react";
import { api, errText, ApiError } from "@/lib/client/api";
import { uploadFile } from "@/lib/client/upload";
import { Button, Alert, Field, inputCls } from "@/components/ui";
import { TableEditor } from "./table-editor";
import { EntryBody } from "./entry-view";
import type { Entry, StageDetail, SaveState, TableData } from "./types";

const newTable = (): TableData => ({ columns: ["Column 1", "Column 2"], rows: [["", ""]] });

interface Props {
  detail: StageDetail;
  editing: Entry | null;
  onDone: () => void;
  onState: (s: SaveState, msg?: string) => void;
}

/** Create or edit one of your own entries. It says "saved" only after the server confirms. */
export function EntryEditor({ detail, editing, onDone, onState }: Props) {
  const st = detail.stage;
  const canTable = st.contributionTypes.includes("table");
  const canText = st.contributionTypes.includes("text");
  const canImage = st.contributionTypes.includes("image");
  const [kind, setKind] = useState<"text" | "table">(editing?.kind ?? (canText ? "text" : "table"));
  const [body, setBody] = useState(editing?.body ?? "");
  const [tags, setTags] = useState<string[]>(editing?.tags ?? []);
  const [questionId, setQuestionId] = useState(editing?.questionId ?? "");
  const [table, setTable] = useState<TableData>(editing?.table ?? newTable());
  const [attachment, setAttachment] = useState<Entry["attachment"]>(editing?.attachment ?? null);
  const [base, setBase] = useState(editing?.version ?? 0);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [conflict, setConflict] = useState<Entry | null>(null);
  const key = useRef(`${Date.now()}-${Math.random().toString(36).slice(2)}`);
  const dirty = useRef(false);
  const touch = () => { dirty.current = true; onState("unsaved"); };

  useEffect(() => {
    const h = (e: BeforeUnloadEvent) => { if (dirty.current) { e.preventDefault(); e.returnValue = ""; } };
    window.addEventListener("beforeunload", h);
    return () => window.removeEventListener("beforeunload", h);
  }, []);

  async function save(overrideBase?: number) {
    setBusy(true); setError(""); onState("saving");
    const payload = { kind, body, tags, questionId: questionId || null, table: kind === "table" ? table : undefined, attachmentId: attachment?.id ?? null };
    try {
      if (editing) await api("PATCH", `/entries/${editing.id}`, { ...payload, baseVersion: overrideBase ?? base });
      else await api("POST", `/stages/${st.id}/entries`, { ...payload, clientKey: key.current });
      dirty.current = false; setConflict(null);
      onState("saved");
      onDone();
    } catch (e) {
      if (e instanceof ApiError && e.code === "edit_conflict") {
        const cur = e.data.current as Entry | undefined;
        setConflict(cur ?? null);
        setError(e.message); onState("error", "Edit conflict: nothing was overwritten.");
        void refreshConflict();
      } else if (e instanceof ApiError && e.status === 0) { setError(e.message); onState("offline"); }
      else { setError(errText(e)); onState("error", errText(e)); }
    } finally { setBusy(false); }
  }

  async function refreshConflict() {
    if (!editing) return;
    try {
      const list = await api<{ entries: Entry[] }>("GET", `/stages/${st.id}/entries`);
      const cur = list.entries.find((x) => x.id === editing.id);
      if (cur) setConflict(cur);
    } catch { /* keep what we have */ }
  }

  async function pick(file: File | undefined) {
    if (!file) return;
    setError(""); onState("saving");
    try {
      const r = await uploadFile<{ attachment: NonNullable<Entry["attachment"]> }>(`/stages/${st.id}/uploads`, file);
      setAttachment(r.attachment); touch();
    } catch (e) { setError(errText(e)); onState("error", errText(e)); }
  }

  return (
    <form className="rounded-xl border-2 border-brand bg-white p-4" onSubmit={(e) => { e.preventDefault(); void save(); }} aria-label={editing ? "Edit your entry" : "Add an entry"}>
      <h3 className="mb-3 text-lg font-semibold">{editing ? "Edit your entry" : "Add an entry"}</h3>
      {error && <Alert kind="error">{error}</Alert>}
      {conflict && (
        <div className="mb-4 rounded-lg border border-amber-700 bg-amber-50 p-3" role="group" aria-label="Edit conflict">
          <p className="font-semibold">The saved version is different from the one you opened.</p>
          <p className="mt-1 text-sm">Saved version (version {conflict.version}):</p>
          <div className="my-2 rounded bg-white p-2"><EntryBody e={conflict} /></div>
          <p className="text-sm">Your version is still in the form below. Choose what to do:</p>
          <div className="mt-2 flex flex-wrap gap-2">
            <Button onClick={() => { setBase(conflict.version); void save(conflict.version); }}>Save my version over it</Button>
            <Button variant="secondary" onClick={() => { setBody(conflict.body); setTags(conflict.tags); if (conflict.table) setTable(conflict.table); setBase(conflict.version); setConflict(null); setError(""); onState("unsaved"); }}>Use the saved version instead</Button>
          </div>
        </div>
      )}
      {canText && canTable && (
        <fieldset className="mb-3 flex gap-4" disabled={!!editing}>
          <legend className="mb-1 text-sm font-semibold">Type of entry</legend>
          <label className="flex min-h-11 items-center gap-2"><input type="radio" checked={kind === "text"} onChange={() => { setKind("text"); touch(); }} /> Text</label>
          <label className="flex min-h-11 items-center gap-2"><input type="radio" checked={kind === "table"} onChange={() => { setKind("table"); touch(); }} /> Table</label>
        </fieldset>
      )}
      {detail.questions.length > 0 && (
        <Field label="Which question is this for? (optional)">
          {(id) => <select id={id} className={inputCls} value={questionId} onChange={(e) => { setQuestionId(e.target.value); touch(); }}><option value="">General</option>{questionOptions(detail.questions).map((q) => <option key={q.id} value={q.id}>{q.label}. {q.text}</option>)}</select>}
        </Field>
      )}
      <Field label={kind === "text" ? "Your contribution" : "Caption (optional)"} hint="Your name is shown with your entry. Only your group can see it until your facilitator shares it.">
        {(id, d) => <textarea id={id} aria-describedby={d} className={`${inputCls} min-h-28`} maxLength={kind === "text" ? 4000 : 500} value={body} onChange={(e) => { setBody(e.target.value); touch(); }} />}
      </Field>
      {kind === "table" && <TableEditor value={table} onChange={(t) => { setTable(t); touch(); }} />}
      {st.tags.length > 0 && (
        <fieldset className="mb-4">
          <legend className="mb-1 text-sm font-semibold">Tags (optional)</legend>
          <div className="flex flex-wrap gap-3">{st.tags.map((t) => <label key={t} className="flex min-h-11 items-center gap-2"><input type="checkbox" className="h-5 w-5" checked={tags.includes(t)} onChange={(e) => { setTags(e.target.checked ? [...tags, t] : tags.filter((x) => x !== t)); touch(); }} /> {t}</label>)}</div>
        </fieldset>
      )}
      {canImage && (
        <div className="mb-4">
          <label className="mb-1 block text-sm font-semibold" htmlFor="pic">Picture (optional, PNG or JPEG, up to 3 MB)</label>
          <input id="pic" type="file" accept="image/png,image/jpeg" onChange={(e) => void pick(e.target.files?.[0])} />
          {attachment && (
            <div className="mt-2">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src={`/api/attachments/${attachment.id}`} alt={`Preview of ${attachment.name}`} className="max-h-40 rounded border border-line" />
              <Button variant="secondary" className="mt-1" onClick={() => { setAttachment(null); touch(); }}>Remove picture</Button>
            </div>
          )}
        </div>
      )}
      <div className="flex flex-wrap gap-2">
        <Button type="submit" disabled={busy || (kind === "text" && !body.trim())}>{busy ? "Saving…" : "Save entry"}</Button>
        <Button variant="secondary" disabled={busy} onClick={() => { if (!dirty.current || confirm("Discard your changes to this entry?")) { dirty.current = false; onState("idle"); onDone(); } }}>Cancel</Button>
      </div>
    </form>
  );
}

/** "1", "1a", "1b", "2" … in the order participants see them. */
function questionOptions(qs: { id: string; text: string; parentId: string | null }[]) {
  const out: { id: string; text: string; label: string }[] = [];
  let n = 0;
  for (const q of qs.filter((x) => !x.parentId)) {
    n++;
    out.push({ id: q.id, text: q.text, label: String(n) });
    qs.filter((x) => x.parentId === q.id).forEach((sq, k) => out.push({ id: sq.id, text: sq.text, label: `${n}${String.fromCharCode(97 + k)}` }));
  }
  return out;
}
