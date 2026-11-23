"use client";
import { use, useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { api, errText, ApiError } from "@/lib/client/api";
import { Shell, Card, Button, Alert, Badge, SignOutButton } from "@/components/ui";
import { SetupTab } from "@/components/facilitator/setup-tab";
import { GroupsTab } from "@/components/facilitator/groups-tab";
import { PeopleTab } from "@/components/facilitator/people-tab";
import { StagesTab } from "@/components/facilitator/stages-tab";
import { ContributionsTab } from "@/components/facilitator/contributions-tab";
import { ProgressTab } from "@/components/facilitator/progress-tab";
import { HistoryTab } from "@/components/facilitator/history-tab";
import { SharingTab } from "@/components/facilitator/sharing-tab";
import { AiTab } from "@/components/facilitator/ai-tab";
import type { Detail } from "@/components/facilitator/types";

const TABS = [
  { key: "progress", label: "Progress" },
  { key: "people", label: "People" },
  { key: "groups", label: "Groups" },
  { key: "stages", label: "Parts" },
  { key: "work", label: "Contributions" },
  { key: "sharing", label: "Sharing" },
  { key: "ai", label: "AI analysis (optional)" },
  { key: "setup", label: "Settings" },
  { key: "history", label: "History" },
] as const;

export default function SessionPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const [d, setD] = useState<Detail | null>(null);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [tab, setTab] = useState<(typeof TABS)[number]["key"]>("progress");

  const load = useCallback(async () => {
    try { setD(await api<Detail>("GET", `/sessions/${id}`)); setError(""); } catch (e) {
      if (e instanceof ApiError && e.status === 401) window.location.href = "/facilitator";
      else setError(errText(e));
    }
  }, [id]);
  useEffect(() => { void load(); }, [load]);

  async function act(fn: () => Promise<unknown>, ok?: string) {
    setError(""); setNotice("");
    try { await fn(); if (ok) setNotice(ok); await load(); } catch (e) { setError(errText(e)); }
  }

  if (!d) return <Shell title="Loading…">{error ? <><Alert kind="error">{error}</Alert><Link href="/facilitator" className="underline">Back to your sessions</Link></> : <p role="status">Loading…</p>}</Shell>;
  const s = d.session;
  const archived = s.status === "archived";

  return (
    <Shell wide right={<SignOutButton />}>
      <p className="mb-4 text-sm"><Link href="/facilitator" className="font-semibold text-muted hover:text-brand-strong">← Your sessions</Link></p>
      <div className="mb-6 flex flex-wrap items-start justify-between gap-4">
        <div>
          <h1 className="text-3xl text-ink sm:text-[2.2rem]">{s.title}</h1>
          <p className="mt-2"><Badge tone={s.status === "live" ? "green" : archived ? "gray" : "amber"}>{s.status === "setup" ? "Setting up (not started)" : s.status === "live" ? "Live" : "Archived (read-only)"}</Badge></p>
        </div>
        <div className="flex flex-wrap gap-2">
          <a href={`/facilitator/sessions/${id}/projector`} target="_blank" rel="noopener noreferrer" className="inline-flex min-h-11 items-center justify-center gap-2 rounded-lg bg-accent px-4 py-2 text-sm font-semibold text-white shadow-sm transition hover:bg-[#9a5622]">
            <svg aria-hidden="true" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><rect x="2" y="3" width="20" height="14" rx="2" /><path d="M8 21h8M12 17v4" /></svg>
            Projector view <span className="sr-only">(opens in a new window)</span>
          </a>
          {s.status === "setup" && <Button onClick={() => { if (confirm("Start the session? Part 1 opens for participants. Later parts stay locked until you open them.")) void act(() => api("POST", `/sessions/${id}/start`, {}), "Session started. The first enabled part is open."); }}>Start session</Button>}
          <Button variant="secondary" onClick={() => { if (confirm("Make a clean copy of this session? It copies the setup, parts, questions, links, files and groups. It does not copy participants, work, PINs or the join code.")) void act(async () => { const r = await api<{ id: string; groupsNeedingPin: string[] }>("POST", `/sessions/${id}/duplicate`, {}); alert(`Copy created with a new join code.${r.groupsNeedingPin.length ? `\nSet new PINs for: ${r.groupsNeedingPin.join(", ")}` : ""}`); window.location.href = `/facilitator/sessions/${r.id}`; }); }}>Duplicate</Button>
          {!archived && <Button variant="secondary" onClick={() => { if (confirm("Archive this session? It becomes read-only and closed to joining and new contributions. You can restore it later.")) void act(() => api("POST", `/sessions/${id}/archive`, {}), "Session archived."); }}>Archive</Button>}
          {archived && <Button onClick={() => void act(() => api("POST", `/sessions/${id}/restore`, {}), "Session restored.")}>Restore</Button>}
          {s.myRole === "owner" && <Button variant="danger" onClick={() => { const t = prompt(`PERMANENT DELETE. This removes all groups, participants, work and files of this session and cannot be undone. Backups already taken may still contain it.\n\nType the session title to confirm:\n${s.title}`); if (t !== null) void act(async () => { await api("DELETE", `/sessions/${id}`, { confirmTitle: t }); window.location.href = "/facilitator"; }); }}>Delete permanently</Button>}
        </div>
      </div>
      {error && <Alert kind="error">{error}</Alert>}
      {notice && <Alert kind="success">{notice}</Alert>}

      <Card className="mb-8" label="Joining">
        <div className="flex flex-wrap items-center justify-between gap-4">
          <div>
            <p className="text-xs font-semibold uppercase tracking-[0.14em] text-accent">Join code</p>
            <p className="mt-1 font-mono text-4xl font-bold tracking-[0.18em] text-ink" aria-label={`Join code ${s.joinCode.split("").join(" ")}`}>{s.joinCode}</p>
            <p className="mt-1 text-sm text-muted">Joining is <strong>{s.joiningOpen ? "open" : "closed"}</strong>{s.status === "setup" && !s.earlyJoin ? " (and participants cannot join until you start the session)" : ""}.</p>
          </div>
          <div className="flex flex-wrap gap-2">
            <Button variant="secondary" disabled={archived} onClick={() => void act(() => api("POST", `/sessions/${id}/joining`, { open: !s.joiningOpen }), s.joiningOpen ? "Joining closed. Existing participants keep their access." : "Joining opened.")}>{s.joiningOpen ? "Close joining" : "Open joining"}</Button>
            <Button variant="secondary" disabled={archived} onClick={() => { if (confirm("Make a new join code? The old code stops working for new joiners. Existing participants and their work are not affected.")) void act(() => api("POST", `/sessions/${id}/join-code/regenerate`, {}), "New join code created."); }}>New join code</Button>
          </div>
        </div>
      </Card>

      <div role="tablist" aria-label="Session sections" className="mb-6 flex flex-wrap gap-1 border-b border-line">
        {TABS.map((t) => (
          <button key={t.key} role="tab" id={`tab-${t.key}`} aria-selected={tab === t.key} aria-controls={`panel-${t.key}`} onClick={() => setTab(t.key)} className={`-mb-px min-h-11 border-b-2 px-3.5 text-sm font-semibold transition ${tab === t.key ? "border-brand-strong text-ink" : "border-transparent text-muted hover:border-line-strong hover:text-ink"}`}>{t.label}</button>
        ))}
      </div>
      <div role="tabpanel" id={`panel-${tab}`} aria-labelledby={`tab-${tab}`}>
        {tab === "progress" && <ProgressTab d={d} act={act} />}
        {tab === "history" && <HistoryTab sessionId={d.session.id} />}
        {tab === "people" && <PeopleTab d={d} act={act} />}
        {tab === "groups" && <GroupsTab d={d} act={act} />}
        {tab === "stages" && <StagesTab d={d} act={act} />}
        {tab === "work" && <ContributionsTab d={d} act={act} />}
        {tab === "sharing" && <SharingTab d={d} act={act} />}
        {tab === "ai" && <AiTab d={d} act={act} />}
        {tab === "setup" && <SetupTab d={d} act={act} />}
      </div>
    </Shell>
  );
}
