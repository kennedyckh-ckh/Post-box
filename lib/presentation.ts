import { all, get, run, now, str } from "./db";
import { parseJson } from "./content";
import { publicView } from "./sharing";
import { effectiveContent } from "./ai/analysis";

/** A discussion question is addressed as `<outputId>:<index>`. Returns its text only when it exists in this session. */
export function questionText(sessionId: string, qid: string): string | null {
  const [oid, idx] = qid.split(":");
  const i = Number(idx);
  if (!oid || !Number.isInteger(i) || i < 0) return null;
  const o = get("SELECT * FROM ai_outputs WHERE id=? AND session_id=? AND kind='discussion_points'", oid, sessionId);
  if (!o) return null;
  const p = effectiveContent(o).points[i];
  return p && p.kind === "question" ? p.text : null;
}

export function revealedIds(sessionId: string): string[] {
  return parseJson<string[]>(get("SELECT revealed_questions_json FROM presentation_state WHERE session_id=?", sessionId)?.revealed_questions_json, []);
}

export function setQuestionRevealed(sessionId: string, qid: string, revealed: boolean) {
  const cur = revealedIds(sessionId).filter((x) => x !== qid);
  if (revealed) cur.push(qid);
  run("INSERT INTO presentation_state(session_id,revealed_questions_json,updated_at) VALUES(?,?,?) ON CONFLICT(session_id) DO UPDATE SET revealed_questions_json=excluded.revealed_questions_json, updated_at=excluded.updated_at", sessionId, JSON.stringify(cur), now());
}

/** Revealed questions as participants and the projector may see them: text only, no sources. */
export function visibleQuestions(sessionId: string, ids: string[]) {
  return ids.map((id) => ({ id, text: questionText(sessionId, id) })).filter((q): q is { id: string; text: string } => !!q.text);
}

/**
 * Summaries and discussion questions for the projector. Summaries appear only if the facilitator switched summaries on AND
 * approved that published summary for the projector; questions appear only once individually revealed.
 */
export function presentationExtras(sessionId: string, showSummaries: boolean, revealedQuestionIds: string[]) {
  const summaries = showSummaries
    ? all("SELECT * FROM publications WHERE session_id=? AND source_type='ai_output' AND present=1 AND unpublished_at IS NULL ORDER BY label_no", sessionId).map((p) => {
        const v = publicView(p);
        const ai = v.ai as { overview?: string; points?: { heading: string; text: string }[]; simulated?: boolean } | null;
        const text = [ai?.overview, ...(ai?.points ?? []).map((x) => `• ${x.heading}: ${x.text}`)].filter(Boolean).join("\n\n");
        return { id: str(p.id), label: v.label, text };
      })
    : [];
  return { summaries, questions: visibleQuestions(sessionId, revealedQuestionIds) };
}
