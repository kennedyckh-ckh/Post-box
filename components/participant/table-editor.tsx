"use client";
import { Button, inputCls } from "@/components/ui";
import type { TableData } from "./types";

export function TableEditor({ value, onChange }: { value: TableData; onChange: (t: TableData) => void }) {
  const setCol = (i: number, v: string) => onChange({ ...value, columns: value.columns.map((c, j) => (j === i ? v : c)) });
  const setCell = (r: number, c: number, v: string) => onChange({ ...value, rows: value.rows.map((row, ri) => (ri === r ? row.map((x, ci) => (ci === c ? v : x)) : row)) });
  return (
    <fieldset className="mb-4">
      <legend className="mb-1 text-sm font-semibold">Table</legend>
      <div className="overflow-x-auto">
        <table className="min-w-full border-collapse text-sm">
          <thead>
            <tr>
              {value.columns.map((c, i) => (
                <th key={i} scope="col" className="border border-line bg-slate-100 p-1">
                  <input aria-label={`Column ${i + 1} label`} className={`${inputCls} min-w-28`} value={c} maxLength={40} onChange={(e) => setCol(i, e.target.value)} />
                </th>
              ))}
              <th className="p-1"><span className="sr-only">Row actions</span></th>
            </tr>
          </thead>
          <tbody>
            {value.rows.map((row, r) => (
              <tr key={r}>
                {row.map((cell, c) => (
                  <td key={c} className="border border-line p-1"><input aria-label={`Row ${r + 1}, ${value.columns[c] || `column ${c + 1}`}`} className={`${inputCls} min-w-28`} value={cell} maxLength={200} onChange={(e) => setCell(r, c, e.target.value)} /></td>
                ))}
                <td className="p-1"><Button variant="secondary" aria-label={`Remove row ${r + 1}`} onClick={() => onChange({ ...value, rows: value.rows.filter((_, i) => i !== r) })}>Remove row</Button></td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <div className="mt-2 flex flex-wrap gap-2">
        <Button variant="secondary" disabled={value.rows.length >= 30} onClick={() => onChange({ ...value, rows: [...value.rows, value.columns.map(() => "")] })}>Add row</Button>
        <Button variant="secondary" disabled={value.columns.length >= 8} onClick={() => onChange({ columns: [...value.columns, `Column ${value.columns.length + 1}`], rows: value.rows.map((r) => [...r, ""]) })}>Add column</Button>
        <Button variant="secondary" disabled={value.columns.length <= 1} onClick={() => onChange({ columns: value.columns.slice(0, -1), rows: value.rows.map((r) => r.slice(0, -1)) })}>Remove last column</Button>
      </div>
    </fieldset>
  );
}
