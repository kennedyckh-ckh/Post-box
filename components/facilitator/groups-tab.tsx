"use client";
import { useState } from "react";
import { api } from "@/lib/client/api";
import { Card, Button, TextField, Badge, Field, inputCls } from "@/components/ui";
import type { Detail, Act } from "./types";

function GroupRow({ g, d, act }: { g: Detail["groups"][number]; d: Detail; act: Act }) {
  const [name, setName] = useState(g.name);
  const [cap, setCap] = useState(g.seatCap === null ? "" : String(g.seatCap));
  const [pin, setPin] = useState("");
  const archived = d.session.status === "archived";
  return (
    <li>
      <Card as="div">
        <div className="mb-3 flex flex-wrap items-center gap-2">
          <h2 className="text-lg font-semibold">{g.name}</h2>
          <Badge>{g.activeCount}{g.seatCap ? ` of ${g.seatCap}` : ""} members</Badge>
          <Badge tone={g.hasPin ? "blue" : "gray"}>{g.hasPin ? "PIN set" : "No PIN"}</Badge>
        </div>
        <div className="grid gap-x-4 sm:grid-cols-3">
          <TextField label="Group name" value={name} onChange={setName} maxLength={60} />
          <TextField label="Seat cap (blank = no limit)" type="number" value={cap} onChange={setCap} />
          <Field label={g.hasPin ? "Replace PIN (not shown)" : "Set a PIN (optional)"} hint="4 to 20 characters.">
            {(id, dd) => <input id={id} aria-describedby={dd} className={inputCls} type="password" autoComplete="off" value={pin} onChange={(e) => setPin(e.target.value)} />}
          </Field>
        </div>
        <div className="flex flex-wrap gap-2">
          <Button disabled={archived} onClick={() => void act(async () => { const body: Record<string, unknown> = { name, seatCap: cap.trim() === "" ? null : Number(cap) }; if (pin) body.pin = pin; await api("PATCH", `/groups/${g.id}`, body); setPin(""); }, "Group saved.")}>Save group</Button>
          {g.hasPin && <Button variant="secondary" disabled={archived} onClick={() => { if (confirm("Remove the PIN? Anyone with the join code could then join this group.")) void act(() => api("PATCH", `/groups/${g.id}`, { pin: null }), "PIN removed."); }}>Remove PIN</Button>}
          <Button variant="danger" disabled={archived} onClick={() => { if (confirm(`Delete "${g.name}"? This only works for groups that never had members.`)) void act(() => api("DELETE", `/groups/${g.id}`), "Group deleted."); }}>Delete group</Button>
        </div>
      </Card>
    </li>
  );
}

export function GroupsTab({ d, act }: { d: Detail; act: Act }) {
  const [name, setName] = useState("");
  return (
    <div>
      <ul className="mb-6 grid gap-4">{d.groups.map((g) => <GroupRow key={g.id} g={g} d={d} act={act} />)}</ul>
      <Card>
        <h2 className="mb-3 text-xl font-semibold">Add a group</h2>
        <form onSubmit={(e) => { e.preventDefault(); void act(async () => { await api("POST", `/sessions/${d.session.id}/groups`, { name }); setName(""); }, "Group added."); }}>
          <TextField label="Group name" value={name} onChange={setName} maxLength={60} />
          <Button type="submit" disabled={d.session.status === "archived" || !name.trim()}>Add group</Button>
        </form>
      </Card>
    </div>
  );
}
