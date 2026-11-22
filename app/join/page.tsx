"use client";
import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { api, errText } from "@/lib/client/api";
import { Shell, Card, Button, TextField, Field, Alert, inputCls } from "@/components/ui";

interface PublicSession {
  title: string;
  joinable: boolean;
  reason: string | null;
  groupJoinMode: "choose" | "assigned";
  fields: { key: string; label: string; required: boolean }[];
  groups: { id: string; name: string; hasPin: boolean; full: boolean; seatsLeft: number | null }[];
}

export default function JoinPage() {
  const router = useRouter();
  const [code, setCode] = useState("");
  const [info, setInfo] = useState<PublicSession | null>(null);
  const [name, setName] = useState("");
  const [groupId, setGroupId] = useState("");
  const [pin, setPin] = useState("");
  const [extra, setExtra] = useState<Record<string, string>>({});
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [recovery, setRecovery] = useState("");
  const [saved, setSaved] = useState(false);

  async function lookup(e: React.FormEvent) {
    e.preventDefault();
    setError("");
    setBusy(true);
    try {
      setInfo(await api<PublicSession>("GET", `/public/session?code=${encodeURIComponent(code)}`));
    } catch (err) {
      setError(errText(err));
    } finally {
      setBusy(false);
    }
  }

  async function join(e: React.FormEvent) {
    e.preventDefault();
    setError("");
    setBusy(true);
    try {
      const r = await api<{ recoveryCode: string }>("POST", "/join", { joinCode: code, displayName: name, groupId: groupId || undefined, pin: pin || undefined, extra });
      setRecovery(r.recoveryCode);
    } catch (err) {
      setError(errText(err));
    } finally {
      setBusy(false);
    }
  }

  if (recovery) {
    return (
      <Shell title="You have joined">
        <Card>
          <h2 className="text-xl font-semibold">Save your recovery code</h2>
          <p className="mt-2">This code lets you get back to your work from another phone or computer. <strong>It is shown only once.</strong> Typing your name is not enough to get back in, so keep this code private.</p>
          <p className="my-4 select-all rounded-lg bg-slate-100 p-4 text-center font-mono text-2xl font-bold tracking-widest" aria-label={`Your recovery code is ${recovery.split("").join(" ")}`}>{recovery}</p>
          <p className="mb-4 text-sm text-slate-700">Write it down or take a screenshot. If you lose it and your device is signed out, ask your facilitator for a new one.</p>
          <label className="mb-4 flex min-h-11 items-center gap-3">
            <input type="checkbox" className="h-5 w-5" checked={saved} onChange={(e) => setSaved(e.target.checked)} />
            <span>I have saved my recovery code</span>
          </label>
          <Button disabled={!saved} onClick={() => router.push("/session")}>Continue to my session</Button>
        </Card>
      </Shell>
    );
  }

  return (
    <Shell title="Join a session">
      {error && <Alert kind="error">{error}</Alert>}
      {!info ? (
        <Card>
          <form onSubmit={lookup}>
            <TextField label="Session join code" value={code} onChange={setCode} hint="Six letters and numbers, from your facilitator." autoComplete="off" required />
            <Button type="submit" disabled={busy || !code.trim()}>{busy ? "Checking…" : "Continue"}</Button>
          </form>
        </Card>
      ) : !info.joinable ? (
        <Card>
          <h2 className="text-xl font-semibold">{info.title}</h2>
          <Alert kind="warning">{info.reason === "joining_closed" ? "Joining is closed for this session. Ask your facilitator." : "This session has not started yet. Try again when your facilitator says it has."}</Alert>
          <Button variant="secondary" onClick={() => setInfo(null)}>Use a different code</Button>
        </Card>
      ) : (
        <Card>
          <h2 className="mb-4 text-xl font-semibold">{info.title}</h2>
          <form onSubmit={join}>
            <TextField label="Your name" value={name} onChange={setName} hint="Shown to your group. Two people can share a name; each person still has their own private access." maxLength={60} required />
            {info.fields.map((f) => (
              <TextField key={f.key} label={f.label} required={f.required} value={extra[f.key] || ""} onChange={(v) => setExtra({ ...extra, [f.key]: v })} maxLength={60} />
            ))}
            {info.groupJoinMode === "choose" ? (
              <>
                <Field label="Your group">
                  {(id) => (
                    <select id={id} className={inputCls} value={groupId} onChange={(e) => setGroupId(e.target.value)} required>
                      <option value="">Choose a group…</option>
                      {info.groups.map((g) => (
                        <option key={g.id} value={g.id} disabled={g.full}>
                          {g.name}{g.full ? " (full)" : g.seatsLeft !== null ? ` (${g.seatsLeft} seats left)` : ""}{g.hasPin ? " (needs PIN)" : ""}
                        </option>
                      ))}
                    </select>
                  )}
                </Field>
                {info.groups.find((g) => g.id === groupId)?.hasPin && <TextField label="Group PIN" type="password" value={pin} onChange={setPin} hint="Ask your facilitator or group." autoComplete="off" required />}
              </>
            ) : (
              <Alert kind="info">Your facilitator will place you in a group after you join.</Alert>
            )}
            <p className="mb-4 text-sm text-slate-800">Your facilitator and your group will see your name and what you write. <Link href="/notice" target="_blank" rel="noopener noreferrer" className="font-semibold underline">Read how your information is used (opens in a new tab)</Link>.</p>
            <Button type="submit" disabled={busy || !name.trim() || (info.groupJoinMode === "choose" && !groupId)}>{busy ? "Joining…" : "Join"}</Button>
          </form>
        </Card>
      )}
      <p className="mt-6 text-sm">
        Already joined? <Link href="/recover" className="font-semibold underline">Use your recovery code</Link> · <Link href="/" className="underline">Back</Link>
      </p>
    </Shell>
  );
}
