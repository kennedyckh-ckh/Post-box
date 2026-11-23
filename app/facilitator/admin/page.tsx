"use client";
import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { api, errText } from "@/lib/client/api";
import { Shell, Card, Button, TextField, Alert, Badge, SignOutButton } from "@/components/ui";

interface U { id: string; email: string; name: string; isAdmin: boolean; mustChangePassword: boolean; disabled: boolean }

export default function AdminPage() {
  const [users, setUsers] = useState<U[]>([]);
  const [error, setError] = useState("");
  const [email, setEmail] = useState("");
  const [name, setName] = useState("");
  const [temp, setTemp] = useState<{ who: string; pw: string } | null>(null);
  const load = useCallback(() => api<{ users: U[] }>("GET", "/admin/users").then((r) => setUsers(r.users)).catch((e) => setError(errText(e))), []);
  useEffect(() => { void load(); }, [load]);

  return (
    <Shell wide title="Administration" right={<SignOutButton />}>
      <p className="mb-4 text-sm"><Link href="/facilitator" className="font-semibold text-muted hover:text-brand-strong">← Your sessions</Link></p>
      {error && <Alert kind="error">{error}</Alert>}
      {temp && <Alert kind="warning">Temporary password for {temp.who}: <span className="select-all font-mono font-bold">{temp.pw}</span>. It is shown only once. Give it to them privately; they must choose their own at first sign-in.</Alert>}
      <Card className="mb-6">
        <h2 className="mb-3 text-xl font-semibold">Add a facilitator</h2>
        <form onSubmit={async (e) => { e.preventDefault(); setError(""); try { const r = await api<{ temporaryPassword: string }>("POST", "/admin/users", { email, name }); setTemp({ who: email, pw: r.temporaryPassword }); setEmail(""); setName(""); void load(); } catch (err) { setError(errText(err)); } }}>
          <TextField label="Name" value={name} onChange={setName} required />
          <TextField label="Email" type="email" value={email} onChange={setEmail} required />
          <Button type="submit">Create account</Button>
        </form>
      </Card>
      <Card>
        <h2 className="mb-3 text-xl font-semibold">Accounts</h2>
        <ul className="divide-y divide-line">
          {users.map((u) => (
            <li key={u.id} className="flex flex-wrap items-center justify-between gap-2 py-3">
              <span><strong>{u.name}</strong> · {u.email} {u.isAdmin && <Badge tone="blue">Administrator</Badge>} {u.disabled && <Badge tone="red">Disabled</Badge>} {u.mustChangePassword && <Badge tone="amber">Temporary password</Badge>}</span>
              <span className="flex gap-2">
                <Button variant="secondary" onClick={async () => { if (confirm(`Create a new temporary password for ${u.email}? They will be signed out.`)) { try { const r = await api<{ temporaryPassword: string }>("POST", `/admin/users/${u.id}/reset-password`, {}); setTemp({ who: u.email, pw: r.temporaryPassword }); void load(); } catch (e) { setError(errText(e)); } } }}>Reset password</Button>
                <Button variant={u.disabled ? "secondary" : "danger"} onClick={async () => { if (confirm(u.disabled ? `Re-enable ${u.email}?` : `Disable ${u.email}? They will be signed out.`)) { try { await api("POST", `/admin/users/${u.id}/disabled`, { disabled: !u.disabled }); void load(); } catch (e) { setError(errText(e)); } } }}>{u.disabled ? "Enable" : "Disable"}</Button>
              </span>
            </li>
          ))}
        </ul>
      </Card>
    </Shell>
  );
}
