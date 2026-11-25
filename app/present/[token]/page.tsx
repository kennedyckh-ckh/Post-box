"use client";
import { use, useEffect, useState } from "react";
import { ProjectorItemView } from "@/components/projector/shared-item";
import { useRemaining, fmt, type TimerView } from "@/components/timer";

interface Item {
  id: string; label: string; kind: string; stageTitle: string;
  entries: { questionText: string | null; choice?: string | null; kind: string; body: string; tags: string[]; table: { columns: string[]; rows: string[][] } | null; attachmentId: string | null }[];
  synthesis: string | null;
}
interface Data { title: string; items: Item[]; summaries: { id: string; label: string; text: string }[]; questions: { id: string; text: string }[]; timer?: TimerView }

/** Projector view: large text, no controls, no sign-in. It only ever receives what the facilitator approved for it. */
export default function PresentPage({ params }: { params: Promise<{ token: string }> }) {
  const { token } = use(params);
  const [d, setD] = useState<Data | null>(null);
  const [err, setErr] = useState("");
  useEffect(() => {
    let live = true;
    const load = async () => {
      try {
        const r = await fetch(`/api/present/${encodeURIComponent(token)}`, { cache: "no-store" });
        if (!r.ok) { if (live) setErr(r.status === 404 ? "This projector link is not active. Ask your facilitator for a new one." : "Could not load. Trying again…"); return; }
        if (live) { setD(await r.json()); setErr(""); }
      } catch { if (live) setErr("Connection lost. Trying again…"); }
    };
    void load();
    const t = setInterval(load, 4000);
    return () => { live = false; clearInterval(t); };
  }, [token]);

  return (
    <main id="main" className="min-h-screen bg-[#0c1a20] px-[4vw] py-[4vh] text-white" style={{ backgroundImage: "radial-gradient(1100px 600px at 85% -10%, rgba(29,92,99,0.55), transparent 60%), radial-gradient(900px 500px at -10% 110%, rgba(184,105,43,0.22), transparent 60%)" }}>
      {err && <p role="status" className="mb-6 rounded-xl bg-amber-200 p-4 text-xl font-semibold text-slate-950">{err}</p>}
      {d && (
        <>
          <div className="mb-[4vh] flex flex-wrap items-center justify-between gap-4">
            <h1 className="font-display text-[clamp(2rem,4vw,4rem)] font-semibold">{d.title}</h1>
            <TimerChip t={d.timer ?? null} />
          </div>
          {d.questions.length > 0 && (
            <section aria-label="Discussion questions" className="mb-[4vh] rounded-3xl bg-white/[0.07] p-[2.4vw] ring-1 ring-white/10">
              <h2 className="mb-4 text-[clamp(1rem,1.3vw,1.3rem)] font-semibold uppercase tracking-[0.2em] text-[#9fd0cb]">Let's discuss</h2>
              <ul className="space-y-4 text-[clamp(1.6rem,3vw,3rem)] leading-tight">{d.questions.map((q) => <li key={q.id}>{q.text}</li>)}</ul>
            </section>
          )}
          {d.summaries.length > 0 && (
            <section aria-label="Summaries" className="mb-[4vh] space-y-4">
              {d.summaries.map((s) => <div key={s.id} className="rounded-3xl bg-white/[0.07] p-[2.4vw] ring-1 ring-white/10"><h2 className="mb-2 font-display text-[clamp(1.4rem,2.2vw,2.3rem)] font-semibold text-[#f3d2b3]">{s.label}</h2><p className="whitespace-pre-wrap text-[clamp(1.1rem,1.7vw,1.8rem)] leading-snug">{s.text}</p></div>)}
            </section>
          )}
          {d.items.length === 0 && d.summaries.length === 0 && d.questions.length === 0 ? <p className="text-[clamp(1.6rem,3vw,3rem)] text-white/55">Waiting for the facilitator to share something…</p> : (
            <ul className="grid gap-[2vw] lg:grid-cols-2">
              {d.items.map((it) => (
                <li key={it.id} className="rounded-3xl bg-white/[0.06] p-[2.4vw] ring-1 ring-white/10">
                  <ProjectorItemView it={it} size="md" imageSrc={(a) => `/api/present/${encodeURIComponent(token)}/attachments/${a}`} />
                </li>
              ))}
            </ul>
          )}
        </>
      )}
    </main>
  );
}

function TimerChip({ t }: { t: TimerView | null }) {
  const left = useRemaining(t);
  if (!t || t.state === "idle") return null;
  const done = t.state === "finished" || left === 0;
  return (
    <div role="timer" className={`flex items-center gap-3 rounded-2xl px-5 py-3 ring-1 ${done ? "bg-[#e8b384] text-[#0c1a20] ring-[#e8b384]" : "bg-white/10 ring-white/15"}`}>
      <span className="text-[clamp(0.8rem,1vw,1rem)] uppercase tracking-[0.18em] opacity-70">{t.label || "Time left"}{t.state === "paused" ? " · paused" : ""}</span>
      <span className="text-[clamp(1.6rem,3vw,3rem)] font-bold tabular-nums tracking-tight">{done ? "Time's up" : fmt(left)}</span>
    </div>
  );
}
