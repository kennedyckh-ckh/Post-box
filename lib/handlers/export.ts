import { all, get, num, str, audit, type Row } from "../db";
import { allQuestions } from "../questions";
import { route, badRequest } from "../router";
import { requireStaff, facilitatorSession } from "../authz";
import { parseJson } from "../content";
import { parseFields } from "./sessions";
import { reactionConfig, reactionSummary, sourceVersionOf, publicView } from "../sharing";

/**
 * Session export. Three separate sections, so original participant work is never mixed with other content:
 *   participantContent: what participants wrote (entries, group responses, submissions, peer comments, reaction counts)
 *   facilitatorContent: setup the facilitator wrote (parts, questions, links), and what was shared and how
 *   aiContent:          AI-generated drafts and facilitator-edited versions (filled in by the AI phase; empty if AI was not used)
 * Never included: join codes, group PINs, recovery codes or hashes, tokens, API keys, password data.
 * Attachments are referenced by id and type (download each with the facilitator's own sign-in); the files are not embedded.
 */
function build(s: Row, identified: boolean) {
  const sid = str(s.id);
  const fields = parseFields(s.participant_fields_json);
  const groups = all("SELECT * FROM groups WHERE session_id=? ORDER BY position", sid);
  const parts = all("SELECT * FROM participants WHERE session_id=? ORDER BY created_at, id", sid);
  const gMap = new Map(groups.map((g, i) => [str(g.id), identified ? str(g.id) : `G${i + 1}`]));
  const pMap = new Map(parts.map((p, i) => [str(p.id), identified ? str(p.id) : `P${String(i + 1).padStart(3, "0")}`]));
  const g = (id: unknown) => (id ? gMap.get(str(id)) ?? null : null);
  const p = (id: unknown) => pMap.get(str(id)) ?? null;
  const stages = all("SELECT * FROM stages WHERE session_id=? ORDER BY position", sid);
  const stageTitle = new Map(stages.map((x) => [str(x.id), str(x.title)]));
  const qText = new Map(all("SELECT q.id,q.text FROM stage_questions q JOIN stages s ON s.id=q.stage_id WHERE s.session_id=?", sid).map((q) => [str(q.id), str(q.text)]));

  const entries = all("SELECT * FROM entries WHERE session_id=? AND deleted_at IS NULL ORDER BY created_at, id", sid);
  const cfg = reactionConfig(s);
  const entryReacts = reactionSummary("entry", entries.map((e) => str(e.id)), null, cfg);

  const participantContent = {
    entries: entries.map((e) => ({
      entryId: e.id, stageId: e.stage_id, stageTitle: stageTitle.get(str(e.stage_id)), group: g(e.group_id), questionId: e.question_id ?? null, questionText: e.question_id ? qText.get(str(e.question_id)) ?? null : null,
      author: p(e.author_id), authorName: identified ? str(e.author_name) : undefined, kind: e.kind, body: e.body, tags: parseJson<string[]>(e.tags_json, []),
      table: e.table_json ? parseJson(e.table_json, null) : null, attachment: e.attachment_id ? { id: e.attachment_id, note: "file not embedded; download separately" } : null,
      version: num(e.version), createdAt: num(e.created_at), updatedAt: num(e.updated_at), hiddenByFacilitator: !!e.hidden_at,
      reactionCounts: entryReacts[str(e.id)].counts,
    })),
    groupResponses: all("SELECT gs.*, st.title FROM group_synthesis gs JOIN groups gr ON gr.id=gs.group_id JOIN stages st ON st.id=gs.stage_id WHERE gr.session_id=? ORDER BY gs.updated_at", sid).map((r) => ({ group: g(r.group_id), stageId: r.stage_id, stageTitle: r.title, body: r.body, version: num(r.version), updatedAt: num(r.updated_at) })),
    submissions: all("SELECT * FROM submissions WHERE session_id=? ORDER BY submitted_at", sid).map((r) => ({
      id: r.id, group: g(r.group_id), stageId: r.stage_id, stageTitle: stageTitle.get(str(r.stage_id)), revision: num(r.revision), submittedBy: p(r.submitted_by), submittedByName: identified ? str(r.submitted_by_name) : undefined,
      submittedAt: num(r.submitted_at), reopenedAt: r.reopened_at ? num(r.reopened_at) : null, entryIds: parseJson<{ entries: { id: string }[] }>(r.snapshot_json, { entries: [] }).entries.map((x) => x.id),
    })),
    peerComments: all("SELECT * FROM peer_comments WHERE session_id=? ORDER BY created_at", sid).map((c) => ({ id: c.id, targetType: c.target_type, targetId: c.target_id, author: p(c.author_id), authorName: identified ? str(c.author_name) : undefined, group: g(c.author_group_id), promptKey: c.prompt_key, body: c.body, status: c.status, createdAt: num(c.created_at) })),
  };

  const pubs = all("SELECT * FROM publications WHERE session_id=? ORDER BY label_no", sid);
  const pubReacts = reactionSummary("publication", pubs.map((x) => str(x.id)), null, cfg);
  const facilitatorContent = {
    stages: stages.map((st) => ({
      id: st.id, position: num(st.position), title: st.title, enabled: !!num(st.enabled), instructions: st.instructions, tags: parseJson<string[]>(st.tags_json, []),
      questions: allQuestions(str(st.id)).map((q) => ({ id: q.id, heading: q.heading, text: q.text, required: q.required, parentId: q.parentId, visibleToParticipants: q.visible })),
      resources: all("SELECT kind,title,url,attachment_id FROM stage_resources WHERE stage_id=? ORDER BY position", str(st.id)).map((r) => ({ kind: r.kind, title: r.title, url: r.url ?? null, attachmentId: r.attachment_id ?? null })),
    })),
    shared: pubs.map((x) => ({
      id: x.id, sourceType: x.source_type, sourceId: x.source_id, status: x.unpublished_at ? "unpublished" : "published", labelMode: x.label_mode, label: publicView(x).label,
      approvedForProjector: !!num(x.present), publishedAt: num(x.published_at), differsFromSource: (sourceVersionOf(str(x.source_type), str(x.source_id))?.version ?? null) !== str(x.source_version), reactionCounts: pubReacts[str(x.id)].counts,
    })),
  };

  return {
    meta: {
      exportedAt: new Date().toISOString(), identified, format: "groupwork-export-1", session: { id: sid, title: s.title, status: s.status },
      notes: [
        identified ? "Contains participant names and any optional fields (for example Class, Class Number). Handle under your data policy." : "Names and optional fields are replaced by pseudonyms (P001, G1). Free text and pictures written by participants may still identify people.",
        "Attachments are referenced by id and are not embedded in this file.",
        "Original participant content (participantContent) is kept apart from facilitator setup (facilitatorContent) and AI or facilitator-edited content (aiContent).",
      ],
    },
    groups: groups.map((x, i) => ({ id: g(x.id), name: identified ? x.name : `Group ${i + 1}`, seatCap: x.seat_cap ?? null })),
    participants: parts.map((x) => {
      const extra = parseJson<Record<string, string>>(x.extra_json, {});
      return { id: p(x.id), name: identified ? x.display_name : undefined, fields: identified ? Object.fromEntries(fields.map((f) => [f.label, extra[f.key] ?? ""])) : undefined, group: g(x.group_id), status: x.status, joinedAt: num(x.created_at) };
    }),
    participantContent,
    facilitatorContent,
    aiContent: {
      note: "AI-generated drafts (original), the facilitator's edited version (if any), their sources and how they were generated. Kept apart from participant work.",
      simulatedLabel: "Demo: simulated, not real AI.",
      drafts: all("SELECT * FROM ai_outputs WHERE session_id=? ORDER BY created_at", sid).map((o) => ({
        id: o.id, kind: o.kind, group: g(o.group_id), status: o.status, simulated: !!num(o.simulated), provider: o.provider, model: o.model, createdAt: num(o.created_at), generationMs: o.generation_ms ?? null,
        publishedToClass: !!get("SELECT 1 AS x FROM publications WHERE session_id=? AND source_type='ai_output' AND source_id=? AND unpublished_at IS NULL", sid, str(o.id)),
        criteria: parseJson(o.criteria_json, null), scope: parseJson(o.scope_json, null),
        originalAiDraft: parseJson(o.original_json, null), facilitatorEdited: o.edited_json ? parseJson(o.edited_json, null) : null,
        sourceEntries: parseJson<{ alias: string; entryId: string; version: number }[]>(o.sources_json, []).map((x) => ({ alias: x.alias, entryId: x.entryId, version: x.version })),
      })) as unknown[],
    },
  };
}

const csvCell = (v: unknown): string => {
  let s = v === null || v === undefined ? "" : typeof v === "object" ? JSON.stringify(v) : String(v);
  // A cell that starts with = + - @ (or a tab/return) can run as a formula when the file is opened in a spreadsheet.
  if (/^[=+\-@\t\r]/.test(s)) s = `'${s}`;
  return /[",\r\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
};
const toCsv = (rows: Record<string, unknown>[]): string => {
  if (!rows.length) return "﻿";
  const cols = Object.keys(rows[0]);
  return "﻿" + [cols.join(","), ...rows.map((r) => cols.map((c) => csvCell(r[c])).join(","))].join("\r\n") + "\r\n";
};

route("GET", "/sessions/:id/export", (ctx) => {
  const u = requireStaff(ctx);
  const s = facilitatorSession(ctx, ctx.params.id);
  const format = ctx.req.query.format === "csv" ? "csv" : "json";
  const identified = ctx.req.query.identified === "true";
  const data = build(s, identified);
  let body: string;
  let type: string;
  let name: string;
  if (format === "json") {
    body = JSON.stringify(data, null, 2);
    type = "application/json; charset=utf-8";
    name = `export-${identified ? "identified" : "deidentified"}.json`;
  } else {
    const table = str(ctx.req.query.table || "entries");
    const pc = data.participantContent;
    const sets: Record<string, Record<string, unknown>[]> = {
      entries: pc.entries.map((e) => ({ ...e, tags: e.tags.join("; "), reactionCounts: e.reactionCounts })),
      comments: pc.peerComments as unknown as Record<string, unknown>[],
      submissions: pc.submissions.map((x) => ({ ...x, entryIds: x.entryIds.join("; ") })),
      participants: data.participants as unknown as Record<string, unknown>[],
      "group-responses": pc.groupResponses as unknown as Record<string, unknown>[],
    };
    if (!sets[table]) throw badRequest("Choose entries, comments, submissions, participants or group-responses.");
    body = toCsv(sets[table]);
    type = "text/csv; charset=utf-8";
    name = `${table}-${identified ? "identified" : "deidentified"}.csv`;
  }
  audit("facilitator", u.id, "export_downloaded", { sessionId: str(s.id), detail: { format, identified, table: ctx.req.query.table ?? null } });
  ctx.headersOut["content-type"] = type;
  ctx.headersOut["content-disposition"] = `attachment; filename="${name}"`;
  ctx.headersOut["cache-control"] = "private, no-store";
  ctx.rawOut = Buffer.from(body, "utf8");
  return undefined;
});

void get;
