import { all, num, str } from "./db";

/**
 * Guiding questions and their optional sub-questions (one level). Top-level questions are revealed by the facilitator;
 * a sub-question is shown exactly when its parent is shown. Results are ordered parent first, then its sub-questions.
 */
export interface QuestionRow { id: string; text: string; required: boolean; parentId: string | null; visible: boolean; position: number }

const ORDER = "ORDER BY COALESCE(p.position, q.position), (q.parent_id IS NOT NULL), q.position";

/** SQL condition (alias q, parent alias p) for "participants can see this question". */
export const SHOWN = "q.deleted_at IS NULL AND ((q.parent_id IS NULL AND q.visible=1) OR (q.parent_id IS NOT NULL AND p.id IS NOT NULL AND p.deleted_at IS NULL AND p.visible=1))";

function map(r: Record<string, unknown>): QuestionRow {
  const parentId = r.parent_id ? str(r.parent_id) : null;
  return { id: str(r.id), text: str(r.text), required: !!num(r.required), parentId, visible: parentId ? !!num(r.parent_visible) : !!num(r.visible), position: num(r.position) };
}

/** Every live question of a stage, for facilitators. A sub-question's `visible` is its parent's. */
export function allQuestions(stageId: string): QuestionRow[] {
  return all(`SELECT q.*, p.visible AS parent_visible FROM stage_questions q LEFT JOIN stage_questions p ON p.id=q.parent_id WHERE q.stage_id=? AND q.deleted_at IS NULL AND (q.parent_id IS NULL OR (p.id IS NOT NULL AND p.deleted_at IS NULL)) ${ORDER}`, stageId).map(map);
}

/** Only what participants may see. Hidden questions (and sub-questions of hidden questions) are never returned. */
export function shownQuestions(stageId: string): QuestionRow[] {
  return all(`SELECT q.*, p.visible AS parent_visible FROM stage_questions q LEFT JOIN stage_questions p ON p.id=q.parent_id WHERE q.stage_id=? AND ${SHOWN} ${ORDER}`, stageId).map(map);
}

/** Number of top-level questions still held back (a count only). */
export function hiddenTopLevelCount(stageId: string): number {
  return allQuestions(stageId).filter((q) => !q.parentId && !q.visible).length;
}

/** Labels such as "1", "1a", "1b", "2" in display order. */
export function questionLabels(qs: { id: string; parentId: string | null }[]): Map<string, string> {
  const out = new Map<string, string>();
  let n = 0;
  const sub = new Map<string, number>();
  for (const q of qs) {
    if (!q.parentId) { n++; out.set(q.id, String(n)); sub.set(q.id, 0); }
    else { const k = (sub.get(q.parentId) ?? 0) + 1; sub.set(q.parentId, k); out.set(q.id, `${out.get(q.parentId) ?? "?"}${String.fromCharCode(96 + Math.min(k, 26))}`); }
  }
  return out;
}
