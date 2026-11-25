"use client";

export interface ProjectorItem {
  id: string; label: string; kind: string; stageTitle: string;
  entries: { questionText: string | null; choice?: string | null; kind: string; body: string; tags: string[]; table: { columns: string[]; rows: string[][] } | null; attachmentId: string | null }[];
  synthesis: string | null;
}

/** One shared item, laid out for a room screen: large type, high contrast, no names beyond the label the class sees. */
export function ProjectorItemView({ it, imageSrc, size = "lg" }: { it: ProjectorItem; imageSrc: (attachmentId: string) => string; size?: "lg" | "md" }) {
  const body = size === "lg" ? "text-[clamp(1.5rem,2.6vw,2.6rem)]" : "text-[clamp(1.1rem,1.6vw,1.6rem)]";
  return (
    <article className="min-w-0">
      <p className="text-[clamp(0.8rem,1vw,1rem)] font-semibold uppercase tracking-[0.18em] text-[#9fd0cb]">{it.stageTitle}</p>
      <h2 className={`mt-1 font-display font-semibold text-[#f3d2b3] ${size === "lg" ? "text-[clamp(2rem,3.6vw,3.6rem)]" : "text-[clamp(1.4rem,2vw,2rem)]"}`}>{it.label}</h2>
      <div className="mt-6 space-y-6">
        {it.entries.map((e, i) => (
          <div key={i}>
            {e.questionText && <p className="mb-2 text-[clamp(1rem,1.4vw,1.5rem)] font-semibold text-white/60">{e.questionText}</p>}
            {e.choice && <p className="mb-2"><span className="inline-block rounded-full bg-[#9fd0cb] px-4 py-1 text-[clamp(1rem,1.5vw,1.6rem)] font-semibold text-[#0c1a20]">{e.choice}</span></p>}
            {e.body && <p className={`whitespace-pre-wrap break-words leading-snug text-white ${body}`}>{e.body}</p>}
            {e.table && (
              <div className="mt-3 overflow-x-auto">
                <table className="min-w-full border-collapse text-[clamp(1rem,1.5vw,1.6rem)]">
                  <thead><tr>{e.table.columns.map((c, ci) => <th key={ci} scope="col" className="border border-white/25 bg-white/10 p-3 text-left font-semibold">{c}</th>)}</tr></thead>
                  <tbody>{e.table.rows.map((r, ri) => <tr key={ri}>{r.map((c, ci) => <td key={ci} className="border border-white/20 p-3">{c}</td>)}</tr>)}</tbody>
                </table>
              </div>
            )}
            {e.attachmentId && (
              // eslint-disable-next-line @next/next/no-img-element
              <img src={imageSrc(e.attachmentId)} alt="Shared picture" className="mt-3 max-h-[55vh] max-w-full rounded-xl" />
            )}
          </div>
        ))}
      </div>
      {it.synthesis && <p className={`mt-6 rounded-2xl bg-white/10 p-5 leading-snug ${size === "lg" ? "text-[clamp(1.2rem,2vw,2rem)]" : "text-[clamp(1rem,1.4vw,1.4rem)]"}`}><strong className="text-[#f3d2b3]">Group response:</strong> {it.synthesis}</p>}
    </article>
  );
}
