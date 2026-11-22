"use client";
import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { api, errText, ApiError } from "@/lib/client/api";
import { Shell, Card, Button, TextField, Field, Alert, Badge, inputCls } from "@/components/ui";

interface User { id: string; name: string; email: string; isAdmin: boolean; mustChangePassword: boolean }
interface SessionRow { id: string; title: string; status: string; joinCode: string; participantCount: number; groupCount: number; myRole: string }
interface Tpl { key: string; label: string; description: string }

function Login({ onDone }: { onDone: () => void }) {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  return (
    <Shell title="Facilitator sign in">
      <Card>
        {error && <Alert kind="error">{error}</Alert>}
        <form onSubmit={async (e) => { e.preventDefault(); setBusy(true); setError(""); try { await api("POST", "/auth/login", { email, password }); onDone(); } catch (err) { setError(errText(err)); } finally { setBusy(false); } }}>
          <TextField label="Email" type="email" value={email} onChange={setEmail} autoComplete="username" required />
          <TextField label="Password" type="password" value={password} onChange={setPassword} autoComplete="current-password" required />
          <Button type="submit" disabled={busy}>{busy ? "Signing in…" : "Sign in"}</Button>
        </form>
        <p className="mt-4 text-sm">Accounts are created by your administrator. Forgot your password? Ask them for a new temporary one. <Link href="/" className="underline">Back</Link></p>
      </Card>
    </Shell>
  );
}

function ChangePassword({ onDone }: { onDone: () => void }) {
  const [cur, setCur] = useState("");
  const [next, setNext] = useState("");
  const [error, setError] = useState("");
  return (
    <Shell title="Choose a new password">
      <Card>
        <Alert kind="info">Your account uses a temporary password. Choose your own (at least 10 characters) to continue.</Alert>
        {error && <Alert kind="error">{error}</Alert>}
        <form onSubmit={async (e) => { e.preventDefault(); setError(""); try { await api("POST", "/auth/change-password", { currentPassword: cur, newPassword: next }); onDone(); } catch (err) { setError(errText(err)); } }}>
          <TextField label="Temporary password" type="password" value={cur} onChange={setCur} autoComplete="current-password" required />
          <TextField label="New password" type="password" value={next} onChange={setNext} autoComplete="new-password" required />
          <Button type="submit">Save password</Button>
        </form>
      </Card>
    </Shell>
  );
}

function CreateSession({ onCreated }: { onCreated: (id: string) => void }) {
  const [title, setTitle] = useState("");
  const [templates, setTemplates] = useState<Tpl[]>([]);
  const [template, setTemplate] = useState("blank");
  const [groups, setGroups] = useState("4");
  const [stages, setStages] = useState([true, true, true]);
  const [useClass, setUseClass] = useState(false);
  const [error, setError] = useState("");
  useEffect(() => { api<{ templates: Tpl[] }>("GET", "/templates").then((r) => setTemplates(r.templates)).catch(() => {}); }, []);
  return (
    <Card>
      <h2 className="mb-4 text-xl font-semibold">New session</h2>
      {error && <Alert kind="error">{error}</Alert>}
      <form onSubmit={async (e) => {
        e.preventDefault(); setError("");
        try {
          const r = await api<{ id: string }>("POST", "/sessions", { title, template, groupCount: Number(groups), enabledStages: stages, participantFields: useClass ? [{ label: "Class", required: false }, { label: "Class Number", required: false }] : [] });
          onCreated(r.id);
        } catch (err) { setError(errText(err)); }
      }}>
        <TextField label="Session title" value={title} onChange={setTitle} maxLength={120} required />
        <Field label="Starting template" hint={templates.find((t) => t.key === template)?.description}>
          {(id, d) => <select id={id} aria-describedby={d} className={inputCls} value={template} onChange={(e) => setTemplate(e.target.value)}>{templates.map((t) => <option key={t.key} value={t.key}>{t.label}</option>)}</select>}
        </Field>
        <TextField label="Number of groups" type="number" value={groups} onChange={setGroups} hint="You can rename, add and remove groups later." />
        <fieldset className="mb-4">
          <legend className="mb-1 text-sm font-semibold">Stages to use</legend>
          <div className="flex flex-wrap gap-4">
            {stages.map((on, i) => (
              <label key={i} className="flex min-h-11 items-center gap-2">
                <input type="checkbox" className="h-5 w-5" checked={on} onChange={(e) => setStages(stages.map((s, j) => (j === i ? e.target.checked : s)))} /> Part {i + 1}
              </label>
            ))}
          </div>
        </fieldset>
        <label className="mb-4 flex min-h-11 items-center gap-2">
          <input type="checkbox" className="h-5 w-5" checked={useClass} onChange={(e) => setUseClass(e.target.checked)} /> Ask participants for Class and Class Number (optional fields)
        </label>
        <div><Button type="submit" disabled={!title.trim() || !stages.some(Boolean)}>Create session</Button></div>
      </form>
    </Card>
  );
}

export default function FacilitatorHome() {
  const [user, setUser] = useState<User | null | undefined>(undefined);
  const [sessions, setSessions] = useState<SessionRow[]>([]);
  const [error, setError] = useState("");
  const [creating, setCreating] = useState(false);

  const loadUser = useCallback(async () => {
    try { setUser((await api<{ user: User }>("GET", "/auth/me")).user); } catch (e) { if (e instanceof ApiError && e.status === 401) setUser(null); else setError(errText(e)); }
  }, []);
  useEffect(() => { void loadUser(); }, [loadUser]);
  useEffect(() => {
    if (user && !user.mustChangePassword) api<{ sessions: SessionRow[] }>("GET", "/sessions").then((r) => setSessions(r.sessions)).catch((e) => setError(errText(e)));
  }, [user]);

  if (user === undefined) return <Shell title="Loading…">{error ? <Alert kind="error">{error}</Alert> : <p role="status">Loading…</p>}</Shell>;
  if (user === null) return <Login onDone={loadUser} />;
  if (user.mustChangePassword) return <ChangePassword onDone={loadUser} />;

  return (
    <Shell wide title="Your sessions">
      <div className="mb-6 flex flex-wrap items-center justify-between gap-3">
        <p>Signed in as <strong>{user.name}</strong> ({user.email})</p>
        <div className="flex gap-2">
          <Link href="/facilitator/ai-usage" className="inline-flex min-h-11 items-center rounded-lg border border-brand px-4 font-semibold text-brand-strong">AI usage</Link>
          {user.isAdmin && <Link href="/facilitator/admin" className="inline-flex min-h-11 items-center rounded-lg border border-brand px-4 font-semibold text-brand-strong">Administration</Link>}
          <Button variant="secondary" onClick={async () => { await api("POST", "/auth/logout", {}); setUser(null); }}>Sign out</Button>
        </div>
      </div>
      {error && <Alert kind="error">{error}</Alert>}
      {creating ? <CreateSession onCreated={(id) => { window.location.href = `/facilitator/sessions/${id}`; }} /> : <Button onClick={() => setCreating(true)}>Create a session</Button>}
      <h2 className="mb-3 mt-8 text-xl font-semibold">Sessions you facilitate</h2>
      {sessions.length === 0 ? (
        <Card><p>No sessions yet. Create one to get a join code for your participants.</p></Card>
      ) : (
        <ul className="grid gap-3 sm:grid-cols-2">
          {sessions.map((s) => (
            <li key={s.id}>
              <Card as="div">
                <div className="flex items-start justify-between gap-2">
                  <h3 className="text-lg font-semibold"><Link href={`/facilitator/sessions/${s.id}`} className="underline">{s.title}</Link></h3>
                  <Badge tone={s.status === "live" ? "green" : s.status === "archived" ? "gray" : "amber"}>{s.status === "setup" ? "Setting up" : s.status === "live" ? "Live" : "Archived"}</Badge>
                </div>
                <p className="mt-1 text-sm">{s.participantCount} participants · {s.groupCount} groups · {s.myRole === "owner" ? "You own this" : "You co-facilitate"}</p>
                <p className="mt-1 text-sm">Join code: <span className="font-mono font-bold">{s.joinCode}</span></p>
              </Card>
            </li>
          ))}
        </ul>
      )}
    </Shell>
  );
}
