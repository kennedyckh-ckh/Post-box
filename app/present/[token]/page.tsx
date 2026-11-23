"use client";
import { use, useEffect, useState } from "react";
import { ProjectorItemView } from "@/components/projector/shared-item";

interface Item {
  id: string; label: string; kind: string; stageTitle: string;
  entries: { questionText: string | null; kind: string; body: string; tags: string[]; table: { columns: string[]; rows: string[][] } | null; attachmentId: string | null }[];
  synthesis: string | null;
}
interface Data { title: string; items: Item[]; summaries: { id: string; label: string; text: string }[]; questions: { id: string; text: string }[] }

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
          <h1 className="mb-[4vh] font-display text-[clamp(2rem,4vw,4rem)] font-semibold">{d.title}</h1>
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
