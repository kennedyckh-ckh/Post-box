"use client";
import { useState } from "react";
import { api } from "@/lib/client/api";
import { Card, Button, TextField, Field, inputCls } from "@/components/ui";
import type { Detail, Act } from "./types";

export function SetupTab({ d, act }: { d: Detail; act: Act }) {
  const s = d.session;
  const [title, setTitle] = useState(s.title);
  const [labels, setLabels] = useState(s.participantFields.map((f) => ({ label: f.label, required: f.required })));
  const [mode, setMode] = useState(s.groupJoinMode);
  const [policy, setPolicy] = useState(s.submitPolicy);
  const [early, setEarly] = useState(s.earlyJoin);
  const archived = s.status === "archived";
  const owner = s.myRole === "owner";
  const [email, setEmail] = useState("");

  return (
    <div className="grid gap-6 lg:grid-cols-2">
      <Card>
        <h2 className="mb-4 text-xl font-semibold">Session settings</h2>
        <form onSubmit={(e) => { e.preventDefault(); void act(() => api("PATCH", `/sessions/${s.id}`, { title, participantFields: labels.filter((l) => l.label.trim()), groupJoinMode: mode, submitPolicy: policy, earlyJoin: early }), "Settings saved."); }}>
          <TextField label="Session title" value={title} onChange={setTitle} maxLength={120} />
          <Field label="How participants get a group">
            {(id) => <select id={id} className={inputCls} value={mode} onChange={(e) => setMode(e.target.value as typeof mode)}><option value="choose">They choose a group (with PIN if set)</option><option value="assigned">I assign them after they join</option></select>}
          </Field>
          <Field label="Who may submit the group's work">
            {(id) => <select id={id} className={inputCls} value={policy} onChange={(e) => setPolicy(e.target.value as typeof policy)}><option value="any">Any group member</option><option value="representative">Only the nominated representative</option></select>}
          </Field>
          <label className="mb-4 flex min-h-11 items-center gap-2"><input type="checkbox" className="h-5 w-5" checked={early} onChange={(e) => setEarly(e.target.checked)} /> Let participants join before I start the session</label>
          <fieldset className="mb-4">
            <legend className="mb-1 text-sm font-semibold">Optional participant fields</legend>
            <p className="mb-2 text-sm text-slate-700">For example Class and Class Number. Leave empty if you do not need them. Changes apply to people who join afterwards.</p>
            {labels.map((l, i) => (
              <div key={i} className="mb-2 flex flex-wrap items-center gap-2">
                <input aria-label={`Field ${i + 1} label`} className={`${inputCls} max-w-56`} value={l.label} maxLength={40} onChange={(e) => setLabels(labels.map((x, j) => (j === i ? { ...x, label: e.target.value } : x)))} />
                <label className="flex min-h-11 items-center gap-2"><input type="checkbox" className="h-5 w-5" checked={l.required} onChange={(e) => setLabels(labels.map((x, j) => (j === i ? { ...x, required: e.target.checked } : x)))} /> Required</label>
                <Button variant="secondary" onClick={() => setLabels(labels.filter((_, j) => j !== i))}>Remove</Button>
              </div>
            ))}
            {labels.length < 6 && <Button variant="secondary" onClick={() => setLabels([...labels, { label: "", required: false }])}>Add a field</Button>}
          </fieldset>
          <Button type="submit" disabled={archived || !title.trim()}>Save settings</Button>
        </form>
      </Card>
      <Card>
        <h2 className="mb-4 text-xl font-semibold">Facilitators</h2>
        <ul className="mb-4 divide-y divide-line">
          {d.facilitators.map((f) => (
            <li key={f.id} className="flex flex-wrap items-center justify-between gap-2 py-2">
              <span><strong>{f.name}</strong> · {f.email} · {f.role === "owner" ? "Owner" : "Co-facilitator"}</span>
              {owner && f.role === "co" && <Button variant="secondary" onClick={() => { if (confirm(`Remove ${f.name} from this session?`)) void act(() => api("DELETE", `/sessions/${s.id}/facilitators/${f.id}`), "Removed."); }}>Remove</Button>}
            </li>
          ))}
        </ul>
        {owner ? (
          <form onSubmit={(e) => { e.preventDefault(); void act(async () => { await api("POST", `/sessions/${s.id}/facilitators`, { email }); setEmail(""); }, "Co-facilitator added."); }}>
            <TextField label="Add a co-facilitator by email" type="email" value={email} onChange={setEmail} hint="They need a facilitator account. Only people you add here can open this session." />
            <Button type="submit" disabled={archived || !email.trim()}>Add</Button>
          </form>
        ) : <p className="text-sm">Only the owner can add or remove co-facilitators.</p>}
      </Card>
    </div>
  );
}
