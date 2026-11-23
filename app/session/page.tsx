"use client";
import { Suspense, useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { ParticipantTimer } from "@/components/timer";
import { api, errText, ApiError } from "@/lib/client/api";
import { Shell, Card, Button, Alert, Badge, LogoffButton, linkButtonCls } from "@/components/ui";

interface Me {
  participant: { id: string; displayName: string; extra: { label: string; value: string }[] };
  session: { title: string; status: string; archived: boolean };
  group: { id: string; name: string } | null;
  awaitingGroup: boolean;
  stages: { id: string; position: number; title: string; availability: "locked" | "open" | "closed"; excluded: boolean }[];
}

const label = { locked: "Locked (not open yet)", open: "Open", closed: "Closed" } as const;

/** The private recovery code is never shown at joining. It is revealed here, on click, from the participant's own signed-in device. */
function RecoveryCard({ archived, onError }: { archived: boolean; onError: (m: string) => void }) {
  const [code, setCode] = useState<string | null>(null);
  const [state, setState] = useState<"hidden" | "loading" | "shown" | "unavailable">("hidden");
  const [copied, setCopied] = useState(false);

  async function show() {
    setState("loading");
    try {
      const r = await api<{ recoveryCode: string | null }>("GET", "/me/recovery-code");
      if (r.recoveryCode) { setCode(r.recoveryCode); setState("shown"); } else setState("unavailable");
    } catch (e) { setState("hidden"); onError(errText(e)); }
  }
  async function replace() {
    if (!confirm("Make a new recovery code? The old code will stop working.")) return;
    try { const r = await api<{ recoveryCode: string }>("POST", "/me/recovery-code", {}); setCode(r.recoveryCode); setState("shown"); setCopied(false); } catch (e) { onError(errText(e)); }
  }

  return (
    <Card>
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="max-w-md">
          <h2 className="text-xl text-ink">Your recovery code</h2>
          <p className="mt-1 text-sm text-muted">Use it to get back to your work from another phone or computer, or after logging off. Keep it private: typing your name is not enough to get back in.</p>
        </div>
        {state !== "shown" && <Button variant="secondary" disabled={state === "loading"} onClick={() => void show()}>{state === "loading" ? "Loading…" : "Show my recovery code"}</Button>}
      </div>
      {state === "shown" && code && (
        <div className="mt-4">
          <p className="select-all rounded-xl border border-dashed border-line-strong bg-surface-2 p-4 text-center font-mono text-2xl font-bold tracking-[0.2em] text-ink" aria-label={`Your recovery code is ${code.split("").join(" ")}`}>{code}</p>
          <div className="mt-3 flex flex-wrap gap-2">
            <Button variant="secondary" onClick={() => { void navigator.clipboard?.writeText(code).then(() => setCopied(true)).catch(() => {}); }}>{copied ? "Copied" : "Copy code"}</Button>
            <Button variant="ghost" onClick={() => { setState("hidden"); setCode(null); setCopied(false); }}>Hide</Button>
            {!archived && <Button variant="ghost" onClick={() => void replace()}>Make a new code</Button>}
          </div>
          <p className="mt-2 text-sm text-muted">Write it down or take a screenshot. You can come back here to see it again at any time while you are signed in.</p>
        </div>
      )}
      {state === "unavailable" && (
        <div className="mt-4">
          <Alert kind="info">Your code was created before codes could be shown again, so it cannot be displayed. Make a new one below; your old code will stop working.</Alert>
          {!archived && <Button onClick={() => void replace()}>Make a new recovery code</Button>}
        </div>
      )}
    </Card>
  );
}

function ParticipantHomeInner() {
  const welcome = useSearchParams().get("welcome") === "1";
  const [me, setMe] = useState<Me | null>(null);
  const [error, setError] = useState("");
  const [needJoin, setNeedJoin] = useState(false);

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
    <Shell title={me.session.title} right={<LogoffButton />} banner={<ParticipantTimer />}>
      {welcome && <Alert kind="success">You have joined. Your private recovery code is at the bottom of this page whenever you need it.</Alert>}
      {error && <Alert kind="error">{error} We will keep trying.</Alert>}
      {me.session.archived && <Alert kind="info">This session has been archived and is read-only.</Alert>}
      <Card className="mb-4">
        <div className="flex flex-wrap items-center gap-x-8 gap-y-2">
          <div>
            <p className="text-xs font-semibold uppercase tracking-[0.14em] text-accent">Signed in as</p>
            <p className="mt-0.5 font-semibold text-ink">{me.participant.displayName}{me.participant.extra.length > 0 && <span className="font-normal text-muted"> ({me.participant.extra.map((e) => `${e.label}: ${e.value}`).join(", ")})</span>}</p>
          </div>
          <div>
            <p className="text-xs font-semibold uppercase tracking-[0.14em] text-accent">Group</p>
            <p className="mt-0.5 font-semibold text-ink">{me.group ? me.group.name : <span className="font-normal text-muted">waiting for your facilitator to place you</span>}</p>
          </div>
        </div>
      </Card>
      <Card className="mb-4">
        <h2 className="mb-3 text-xl text-ink">Parts</h2>
        <ol className="space-y-2">
          {me.stages.map((s, i) => {
            const usable = s.availability !== "locked" && !s.excluded && !!me.group;
            const inner = (
              <>
                <span className="flex items-center gap-3">
                  <span aria-hidden="true" className={`flex h-8 w-8 shrink-0 items-center justify-center rounded-full text-sm font-semibold ${usable ? "bg-brand-strong text-white" : "bg-[#eeebe4] text-muted"}`}>{i + 1}</span>
                  <span className={`font-semibold ${usable ? "text-ink underline decoration-line-strong group-hover:decoration-brand" : "text-muted"}`}>{s.title}</span>
                </span>
                <Badge tone={s.availability === "open" ? "green" : s.availability === "closed" ? "amber" : "gray"}>{s.excluded ? "Not used by your group" : label[s.availability]}</Badge>
              </>
            );
            return (
              <li key={s.id}>
                {usable ? <Link href={`/session/stage/${s.id}`} className="group flex flex-wrap items-center justify-between gap-2 rounded-xl border border-line p-3 transition hover:border-brand hover:bg-brand-soft/40">{inner}</Link>
                  : <div className="flex flex-wrap items-center justify-between gap-2 rounded-xl border border-line bg-surface-2 p-3">{inner}</div>}
              </li>
            );
          })}
        </ol>
        <p className="mt-3 text-sm text-muted">A part's questions and work area appear once your facilitator opens it. Closed parts can still be read.</p>
      </Card>
      <Card className="mb-4">
        <h2 className="mb-1 text-xl text-ink">Shared with the class</h2>
        <p className="mb-3 text-sm text-muted">Items your facilitator has chosen to share, where you can react and respond.</p>
        <Link href="/session/board" className={linkButtonCls}>Open the class board</Link>
      </Card>
      <RecoveryCard archived={me.session.archived} onError={setError} />
    </Shell>
  );
}

export default function ParticipantHome() {
  return <Suspense fallback={<Shell title="Loading…"><p role="status">Loading your session…</p></Shell>}><ParticipantHomeInner /></Suspense>;
}
