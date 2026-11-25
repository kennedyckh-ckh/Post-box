"use client";
import type { Entry } from "./types";
import { Badge } from "@/components/ui";

export function TableView({ table }: { table: NonNullable<Entry["table"]> }) {
  return (
    <div className="overflow-x-auto">
      <table className="mt-2 min-w-full border-collapse text-sm">
        <thead><tr>{table.columns.map((c, i) => <th key={i} scope="col" className="border border-line bg-slate-100 p-2 text-left">{c}</th>)}</tr></thead>
        <tbody>{table.rows.map((r, ri) => <tr key={ri}>{r.map((c, ci) => <td key={ci} className="border border-line p-2">{c}</td>)}</tr>)}</tbody>
      </table>
    </div>
  );
}

export function EntryBody({ e, questionText }: { e: Entry; questionText?: string }) {
  return (
    <>
      {questionText && <p className="mb-1 text-sm font-semibold text-brand-strong">Responding to: {questionText}</p>}
      {e.choice && <p className="mb-1"><ChoiceBadge choice={e.choice} /></p>}
      {e.body && <p className="whitespace-pre-wrap break-words">{e.body}</p>}
      {e.table && <TableView table={e.table} />}
      {e.attachment && (
        // eslint-disable-next-line @next/next/no-img-element
        <img src={`/api/attachments/${e.attachment.id}`} alt={`Picture attached by ${e.authorName}: ${e.attachment.name}`} className="mt-2 max-h-72 max-w-full rounded-lg border border-line" />
      )}
      {e.tags.length > 0 && <p className="mt-2 flex flex-wrap gap-1">{e.tags.map((t) => <Badge key={t} tone="blue">{t}</Badge>)}</p>}
    </>
  );
}

export const timeText = (ms: number) => new Date(ms).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });

/** The option a participant chose (for example Agree / Disagree), shown above their reason. */
export function ChoiceBadge({ choice }: { choice: string }) {
  const c = choice.toLowerCase();
  const tone = /^(agree|yes|true)/.test(c) ? "bg-emerald-100 text-emerald-900 ring-emerald-700/30" : /^(disagree|no|false)/.test(c) ? "bg-rose-100 text-rose-900 ring-rose-700/30" : "bg-brand-soft text-brand-strong ring-brand/30";
  return <span className={`inline-flex items-center rounded-full px-3 py-0.5 text-sm font-semibold ring-1 ${tone}`}><span className="sr-only">Chose: </span>{choice}</span>;
}
