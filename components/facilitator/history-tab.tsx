"use client";
import { useEffect, useState } from "react";
import { api, errText } from "@/lib/client/api";
import { Card, Alert } from "@/components/ui";

interface Ev { id: number; at: number; actor: string; actorType: string; action: string; detail: Record<string, unknown> | null }

const LABEL: Record<string, string> = {
  session_created: "Created the session", session_started: "Started the session", session_updated: "Changed session settings", session_archived: "Archived the session", session_restored: "Restored the session",
  session_duplicated: "Made a copy of the session", joining_opened: "Opened joining", joining_closed: "Closed joining", join_code_regenerated: "Made a new join code",
  co_facilitator_added: "Added a co-facilitator", co_facilitator_removed: "Removed a co-facilitator", group_created: "Added a group", group_updated: "Changed a group", group_deleted: "Deleted a group",
  representative_set: "Set a group representative", joined: "Joined", recovered_session: "Used a recovery code", recovery_code_issued: "Issued a new recovery code", recovery_code_replaced: "Replaced their recovery code",
  participant_moved: "Moved a participant to another group", participant_removed: "Removed a participant", participant_restored: "Restored a participant",
  stage_availability_changed: "Opened, closed or locked a part", stage_updated: "Changed a part", proceed_override: "Opened a part although expected groups had not submitted",
  group_stage_setting_changed: "Changed a part for one group", question_added: "Added a question", question_updated: "Changed a question", question_removed: "Removed a question",
  resource_added: "Added a link", resource_file_added: "Added a file", resource_removed: "Removed a link or file", entry_hidden: "Hid an entry from its group", entry_unhidden: "Showed an entry again",
  entry_deleted: "Deleted their own entry", group_submitted: "Submitted group work", submission_reopened: "Reopened a group's submission",
};

export function HistoryTab({ sessionId }: { sessionId: string }) {
  const [ev, setEv] = useState<Ev[] | null>(null);
  const [err, setErr] = useState("");
  useEffect(() => { api<{ events: Ev[] }>("GET", `/sessions/${sessionId}/audit`).then((r) => setEv(r.events)).catch((e) => setErr(errText(e))); }, [sessionId]);
  if (err) return <Alert kind="error">{err}</Alert>;
  if (!ev) return <p role="status">Loading…</p>;
  return (
    <Card>
      <h2 className="mb-3 text-xl font-semibold">History of important actions</h2>
      <div className="overflow-x-auto">
        <table className="w-full text-left text-sm">
          <caption className="sr-only">Audit history</caption>
          <thead><tr className="border-b border-line"><th scope="col" className="p-2">When</th><th scope="col" className="p-2">Who</th><th scope="col" className="p-2">What</th></tr></thead>
          <tbody>{ev.map((e) => <tr key={e.id} className="border-b border-line"><td className="p-2 whitespace-nowrap">{new Date(e.at).toLocaleString()}</td><td className="p-2">{e.actor}{e.actorType === "participant" ? " (participant)" : ""}</td><td className="p-2">{LABEL[e.action] ?? e.action}{e.action === "proceed_override" && e.detail ? ` — reason: ${String(e.detail.reason)}` : ""}</td></tr>)}</tbody>
        </table>
      </div>
    </Card>
  );
}
