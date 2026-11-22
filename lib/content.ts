import { badRequest } from "./router";
import { text } from "./validate";

export const CONTENT_LIMITS = {
  body: 4000,
  tag: 30,
  maxTags: 12,
  tableCols: 8,
  tableRows: 30,
  colLabel: 40,
  cell: 200,
  caption: 500,
};

export interface TableData {
  columns: string[];
  rows: string[][];
}

/** Labelled columns, editable rows and cells. Structure is stored as JSON exactly as validated here. */
export function validateTable(v: unknown): TableData {
  if (!v || typeof v !== "object") throw badRequest("A table is required.");
  const t = v as { columns?: unknown; rows?: unknown };
  if (!Array.isArray(t.columns) || t.columns.length < 1 || t.columns.length > CONTENT_LIMITS.tableCols) throw badRequest(`A table needs 1 to ${CONTENT_LIMITS.tableCols} columns.`);
  if (!Array.isArray(t.rows) || t.rows.length > CONTENT_LIMITS.tableRows) throw badRequest(`A table can have at most ${CONTENT_LIMITS.tableRows} rows.`);
  const columns = t.columns.map((c, i) => text(c, `Column ${i + 1} label`, { max: CONTENT_LIMITS.colLabel }));
  const rows = t.rows.map((r, ri) => {
    if (!Array.isArray(r) || r.length !== columns.length) throw badRequest(`Row ${ri + 1} must have ${columns.length} cells.`);
    return r.map((c) => text(c, "Cell", { max: CONTENT_LIMITS.cell, optional: true }));
  });
  return { columns, rows };
}

/** Tags must come from the list the facilitator configured for the stage. */
export function validateTags(v: unknown, allowed: string[]): string[] {
  if (v === undefined || v === null) return [];
  if (!Array.isArray(v)) throw badRequest("Tags must be a list.");
  const out: string[] = [];
  for (const t of v) {
    const s = text(t, "Tag", { max: CONTENT_LIMITS.tag });
    if (!allowed.includes(s)) throw badRequest(`"${s}" is not one of the tags for this part.`);
    if (!out.includes(s)) out.push(s);
  }
  return out;
}

export const parseJson = <T>(s: unknown, fallback: T): T => {
  try {
    return JSON.parse(String(s ?? "")) as T;
  } catch {
    return fallback;
  }
};
