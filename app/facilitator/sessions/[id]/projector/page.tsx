"use client";
import { use, useCallback, useEffect, useMemo, useRef, useState } from "react";
import qrcode from "qrcode-generator";
import { api, errText, ApiError } from "@/lib/client/api";
import { Logo } from "@/components/ui";
import { ProjectorItemView, type ProjectorItem } from "@/components/projector/shared-item";
import { useRemaining, fmt, type TimerView } from "@/components/timer";

interface PStage {
  id: string; position: number; title: string; visible: boolean; availability: "locked" | "open" | "closed"; instructions: string;
  questions: { id: string; heading?: string; text: string; required: boolean; parentId: string | null }[]; hiddenQuestions: number;
  expected: number; submitted: number; perGroup: { groupId: string; status: "draft" | "submitted" | "reopened"; entries: number; expected: boolean }[];
}
interface Feed {
  title: string; status: string; joinCode: string; joiningOpen: boolean; participants: number;
  groups: { id: string; name: string; members: number }[];
  stages: PStage[]; items: ProjectorItem[];
  summaries: { id: string; label: string; text: string }[]; discussionQuestions: { id: string; text: string }[];
  timer: TimerView;
}

type Mode = "join" | "questions" | "progress" | "shared" | "discussion" | "timer";
const MODES: { key: Mode; label: string }[] = [
  { key: "join", label: "Join" },
  { key: "questions", label: "Questions" },
  { key: "progress", label: "Progress" },
  { key: "shared", label: "Shared work" },
  { key: "discussion", label: "Discussion" },
  { key: "timer", label: "Timer" },
];

function QR({ text, size }: { text: string; size: number }) {
  const cells = useMemo(() => {
    const q = qrcode(0, "M");
    q.addData(text);
    q.make();
    const n = q.getModuleCount();
    const rects: string[] = [];
    for (let r = 0; r < n; r++) for (let c = 0; c < n; c++) if (q.isDark(r, c)) rects.push(`M${c + 2} ${r + 2}h1v1h-1z`);
    return { n: n + 4, d: rects.join("") };
  }, [text]);
  return (
    <svg role="img" aria-label={`QR code for ${text}`} width={size} height={size} viewBox={`0 0 ${cells.n} ${cells.n}`} shapeRendering="crispEdges" className="rounded-2xl bg-white">
      <path d={cells.d} fill="#0c1a20" />
    </svg>
  );
}

/**
 * The facilitator's projector view. Opens in its own window from the session page, so it can be dragged to the room
 * screen and made full screen. Signed in as the facilitator, so no link has to be created. It shows only what is meant
 * for the room: the join code, revealed questions, progress by group, and items approved for the projector.
 */
export default function ProjectorPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const [d, setD] = useState<Feed | null>(null);
  const [err, setErr] = useState("");
  const [authErr, setAuthErr] = useState(false);
  const [mode, setMode] = useState<Mode>("join");
  const [stageId, setStageId] = useState<string | null>(null);
  const [itemIdx, setItemIdx] = useState(0);
  const [dock, setDock] = useState(true);
  const [busy, setBusy] = useState(false);
  const [flash, setFlash] = useState("");
  const [origin, setOrigin] = useState("");
  const idle = useRef<ReturnType<typeof setTimeout> | null>(null);
  const seen = useRef<Set<string> | null>(null);

  const load = useCallback(async () => {
    try { const f = await api<Feed>("GET", `/sessions/${id}/projector`); setD(f); setErr(""); }
    catch (e) {
      if (e instanceof ApiError && (e.status === 401 || e.status === 404)) setAuthErr(true);
      else setErr(e instanceof ApiError && e.status === 0 ? "Connection lost. Trying again…" : errText(e));
    }
  }, [id]);
  useEffect(() => { setOrigin(window.location.origin); void load(); const t = setInterval(load, 3000); return () => clearInterval(t); }, [load]);

  // Default part: the first open one, else the first visible one.
  const stages = useMemo(() => (d?.stages ?? []).filter((s) => s.visible), [d]);
  const stage = stages.find((s) => s.id === stageId) ?? stages.find((s) => s.availability === "open") ?? stages[0] ?? null;
  const items = d?.items ?? [];
  const item = items.length ? items[Math.min(itemIdx, items.length - 1)] : null;
  const hasDiscussion = !!d && (d.summaries.length > 0 || d.discussionQuestions.length > 0);
  const timer = d?.timer ?? null;
  const left = useRemaining(timer);
  const timerOn = !!timer && timer.state !== "idle";
  const timerDone = !!timer && (timer.state === "finished" || (timer.state === "running" && left === 0));
  const timerAct = useCallback(async (body: Record<string, unknown>) => {
    try { await api("POST", `/sessions/${id}/timer`, body); await load(); } catch (e) { setFlash(errText(e)); setTimeout(() => setFlash(""), 2600); }
  }, [id, load]);

  // Highlight questions that are revealed while the projector is showing them.
  useEffect(() => {
    if (!stage) return;
    const t = setTimeout(() => { seen.current = new Set([...(seen.current ?? []), ...stage.questions.map((q) => q.id)]); }, seen.current === null ? 0 : 2200);
    return () => clearTimeout(t);
  }, [stage]);

  const wake = useCallback(() => {
    setDock(true);
    if (idle.current) clearTimeout(idle.current);
    idle.current = setTimeout(() => setDock(false), 3500);
  }, []);
  useEffect(() => { wake(); window.addEventListener("mousemove", wake); window.addEventListener("touchstart", wake); return () => { window.removeEventListener("mousemove", wake); window.removeEventListener("touchstart", wake); }; }, [wake]);

  const toggleFullscreen = useCallback(() => {
    if (document.fullscreenElement) void document.exitFullscreen().catch(() => {});
    else void document.documentElement.requestFullscreen?.().catch(() => {});
  }, []);

  const reveal = useCallback(async (m: "next" | "all" | "none") => {
    if (!stage || busy) return;
    setBusy(true);
    try {
      const r = await api<{ changed: number; visibleCount: number; total: number }>("POST", `/stages/${stage.id}/questions/reveal`, { mode: m });
      setFlash(m === "none" ? "Questions hidden from participants" : r.changed ? `${r.visibleCount} of ${r.total} questions shown to participants` : "All questions are already shown");
      await load();
    } catch (e) { setFlash(errText(e)); }
    finally { setBusy(false); setTimeout(() => setFlash(""), 2600); }
  }, [stage, busy, load]);

  const moveStage = useCallback((dir: 1 | -1) => {
    if (!stages.length || !stage) return;
    const i = stages.findIndex((s) => s.id === stage.id);
    const n = stages[Math.max(0, Math.min(stages.length - 1, i + dir))];
    seen.current = null;
    setStageId(n.id);
  }, [stages, stage]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.target instanceof HTMLElement && ["INPUT", "TEXTAREA", "SELECT"].includes(e.target.tagName)) return;
      wake();
      const n = Number(e.key);
      if (n >= 1 && n <= MODES.length) { setMode(MODES[n - 1].key); return; }
      if (e.key === "f" || e.key === "F") { toggleFullscreen(); return; }
      if (mode === "shared" && items.length) {
        if (e.key === "ArrowRight") setItemIdx((i) => Math.min(items.length - 1, i + 1));
        if (e.key === "ArrowLeft") setItemIdx((i) => Math.max(0, i - 1));
      } else if (mode === "questions" || mode === "progress") {
        if (e.key === "ArrowRight") moveStage(1);
        if (e.key === "ArrowLeft") moveStage(-1);
        if (mode === "questions" && (e.key === "r" || e.key === "R" || e.key === " ")) { e.preventDefault(); void reveal("next"); }
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [mode, items.length, moveStage, reveal, toggleFullscreen, wake]);

  const joinUrl = `${origin}/join`;

  if (authErr) return (
    <main id="main" className="flex min-h-screen items-center justify-center bg-[#0c1a20] p-8 text-white">
      <div className="max-w-xl text-center"><h1 className="font-display text-4xl">Projector view</h1><p className="mt-4 text-xl text-white/75">Sign in as a facilitator of this session in this browser, then open the projector view again from the session page.</p><a href="/facilitator" className="mt-8 inline-flex min-h-12 items-center rounded-xl bg-white px-6 font-semibold text-[#0c1a20]">Facilitator sign in</a></div>
    </main>
  );

  return (
    <main id="main" className="relative flex min-h-screen flex-col overflow-hidden bg-[#0c1a20] text-white" style={{ backgroundImage: "radial-gradient(1100px 600px at 85% -10%, rgba(29,92,99,0.55), transparent 60%), radial-gradient(900px 500px at -10% 110%, rgba(184,105,43,0.22), transparent 60%)" }}>
      <header className="flex items-center justify-between gap-6 px-[4vw] pt-[3vh]">
        <div className="flex min-w-0 items-center gap-4">
          <Logo size={40} tone="light" />
          <p className="truncate font-display text-[clamp(1.1rem,1.8vw,1.8rem)] font-semibold text-white/90">{d?.title ?? "Loading…"}</p>
        </div>
        <div className="flex shrink-0 items-center gap-3">
        {timerOn && mode !== "timer" && (
          <div role="timer" aria-label={timerDone ? "Time is up" : `${fmt(left)} left`} className={`flex items-center gap-3 rounded-2xl px-5 py-2.5 ring-1 ${timerDone ? "bg-[#e8b384] text-[#0c1a20] ring-[#e8b384]" : left <= 60_000 ? "bg-[#e8b384]/15 ring-[#e8b384]/60" : "bg-white/10 ring-white/15"}`}>
            <span className="text-[clamp(0.75rem,0.9vw,0.95rem)] uppercase tracking-[0.18em] opacity-70">{timer!.label || "Time left"}{timer!.state === "paused" ? " · paused" : ""}</span>
            <span className="text-[clamp(1.3rem,2vw,2rem)] font-bold tabular-nums tracking-tight">{timerDone ? "Time's up" : fmt(left)}</span>
          </div>
        )}
        {d && mode !== "join" && (
          <div className="flex shrink-0 items-center gap-4 rounded-2xl bg-white/10 px-5 py-2.5 ring-1 ring-white/15">
            <span className="text-[clamp(0.75rem,0.9vw,0.95rem)] uppercase tracking-[0.18em] text-white/60">Join at {origin.replace(/^https?:\/\//, "")}/join</span>
            <span className="font-mono text-[clamp(1.3rem,2vw,2rem)] font-bold tracking-[0.2em]">{d.joinCode}</span>
          </div>
        )}
        </div>
      </header>

      {err && <p role="status" className="mx-[4vw] mt-4 rounded-xl bg-amber-200 px-5 py-3 text-lg font-semibold text-[#0c1a20]">{err}</p>}

      <section className="flex flex-1 flex-col px-[4vw] pb-[14vh] pt-[4vh]" aria-live="polite">
        {!d ? <p className="m-auto text-3xl text-white/60" role="status">Loading…</p> : (
          <>
            {mode === "join" && (
              <div className="m-auto grid w-full max-w-[1500px] items-center gap-[5vw] lg:grid-cols-[1.4fr_1fr]">
                <div>
                  <p className="text-[clamp(1rem,1.4vw,1.4rem)] font-semibold uppercase tracking-[0.2em] text-[#9fd0cb]">Join the session</p>
                  <p className="mt-4 text-[clamp(1.4rem,2.4vw,2.4rem)] text-white/85">Go to <strong className="text-white">{origin.replace(/^https?:\/\//, "")}/join</strong> and enter</p>
                  <div className="mt-6 flex flex-nowrap gap-[0.8vw]" aria-label={`Join code ${d.joinCode.split("").join(" ")}`}>
                    {d.joinCode.split("").map((ch, i) => (
                      <span key={i} aria-hidden="true" className="flex h-[clamp(4.2rem,8.6vw,9rem)] w-[clamp(3.2rem,6.4vw,6.8rem)] items-center justify-center rounded-2xl bg-white font-mono text-[clamp(2.4rem,5.4vw,5.8rem)] font-bold text-[#0c1a20] shadow-[0_20px_40px_-20px_rgba(0,0,0,0.6)]">{ch}</span>
                    ))}
                  </div>
                  <p className="mt-8 text-[clamp(1.1rem,1.6vw,1.6rem)] text-white/70">
                    <strong className="text-white">{d.participants}</strong> {d.participants === 1 ? "person has" : "people have"} joined · Joining is {d.joiningOpen ? "open" : <strong className="text-[#f3d2b3]">closed</strong>}
                  </p>
                </div>
                {origin && <div className="flex flex-col items-center gap-4"><QR text={joinUrl} size={340} /><p className="text-lg text-white/60">Scan to open the join page</p></div>}
              </div>
            )}

            {mode === "questions" && (
              !stage ? <Empty title="No parts to show" text="Switch on and show a part to participants first." /> : (
                <div className="mx-auto w-full max-w-[1500px]">
                  <StageHeading stage={stage} index={stages.findIndex((s) => s.id === stage.id)} total={stages.length} />
                  {stage.questions.length === 0 ? (
                    <Empty title={stage.hiddenQuestions ? "Questions are ready to reveal" : "No guiding questions in this part"} text={stage.hiddenQuestions ? `${stage.hiddenQuestions} ${stage.hiddenQuestions === 1 ? "question is" : "questions are"} waiting. Press “Reveal next question” or R.` : "Add questions in the Parts tab of the session page."} />
                  ) : (
                    <ol className="mt-[4vh] space-y-[2.6vh]">
                      {stage.questions.filter((q) => !q.parentId).map((q, i) => {
                        const subs = stage.questions.filter((x) => x.parentId === q.id);
                        return (
                          <li key={q.id} className={`rounded-2xl px-3 py-2 ${seen.current !== null && !seen.current.has(q.id) ? "fade-up" : ""}`}>
                            <div className="flex gap-[1.6vw]">
                              <span aria-hidden="true" className="mt-1 flex h-[clamp(2.4rem,3.6vw,3.6rem)] w-[clamp(2.4rem,3.6vw,3.6rem)] shrink-0 items-center justify-center rounded-full bg-[#9fd0cb] font-display text-[clamp(1.2rem,2vw,2rem)] font-semibold text-[#0c1a20]">{i + 1}</span>
                              <div>
                                {q.heading && <p className="mb-1 text-[clamp(0.9rem,1.3vw,1.35rem)] font-semibold uppercase tracking-[0.18em] text-[#e8b384]">{q.heading}</p>}
                                <p className="text-[clamp(1.6rem,3vw,3.2rem)] leading-tight text-white">{q.text}</p>
                              </div>
                            </div>
                            {subs.length > 0 && (
                              <ol className="ml-[clamp(3.2rem,5.2vw,5.2rem)] mt-[1.4vh] space-y-[1vh] border-l-2 border-white/15 pl-[1.4vw]">
                                {subs.map((sq, k) => (
                                  <li key={sq.id} className="flex gap-[1vw] text-[clamp(1.2rem,2.1vw,2.2rem)] leading-snug text-white/85">
                                    <span className="font-display font-semibold text-[#9fd0cb]">{String.fromCharCode(97 + k)}.</span>
                                    <span>{sq.text}</span>
                                  </li>
                                ))}
                              </ol>
                            )}
                          </li>
                        );
                      })}
                      {stage.hiddenQuestions > 0 && (
                        <li className="flex items-center gap-[1.6vw] px-3 py-2 text-white/45">
                          <span aria-hidden="true" className="flex h-[clamp(2.4rem,3.6vw,3.6rem)] w-[clamp(2.4rem,3.6vw,3.6rem)] shrink-0 items-center justify-center rounded-full border-2 border-dashed border-white/30 font-display text-[clamp(1.2rem,2vw,2rem)]">+{stage.hiddenQuestions}</span>
                          <p className="text-[clamp(1.2rem,2vw,2rem)]">{stage.hiddenQuestions === 1 ? "One more question to come" : `${stage.hiddenQuestions} more questions to come`}</p>
                        </li>
                      )}
                    </ol>
                  )}
                </div>
              )
            )}

            {mode === "progress" && (
              !stage ? <Empty title="No parts to show" text="Switch on and show a part to participants first." /> : (
                <div className="mx-auto w-full max-w-[1500px]">
                  <StageHeading stage={stage} index={stages.findIndex((s) => s.id === stage.id)} total={stages.length} />
                  <p className="mt-[3vh] font-display text-[clamp(2rem,4vw,4.2rem)] font-semibold leading-none">
                    <span className="text-[#9fd0cb]">{stage.submitted}</span> <span className="text-white/50">of</span> {stage.expected} <span className="text-[clamp(1.2rem,2vw,2rem)] font-normal text-white/70">groups have submitted</span>
                  </p>
                  <div className="mt-4 h-3 w-full overflow-hidden rounded-full bg-white/10"><div className="h-full rounded-full bg-[#9fd0cb] transition-all" style={{ width: `${stage.expected ? (stage.submitted / stage.expected) * 100 : 0}%` }} /></div>
                  <ul className="mt-[4vh] grid gap-[1.4vw] [grid-template-columns:repeat(auto-fill,minmax(min(100%,15rem),1fr))]">
                    {d.groups.map((g) => {
                      const c = stage.perGroup.find((x) => x.groupId === g.id);
                      const st = !c || !c.expected ? "out" : c.status === "submitted" ? "done" : c.entries > 0 ? "working" : "waiting";
                      const tone = { done: "bg-[#9fd0cb] text-[#0c1a20]", working: "bg-white/12 text-white ring-1 ring-[#e8b384]/60", waiting: "bg-white/[0.06] text-white/70 ring-1 ring-white/15", out: "bg-transparent text-white/40 ring-1 ring-dashed ring-white/15" }[st];
                      const word = { done: "Submitted", working: c?.status === "reopened" ? "Revising" : "Working", waiting: "Not started", out: "Not taking part" }[st];
                      return (
                        <li key={g.id} className={`rounded-2xl p-5 ${tone}`}>
                          <p className="font-display text-[clamp(1.2rem,1.8vw,1.9rem)] font-semibold">{g.name}</p>
                          <p className="mt-1 text-[clamp(0.95rem,1.2vw,1.25rem)] font-semibold uppercase tracking-[0.12em] opacity-80">{word}</p>
                          <p className="mt-3 text-[clamp(0.9rem,1.1vw,1.15rem)] opacity-75">{g.members} {g.members === 1 ? "member" : "members"} · {c?.entries ?? 0} {c?.entries === 1 ? "entry" : "entries"}</p>
                        </li>
                      );
                    })}
                  </ul>
                </div>
              )
            )}

            {mode === "shared" && (
              !item ? <Empty title="Nothing on the projector yet" text="In the Sharing tab, choose “Show on projector” for the items you want the room to see." /> : (
                <div className="mx-auto w-full max-w-[1400px]">
                  <p className="mb-4 text-[clamp(0.9rem,1.1vw,1.15rem)] font-semibold uppercase tracking-[0.18em] text-white/50">{Math.min(itemIdx, items.length - 1) + 1} / {items.length}</p>
                  <ProjectorItemView key={item.id} it={item} imageSrc={(a) => `/api/attachments/${encodeURIComponent(a)}`} />
                </div>
              )
            )}

            {mode === "timer" && (
              <div className="m-auto flex flex-col items-center text-center">
                <p className="text-[clamp(1rem,1.5vw,1.6rem)] font-semibold uppercase tracking-[0.22em] text-[#9fd0cb]">{timerOn ? (timer!.label || "Time left") : "Timer"}{timer?.state === "paused" ? " · paused" : ""}</p>
                <p role="timer" aria-label={!timerOn ? "Timer not started" : timerDone ? "Time is up" : `${fmt(left)} left`} className={`mt-[2vh] font-semibold leading-none tabular-nums tracking-tight ${timerDone ? "text-[#e8b384]" : left <= 60_000 && timerOn ? "text-[#f3d2b3]" : "text-white"} text-[clamp(6rem,19vw,22rem)]`}>{!timerOn ? "–:––" : timerDone ? "0:00" : fmt(left)}</p>
                {timerDone && <p className="mt-[2vh] font-display text-[clamp(2rem,4vw,4rem)] font-semibold text-[#e8b384]">Time's up</p>}
                {timerOn && !timerDone && timer!.durationMs > 0 && <div className="mt-[4vh] h-3 w-[min(70vw,1100px)] overflow-hidden rounded-full bg-white/10"><div className="h-full rounded-full bg-[#9fd0cb]" style={{ width: `${Math.min(100, (left / timer!.durationMs) * 100)}%`, transition: "width 0.25s linear" }} /></div>}
                {!timerOn && <p className="mt-[3vh] text-[clamp(1.1rem,1.5vw,1.5rem)] text-white/60">Choose a length below to start the countdown. Participants see it too.</p>}
              </div>
            )}

            {mode === "discussion" && (
              !hasDiscussion ? <Empty title="No discussion items yet" text="Publish group summaries and switch them on for the projector, or reveal discussion questions from the AI analysis tab." /> : (
                <div className="mx-auto w-full max-w-[1500px] space-y-[4vh]">
                  {d.discussionQuestions.length > 0 && (
                    <div>
                      <p className="text-[clamp(1rem,1.3vw,1.3rem)] font-semibold uppercase tracking-[0.2em] text-[#9fd0cb]">Let's discuss</p>
                      <ul className="mt-4 space-y-4">{d.discussionQuestions.map((q) => <li key={q.id} className="text-[clamp(1.6rem,3vw,3rem)] leading-tight">{q.text}</li>)}</ul>
                    </div>
                  )}
                  {d.summaries.map((s) => (
                    <div key={s.id} className="rounded-3xl bg-white/[0.07] p-[2.4vw] ring-1 ring-white/10">
                      <h2 className="font-display text-[clamp(1.4rem,2.2vw,2.3rem)] font-semibold text-[#f3d2b3]">{s.label}</h2>
                      <p className="mt-3 whitespace-pre-wrap text-[clamp(1.1rem,1.7vw,1.8rem)] leading-snug text-white/90">{s.text}</p>
                    </div>
                  ))}
                </div>
              )
            )}
          </>
        )}
      </section>

      {flash && <p role="status" className="pointer-events-none fixed left-1/2 top-6 -translate-x-1/2 rounded-full bg-white px-5 py-2 text-base font-semibold text-[#0c1a20] shadow-lg">{flash}</p>}

      <nav aria-label="Projector controls" className={`fixed inset-x-0 bottom-0 flex justify-center px-4 pb-5 transition-opacity duration-300 ${dock ? "opacity-100" : "pointer-events-none opacity-0 focus-within:pointer-events-auto focus-within:opacity-100"}`}>
        <div className="flex max-w-full flex-wrap items-center justify-center gap-2 rounded-2xl bg-[#13262d]/95 p-2 shadow-[0_20px_50px_-20px_rgba(0,0,0,0.8)] ring-1 ring-white/10 backdrop-blur">
          <div role="tablist" aria-label="What to show" className="flex flex-wrap gap-1">
            {MODES.map((m, i) => (
              <button key={m.key} type="button" role="tab" aria-selected={mode === m.key} onClick={() => setMode(m.key)} className={`min-h-10 rounded-xl px-3.5 text-sm font-semibold transition ${mode === m.key ? "bg-white text-[#0c1a20]" : "text-white/75 hover:bg-white/10 hover:text-white"}`}>
                <span className="mr-1.5 text-xs opacity-50" aria-hidden="true">{i + 1}</span>{m.label}{m.key === "shared" && items.length > 0 ? ` (${items.length})` : ""}
              </button>
            ))}
          </div>
          {(mode === "questions" || mode === "progress") && stages.length > 1 && (
            <div className="flex items-center gap-1 border-l border-white/10 pl-2">
              <DockBtn label="Previous part" onClick={() => moveStage(-1)} disabled={!stage || stages[0]?.id === stage.id}>←</DockBtn>
              <span className="px-1 text-sm text-white/70">Part {stage ? stages.findIndex((s) => s.id === stage.id) + 1 : 0} of {stages.length}</span>
              <DockBtn label="Next part" onClick={() => moveStage(1)} disabled={!stage || stages[stages.length - 1]?.id === stage.id}>→</DockBtn>
            </div>
          )}
          {mode === "questions" && stage && (stage.questions.length + stage.hiddenQuestions) > 0 && (
            <div className="flex items-center gap-1 border-l border-white/10 pl-2">
              <button type="button" disabled={busy || stage.hiddenQuestions === 0} onClick={() => void reveal("next")} className="min-h-10 rounded-xl bg-[#e8b384] px-4 text-sm font-semibold text-[#0c1a20] transition hover:bg-[#f3d2b3] disabled:opacity-40">Reveal next question{stage.hiddenQuestions ? ` (${stage.hiddenQuestions})` : ""}</button>
              <DockBtn label="Show all questions" onClick={() => void reveal("all")} disabled={busy || stage.hiddenQuestions === 0}>Show all</DockBtn>
              <DockBtn label="Hide all questions" onClick={() => { if (confirm("Hide all questions of this part from participants? Answers already written are kept.")) void reveal("none"); }} disabled={busy || stage.questions.length === 0}>Hide all</DockBtn>
            </div>
          )}
          {mode === "shared" && items.length > 1 && (
            <div className="flex items-center gap-1 border-l border-white/10 pl-2">
              <DockBtn label="Previous item" onClick={() => setItemIdx((i) => Math.max(0, i - 1))} disabled={itemIdx === 0}>←</DockBtn>
              <DockBtn label="Next item" onClick={() => setItemIdx((i) => Math.min(items.length - 1, i + 1))} disabled={itemIdx >= items.length - 1}>→</DockBtn>
            </div>
          )}
          {mode === "timer" && (
            <div className="flex flex-wrap items-center gap-1 border-l border-white/10 pl-2">
              {[1, 3, 5, 10, 15].map((m) => <DockBtn key={m} label={`Start a ${m} minute timer`} onClick={() => void timerAct({ action: "start", seconds: m * 60, label: timer?.label ?? "" })}>{m}m</DockBtn>)}
              {timer?.state === "running" && !timerDone && <DockBtn label="Pause timer" onClick={() => void timerAct({ action: "pause" })}>Pause</DockBtn>}
              {timer?.state === "paused" && <button type="button" onClick={() => void timerAct({ action: "resume" })} className="min-h-10 rounded-xl bg-[#e8b384] px-4 text-sm font-semibold text-[#0c1a20] hover:bg-[#f3d2b3]">Resume</button>}
              {timerOn && <DockBtn label="Add one minute" onClick={() => void timerAct({ action: "add", seconds: 60 })}>+1m</DockBtn>}
              {timerOn && <DockBtn label="Reset timer" onClick={() => void timerAct({ action: "reset" })}>Reset</DockBtn>}
            </div>
          )}
          <div className="border-l border-white/10 pl-2"><DockBtn label="Full screen (F)" onClick={toggleFullscreen}>Full screen</DockBtn></div>
        </div>
      </nav>
    </main>
  );
}

function DockBtn({ children, label, onClick, disabled }: { children: React.ReactNode; label: string; onClick: () => void; disabled?: boolean }) {
  return <button type="button" aria-label={label} title={label} onClick={onClick} disabled={disabled} className="min-h-10 min-w-10 rounded-xl px-3 text-sm font-semibold text-white/80 transition hover:bg-white/10 hover:text-white disabled:opacity-30">{children}</button>;
}

function StageHeading({ stage, index, total }: { stage: PStage; index: number; total: number }) {
  const tone = stage.availability === "open" ? "bg-[#9fd0cb] text-[#0c1a20]" : stage.availability === "closed" ? "bg-[#e8b384] text-[#0c1a20]" : "bg-white/15 text-white/80";
  return (
    <div className="flex flex-wrap items-end justify-between gap-4">
      <div>
        <p className="text-[clamp(0.9rem,1.2vw,1.25rem)] font-semibold uppercase tracking-[0.2em] text-white/55">Part {index + 1} of {total}</p>
        <h1 className="mt-1 font-display text-[clamp(2.2rem,4.4vw,4.6rem)] font-semibold leading-[1.05]">{stage.title}</h1>
      </div>
      <span className={`rounded-full px-4 py-1.5 text-[clamp(0.85rem,1vw,1.05rem)] font-semibold uppercase tracking-[0.12em] ${tone}`}>{stage.availability === "open" ? "Open" : stage.availability === "closed" ? "Closed" : "Not open yet"}</span>
    </div>
  );
}

function Empty({ title, text }: { title: string; text: string }) {
  return (
    <div className="m-auto max-w-2xl py-[8vh] text-center">
      <p className="font-display text-[clamp(1.8rem,3vw,3rem)] font-semibold text-white/90">{title}</p>
      <p className="mt-3 text-[clamp(1.1rem,1.5vw,1.5rem)] text-white/60">{text}</p>
    </div>
  );
}
