import { get, all, num, str, type Row } from "./db";
import { shownQuestions } from "./questions";
import { parseJson } from "./content";

export type SubStatus = "draft" | "submitted" | "reopened";
export interface SubState {
  status: SubStatus;
  revision: number;
  submissionId: string | null;
  submittedAt: number | null;
  submittedByName: string | null;
  reopenedAt: number | null;
}

/**
 * draft:     nothing submitted yet.
 * submitted: the latest version is locked (read-only) until the facilitator reopens it.
 * reopened:  the facilitator reopened the latest version; the group edits again and resubmits as the next version.
 * Previous versions are always kept.
 */
export function submissionState(groupId: string, stageId: string): SubState {
  const r = get("SELECT * FROM submissions WHERE group_id=? AND stage_id=? ORDER BY revision DESC LIMIT 1", groupId, stageId);
  if (!r) return { status: "draft", revision: 0, submissionId: null, submittedAt: null, submittedByName: null, reopenedAt: null };
  return {
    status: r.reopened_at ? "reopened" : "submitted",
    revision: num(r.revision),
    submissionId: str(r.id),
    submittedAt: num(r.submitted_at),
    submittedByName: str(r.submitted_by_name),
    reopenedAt: r.reopened_at ? num(r.reopened_at) : null,
  };
}

export const isSubmitted = (groupId: string, stageId: string) => submissionState(groupId, stageId).status === "submitted";

export interface SnapEntry {
  id: string;
  authorId: string;
  authorName: string;
  questionId: string | null;
  questionText: string | null;
  /** The option chosen, for questions with response options (for example "Agree"); absent in older snapshots. */
  choice?: string | null;
  kind: string;
  body: string;
  tags: string[];
  table: unknown;
  attachment: { id: string; name: string; mime: string } | null;
  version: number;
  createdAt: number;
  updatedAt: number;
}
export interface Snapshot {
  stageId: string;
  stageTitle: string;
  takenAt: number;
  questions: { id: string; text: string; required: boolean }[];
  entries: SnapEntry[];
  synthesis: { body: string; version: number } | null;
}

/** The group's visible work for a stage, as it is right now. Call inside a write transaction to freeze it consistently. */
export function buildSnapshot(groupId: string, stageId: string, now: number): Snapshot {
  const stage = get("SELECT * FROM stages WHERE id=?", stageId)!;
  const questions = shownQuestions(stageId).map((q) => ({ id: q.id, heading: q.heading, text: q.text, required: q.required, parentId: q.parentId }));
  const qText = new Map(all("SELECT id,text FROM stage_questions WHERE stage_id=?", stageId).map((q) => [str(q.id), str(q.text)]));
  const entries = all("SELECT * FROM entries WHERE group_id=? AND stage_id=? AND deleted_at IS NULL AND hidden_at IS NULL ORDER BY created_at, id", groupId, stageId).map((e): SnapEntry => {
    const att = e.attachment_id ? get("SELECT id,original_name,mime FROM attachments WHERE id=? AND deleted_at IS NULL", str(e.attachment_id)) : undefined;
    return {
      id: str(e.id), authorId: str(e.author_id), authorName: str(e.author_name), questionId: e.question_id ? str(e.question_id) : null, questionText: e.question_id ? qText.get(str(e.question_id)) ?? null : null,
      choice: e.choice ? str(e.choice) : null, kind: str(e.kind), body: str(e.body), tags: parseJson<string[]>(e.tags_json, []), table: e.table_json ? parseJson(e.table_json, null) : null,
      attachment: att ? { id: str(att.id), name: str(att.original_name), mime: str(att.mime) } : null, version: num(e.version), createdAt: num(e.created_at), updatedAt: num(e.updated_at),
    };
  });
  const syn = get("SELECT body, version FROM group_synthesis WHERE group_id=? AND stage_id=?", groupId, stageId);
  return { stageId, stageTitle: str(stage.title), takenAt: now, questions, entries, synthesis: syn ? { body: str(syn.body), version: num(syn.version) } : null };
}

/** Required guiding questions (revealed to participants) that no visible entry of the group answers yet. Hidden questions never block. */
export function missingRequired(groupId: string, stageId: string): { questionId: string; text: string }[] {
  return shownQuestions(stageId).filter((q) => q.required)
    .filter((q) => !get("SELECT 1 AS x FROM entries WHERE group_id=? AND stage_id=? AND question_id=? AND deleted_at IS NULL AND hidden_at IS NULL LIMIT 1", groupId, stageId, q.id))
    .map((q) => ({ questionId: q.id, text: q.text }));
}

export type ReferenceSource = "draft" | "submitted";

/**
 * What a reference panel shows for the group's earlier stage: the submitted snapshot when the group's work is submitted,
 * otherwise the current draft entries. The source label tells the participant which one they are looking at.
 */
export function referenceContent(groupId: string, stageId: string, draftEntries: () => unknown[]): { source: ReferenceSource; snapshot: Snapshot | null; draft: unknown[] } {
  const st = submissionState(groupId, stageId);
  if (st.status === "submitted") {
    const r = get("SELECT snapshot_json FROM submissions WHERE id=?", st.submissionId!)!;
    return { source: "submitted", snapshot: parseJson<Snapshot | null>(r.snapshot_json, null), draft: [] };
  }
  return { source: "draft", snapshot: null, draft: draftEntries() };
}

/**
 * Groups expected to submit a stage: they have at least one active member and are not excluded from this stage.
 * Empty and excluded groups never block progress.
 */
export function expectedGroups(sessionId: string, stageId: string): Row[] {
  return all(
    `SELECT g.* FROM groups g
     WHERE g.session_id=?
       AND EXISTS (SELECT 1 FROM participants p WHERE p.group_id=g.id AND p.status='active')
       AND NOT EXISTS (SELECT 1 FROM group_stage_settings s WHERE s.group_id=g.id AND s.stage_id=? AND s.excluded=1)
     ORDER BY g.position`,
    sessionId,
    stageId
  );
}

/** Parts where each person submits their own answers: how many answers are submitted or still drafts, and by how many people. */
export function individualProgress(stageId: string): { submittedAnswers: number; draftAnswers: number; people: number } {
  const r = get("SELECT SUM(CASE WHEN submitted_at IS NOT NULL THEN 1 ELSE 0 END) AS s, SUM(CASE WHEN submitted_at IS NULL THEN 1 ELSE 0 END) AS d, COUNT(DISTINCT CASE WHEN submitted_at IS NOT NULL THEN author_id END) AS p FROM entries WHERE stage_id=? AND deleted_at IS NULL AND hidden_at IS NULL", stageId);
  return { submittedAnswers: num(r?.s ?? 0), draftAnswers: num(r?.d ?? 0), people: num(r?.p ?? 0) };
}
