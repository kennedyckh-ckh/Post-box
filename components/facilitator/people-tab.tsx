"use client";
import { useCallback, useEffect, useState } from "react";
import { api, errText } from "@/lib/client/api";
import { Card, Button, Alert, Badge, inputCls } from "@/components/ui";
import type { Detail, Act } from "./types";

interface P { id: string; displayName: string; groupId: string | null; status: "active" | "removed"; fields: { label: string; value: string }[] }

export function PeopleTab({ d, act }: { d: Detail; act: Act }) {
  const [people, setPeople] = useState<P[] | null>(null);
  const [err, setErr] = useState("");
  const [code, setCode] = useState<{ who: string; code: string } | null>(null);
  const archived = d.session.status === "archived";
  const load = useCallback(() => api<{ participants: P[] }>("GET", `/sessions/${d.session.id}/participants`).then((r) => setPeople(r.participants)).catch((e) => setErr(errText(e))), [d.session.id]);
  useEffect(() => { void load(); const t = setInterval(load, 6000); return () => clearInterval(t); }, [load]);
  const doAct: Act = async (fn, ok) => { await act(fn, ok); await load(); };
  const gname = (id: string | null) => d.groups.find((g) => g.id === id)?.name ?? "No group yet";

  return (
    <div>
      {err && <Alert kind="error">{err}</Alert>}
      {code && <Alert kind="warning">New recovery code for {code.who}: <span className="select-all font-mono text-lg font-bold">{code.code}</span>. Shown only once. Pass it on privately. Their old code and signed-in devices no longer work.</Alert>}
      <Card>
        <h2 className="mb-3 text-xl font-semibold">Participants {people && <Badge>{people.filter((p) => p.status === "active").length} active</Badge>}</h2>
        {!people ? <p role="status">Loading…</p> : people.length === 0 ? <p>Nobody has joined yet. Share the join code above.</p> : (
          <div className="overflow-x-auto">
            <table className="w-full text-left text-sm">
              <caption className="sr-only">Participants and their groups</caption>
              <thead><tr className="border-b border-line"><th scope="col" className="p-2">Name</th><th scope="col" className="p-2">Details</th><th scope="col" className="p-2">Group</th><th scope="col" className="p-2">Status</th><th scope="col" className="p-2">Actions</th></tr></thead>
              <tbody>
                {people.map((p) => (
                  <tr key={p.id} className="border-b border-line align-top">
                    <th scope="row" className="p-2 font-semibold">{p.displayName}</th>
                    <td className="p-2">{p.fields.filter((f) => f.value).map((f) => `${f.label}: ${f.value}`).join(", ") || "—"}</td>
                    <td className="p-2">
                      <label className="sr-only" htmlFor={`g-${p.id}`}>Move {p.displayName} to group</label>
                      <select id={`g-${p.id}`} className={`${inputCls} min-w-40`} disabled={archived || p.status !== "active"} value={p.groupId ?? ""}
                        onChange={(e) => { const to = e.target.value; if (!to || to === p.groupId) return; if (!confirm(`Move ${p.displayName} to ${gname(to)}? Their earlier contributions stay with their original group.`)) { void load(); return; } void act(async () => { try { await api("POST", `/participants/${p.id}/move`, { groupId: to }); } catch (er) { if (/full/i.test(errText(er)) && confirm(`${errText(er)}\n\nMove anyway, over the seat cap?`)) await api("POST", `/participants/${p.id}/move`, { groupId: to, overrideCap: true }); else throw er; } }, "Moved.").then(load); }}>
                        {!p.groupId && <option value="">No group yet</option>}
                        {d.groups.map((g) => <option key={g.id} value={g.id}>{g.name}</option>)}
                      </select>
                    </td>
                    <td className="p-2"><Badge tone={p.status === "active" ? "green" : "red"}>{p.status === "active" ? "Active" : "Removed"}</Badge></td>
                    <td className="p-2">
                      <div className="flex flex-wrap gap-2">
                        {p.status === "active" ? (
                          <>
                            <Button variant="secondary" disabled={archived} onClick={() => { if (confirm(`Issue a new recovery code for ${p.displayName}? Their old code and signed-in devices stop working.`)) void (async () => { try { const r = await api<{ recoveryCode: string }>("POST", `/participants/${p.id}/recovery-code`, {}); setCode({ who: p.displayName, code: r.recoveryCode }); } catch (e) { setErr(errText(e)); } })(); }}>New recovery code</Button>
                            <Button variant="danger" disabled={archived} onClick={() => { if (confirm(`Remove ${p.displayName}? They lose access immediately. Their contributions are kept.`)) void doAct(() => api("POST", `/participants/${p.id}/remove`, {}), "Removed. Their contributions are kept."); }}>Remove</Button>
                          </>
                        ) : (
                          <Button variant="secondary" disabled={archived} onClick={() => void doAct(async () => { try { await api("POST", `/participants/${p.id}/restore`, {}); } catch (er) { if (/full/i.test(errText(er)) && confirm(`${errText(er)}\n\nRestore anyway, over the seat cap?`)) await api("POST", `/participants/${p.id}/restore`, { overrideCap: true }); else throw er; } }, "Restored.")}>Restore</Button>
                        )}
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>
    </div>
  );
}
