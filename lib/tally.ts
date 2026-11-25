import { all, get, num, str } from "./db";
import { allQuestions, questionLabels } from "./questions";

/**
 * Class results for questions that ask participants to choose an option (for example Agree / Disagree).
 * Counts people, not entries: each participant has at most one choice per question. Deleted and hidden entries are not
 * counted. A choice that no longer matches the facilitator's current options (the options were renamed after people
 * answered) is counted under "other" so totals stay exact. No names or texts are included.
 */
export interface QuestionTally {
  questionId: string;
  label: string;
  heading: string;
  text: string;
  visible: boolean;
  options: { label: string; count: number }[];
  other: number;
  /** Individual parts: answers saved but not yet submitted (not included in the counts). */
  pending: number;
  total: number;
  byGroup: { groupId: string; counts: Record<string, number>; total: number }[];
}

export function stageTallies(stageId: string, opts: { visibleOnly?: boolean } = {}): QuestionTally[] {
  const qs = allQuestions(stageId);
  const labels = questionLabels(qs);
  const withOptions = qs.filter((q) => q.options.length > 0 && (!opts.visibleOnly || q.visible));
  if (!withOptions.length) return [];
  // In a part where each person submits their own answers, only submitted answers count; drafts are reported as pending.
  const individual = get("SELECT submit_mode FROM stages WHERE id=?", stageId)?.submit_mode === "individual";
  const done = individual ? "AND submitted_at IS NOT NULL" : "";
  const rows = all(
    `SELECT question_id, group_id, choice, COUNT(DISTINCT author_id) AS n FROM entries
     WHERE stage_id=? AND question_id IS NOT NULL AND choice IS NOT NULL AND deleted_at IS NULL AND hidden_at IS NULL ${done}
     GROUP BY question_id, group_id, choice`,
    stageId
  );
  const pendingRows = individual ? all("SELECT question_id, COUNT(*) AS n FROM entries WHERE stage_id=? AND choice IS NOT NULL AND deleted_at IS NULL AND hidden_at IS NULL AND submitted_at IS NULL GROUP BY question_id", stageId) : [];
  return withOptions.map((q) => {
    const mine = rows.filter((r) => str(r.question_id) === q.id);
    const counts = new Map<string, number>(q.options.map((o) => [o, 0]));
    let other = 0;
    const groups = new Map<string, { counts: Record<string, number>; total: number }>();
    for (const r of mine) {
      const c = str(r.choice);
      const n = num(r.n);
      if (counts.has(c)) counts.set(c, counts.get(c)! + n); else other += n;
      const g = groups.get(str(r.group_id)) ?? { counts: {}, total: 0 };
      const key = counts.has(c) ? c : "__other";
      g.counts[key] = (g.counts[key] ?? 0) + n;
      g.total += n;
      groups.set(str(r.group_id), g);
    }
    const options = q.options.map((o) => ({ label: o, count: counts.get(o)! }));
    return {
      questionId: q.id, label: labels.get(q.id) ?? "", heading: q.heading, text: q.text, visible: q.visible, options, other,
      pending: num(pendingRows.find((r) => str(r.question_id) === q.id)?.n ?? 0),
      total: options.reduce((a, o) => a + o.count, 0) + other,
      byGroup: [...groups].map(([groupId, g]) => ({ groupId, ...g })),
    };
  });
}
