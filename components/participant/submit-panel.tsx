"use client";
import { useState } from "react";
import { api, errText, ApiError } from "@/lib/client/api";
import { Card, Button, Alert, Badge } from "@/components/ui";

export interface SubInfo { status: "draft" | "submitted" | "reopened"; revision: number; submittedAt: number | null; submittedByName: string | null }
interface Check { submission: SubInfo; missingRequired: { questionId: string; text: string }[]; editingNow: string[]; canSubmit: boolean; whyNot: string | null }

/** "Save entry" keeps your own work; "Submit group work" locks the part for the whole group. This panel is the second one. */
export function SubmitPanel({ stageId, groupName, sub, canWrite, busyEditing, onSubmitted }: { stageId: string; groupName: string; sub: SubInfo; canWrite: boolean; busyEditing: boolean; onSubmitted: () => void }) {
  const [check, setCheck] = useState<Check | null>(null);
  const [err, setErr] = useState("");
  const [busy, setBusy] = useState(false);
  const [key] = useState(() => `${Date.now()}-${Math.random().toString(36).slice(2)}`);

  async function open() {
    setErr("");
    try { setCheck(await api<Check>("GET", `/stages/${stageId}/submission`)); } catch (e) { setErr(errText(e)); }
  }
  async function confirmSubmit() {
    setBusy(true); setErr("");
    try { await api("POST", `/stages/${stageId}/submit`, { confirm: true, requestKey: key }); setCheck(null); onSubmitted(); }
    catch (e) {
      if (e instanceof ApiError && e.code === "missing_required") { await open(); setErr("Some required questions still have no response."); }
      else setErr(errText(e));
    } finally { setBusy(false); }
  }

  return (
    <Card label="Submit group work">
      <div className="mb-2 flex flex-wrap items-center gap-2">
        <h2 className="text-xl font-semibold">Group submission</h2>
        <Badge tone={sub.status === "submitted" ? "green" : sub.status === "reopened" ? "amber" : "gray"}>
          {sub.status === "submitted" ? `Submitted (version ${sub.revision})` : sub.status === "reopened" ? `Reopened for revision (last submitted: version ${sub.revision})` : "Draft: not submitted yet"}
        </Badge>
      </div>
      {sub.status === "submitted" && <p className="mb-2 text-sm">Submitted by {sub.submittedByName} at {sub.submittedAt ? new Date(sub.submittedAt).toLocaleString() : ""}. This part is read-only until your facilitator reopens it.</p>}
      {sub.status === "reopened" && <p className="mb-2 text-sm">Your facilitator reopened this part. Make your changes, then submit again; the earlier version is kept.</p>}
      {err && <Alert kind="error">{err}</Alert>}
      {!check && sub.status !== "submitted" && (
        <>
          <p className="mb-3 text-sm text-slate-800">Saving an entry keeps your own work. Submitting hands the whole group's work in and <strong>locks this part for everyone in {groupName}</strong>.</p>
          <Button disabled={!canWrite || busyEditing} onClick={() => void open()}>Submit group work…</Button>
          {busyEditing && <p className="mt-2 text-sm font-semibold">Finish or cancel the entry you are editing first, so nothing unsaved is left out.</p>}
        </>
      )}
      {check && (
        <div className="rounded-lg border-2 border-brand p-4" role="group" aria-label="Confirm submission">
          <h3 className="mb-2 text-lg font-semibold">Submit this part for {groupName}?</h3>
          <p className="mb-3">Submitting locks this part for your whole group. Nobody can add or change entries until your facilitator reopens it. A snapshot of everything saved so far is kept.</p>
          {check.missingRequired.length > 0 && (
            <Alert kind="error">These required questions have no response yet: <ul className="ml-5 list-disc">{check.missingRequired.map((m) => <li key={m.questionId}>{m.text}</li>)}</ul></Alert>
          )}
          {check.editingNow.length > 0 && (
            <Alert kind="warning">{check.editingNow.join(", ")} {check.editingNow.length === 1 ? "has" : "have"} an entry open for editing right now. Anything not saved yet will not be included. Ask them to save first. (We can only see people who are online now; we cannot see unsaved work on a device that is offline.)</Alert>
          )}
          {!check.canSubmit && check.whyNot && <Alert kind="info">{check.whyNot}</Alert>}
          <div className="flex flex-wrap gap-2">
            <Button disabled={busy || !check.canSubmit || check.missingRequired.length > 0} onClick={() => void confirmSubmit()}>{busy ? "Submitting…" : "Yes, submit and lock"}</Button>
            <Button variant="secondary" disabled={busy} onClick={() => setCheck(null)}>Not yet</Button>
          </div>
        </div>
      )}
    </Card>
  );
}
