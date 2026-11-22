"use client";
import { use, useEffect, useState } from "react";

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
    <main id="main" className="min-h-screen bg-gradient-to-br from-[#0b1437] via-[#1e1b6e] to-[#3b0f7a] px-8 py-8 text-white">
      {err && <p role="status" className="mb-6 rounded-lg bg-amber-200 p-4 text-xl font-semibold text-slate-950">{err}</p>}
      {d && (
        <>
          <h1 className="mb-8 text-5xl font-bold">{d.title}</h1>
          {d.questions.length > 0 && (
            <section aria-label="Discussion questions" className="mb-10 rounded-2xl border border-white/20 bg-[#312e81] p-8">
              <h2 className="mb-4 text-3xl font-bold">Let's discuss</h2>
              <ul className="space-y-4 text-4xl leading-snug">{d.questions.map((q) => <li key={q.id}>{q.text}</li>)}</ul>
            </section>
          )}
          {d.summaries.length > 0 && (
            <section aria-label="Summaries" className="mb-10 space-y-4">
              {d.summaries.map((s) => <div key={s.id} className="rounded-2xl border border-white/20 bg-[#581c87] p-8"><h2 className="mb-2 text-3xl font-bold">{s.label}</h2><p className="whitespace-pre-wrap text-3xl leading-snug">{s.text}</p></div>)}
            </section>
          )}
          {d.items.length === 0 && d.summaries.length === 0 && d.questions.length === 0 ? <p className="text-4xl text-slate-300">Waiting for the facilitator to share something…</p> : (
            <ul className="grid gap-6 lg:grid-cols-2">
              {d.items.map((it) => (
                <li key={it.id} className="rounded-2xl border border-white/15 bg-white/10 p-8">
                  <h2 className="mb-1 text-3xl font-bold text-amber-300">{it.label}</h2>
                  <p className="mb-4 text-xl text-slate-300">{it.stageTitle}</p>
                  {it.entries.map((e, i) => (
                    <div key={i} className="mb-4">
                      {e.questionText && <p className="mb-1 text-2xl font-semibold text-sky-300">{e.questionText}</p>}
                      {e.body && <p className="whitespace-pre-wrap break-words text-3xl leading-snug">{e.body}</p>}
                      {e.table && (
                        <table className="mt-3 min-w-full border-collapse text-2xl">
                          <thead><tr>{e.table.columns.map((c, ci) => <th key={ci} scope="col" className="border border-slate-500 bg-white/15 p-3 text-left">{c}</th>)}</tr></thead>
                          <tbody>{e.table.rows.map((r, ri) => <tr key={ri}>{r.map((c, ci) => <td key={ci} className="border border-slate-500 p-3">{c}</td>)}</tr>)}</tbody>
                        </table>
                      )}
                      {e.attachmentId && (
                        // eslint-disable-next-line @next/next/no-img-element
                        <img src={`/api/present/${encodeURIComponent(token)}/attachments/${e.attachmentId}`} alt="Shared picture" className="mt-3 max-h-96 max-w-full rounded-lg" />
                      )}
                    </div>
                  ))}
                  {it.synthesis && <p className="mt-3 rounded-xl bg-white/15 p-4 text-2xl"><strong>Group response:</strong> {it.synthesis}</p>}
                </li>
              ))}
            </ul>
          )}
        </>
      )}
    </main>
  );
}
