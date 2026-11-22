"use client";
import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { api, errText, ApiError } from "@/lib/client/api";
import { Shell, Card, Button, Alert, Badge, LogoffButton } from "@/components/ui";

interface Me {
  participant: { id: string; displayName: string; extra: { label: string; value: string }[] };
  session: { title: string; status: string; archived: boolean };
  group: { id: string; name: string } | null;
  awaitingGroup: boolean;
  stages: { id: string; position: number; title: string; availability: "locked" | "open" | "closed"; excluded: boolean }[];
}

const label = { locked: "Locked (not open yet)", open: "Open", closed: "Closed" } as const;

export default function ParticipantHome() {
  const [me, setMe] = useState<Me | null>(null);
  const [error, setError] = useState("");
  const [needJoin, setNeedJoin] = useState(false);
  const [newCode, setNewCode] = useState("");

  const load = useCallback(async () => {
    try {
      setMe(await api<Me>("GET", "/me"));
      setError("");
    } catch (e) {
      if (e instanceof ApiError && e.status === 401) setNeedJoin(true);
      else setError(errText(e));
    }
  }, []);

  useEffect(() => {
    void load();
    const t = setInterval(load, 8000);
    return () => clearInterval(t);
  }, [load]);

  if (needJoin)
    return (
      <Shell title="Please sign in again">
        <Card>
          <p className="mb-4">We could not find your session on this device.</p>
          <Link href="/recover" className="font-semibold underline">Use your recovery code</Link> or <Link href="/join" className="font-semibold underline">join again</Link>.
        </Card>
      </Shell>
    );
  if (!me) return <Shell title="Loading…">{error ? <Alert kind="error">{error}</Alert> : <p role="status">Loading your session…</p>}</Shell>;

  return (
    <Shell title={me.session.title} right={<LogoffButton />}>
      {error && <Alert kind="error">{error} We will keep trying.</Alert>}
      {me.session.archived && <Alert kind="info">This session has been archived and is read-only.</Alert>}
      <Card className="mb-4">
        <p>Signed in as <strong>{me.participant.displayName}</strong>{me.participant.extra.length > 0 && ` (${me.participant.extra.map((e) => `${e.label}: ${e.value}`).join(", ")})`}</p>
        <p className="mt-1">Group: <strong>{me.group ? me.group.name : "waiting for your facilitator to place you"}</strong></p>
      </Card>
      <Card className="mb-4">
        <h2 className="mb-3 text-xl font-semibold">Parts</h2>
        <ol className="space-y-2">
          {me.stages.map((s) => (
            <li key={s.id} className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-line p-3">
              {s.availability !== "locked" && !s.excluded && me.group ? <Link href={`/session/stage/${s.id}`} className="font-semibold underline">{s.title}</Link> : <span className="font-semibold">{s.title}</span>}
              <Badge tone={s.availability === "open" ? "green" : s.availability === "closed" ? "amber" : "gray"}>{s.excluded ? "Not used by your group" : label[s.availability]}</Badge>
            </li>
          ))}
        </ol>
        <p className="mt-3 text-sm text-slate-700">A part's questions and work area appear once your facilitator opens it. Closed parts can still be read.</p>
      </Card>
      <Card className="mb-4">
        <h2 className="mb-1 text-xl font-semibold">Shared with the class</h2>
        <p className="mb-2 text-sm">Items your facilitator has chosen to share, where you can react and respond.</p>
        <Link href="/session/board" className="inline-flex min-h-11 items-center rounded-lg border border-brand px-4 font-semibold text-brand-strong">Open the class board</Link>
      </Card>
      <Card>
        <h2 className="mb-2 text-lg font-semibold">Your recovery code</h2>
        <p className="mb-3 text-sm">Lost your code? Replace it here. The old one stops working.</p>
        {newCode && <p className="mb-3 select-all rounded-lg bg-slate-100 p-3 text-center font-mono text-xl font-bold tracking-widest">{newCode}</p>}
        <Button variant="secondary" onClick={async () => { if (confirm("Replace your recovery code? The old code will stop working.")) { try { setNewCode((await api<{ recoveryCode: string }>("POST", "/me/recovery-code", {})).recoveryCode); } catch (e) { setError(errText(e)); } } }}>Get a new recovery code</Button>
      </Card>
    </Shell>
  );
}
