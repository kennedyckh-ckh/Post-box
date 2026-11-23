import { all, get, run, tx, now, num, str, audit, type Row } from "./db";
import { randomCode, newId, sha256 } from "./crypto";
import { badRequest } from "./router";
import { obj, text, oneOf } from "./validate";
import { parseJson } from "./content";

export type Scope = "group" | "published" | "both";
export const REACTION_ICONS = ["thumbs", "heart", "star", "idea", "clap", "smile", "question", "check", "none"] as const;
export type ReactionIcon = (typeof REACTION_ICONS)[number];
export interface ReactionConfig { enabled: boolean; scope: Scope; types: { key: string; label: string; icon: ReactionIcon }[] }

/** A sensible icon for a reaction type that has none yet (older sessions): from its key or label. */
export function inferIcon(key: string, label: string): ReactionIcon {
  const s = `${key} ${label}`.toLowerCase();
  if (/heart|love|愛|心/.test(s)) return "heart";
  if (/thumb|讚|good/.test(s)) return "thumbs";
  if (/idea|insight|bulb|新/.test(s)) return "idea";
  if (/clap|applause|bravo|掌/.test(s)) return "clap";
  if (/question|wonder|\?|問/.test(s)) return "question";
  if (/agree|check|yes|同意/.test(s)) return "check";
  if (/smile|fun|happy|笑/.test(s)) return "smile";
  return "star";
}
export interface CritiqueConfig { enabled: boolean; scope: Scope; requireApproval: boolean; prompts: { key: string; label: string; enabled: boolean }[] }

export const reactionConfig = (s: Row): ReactionConfig => {
  const c = parseJson<ReactionConfig>(s.reaction_config_json, { enabled: false, scope: "both", types: [] });
  return { ...c, types: c.types.map((t) => ({ key: t.key, label: t.label, icon: (REACTION_ICONS as readonly string[]).includes(t.icon) ? t.icon : inferIcon(t.key, t.label) })) };
};
export const critiqueConfig = (s: Row): CritiqueConfig => parseJson<CritiqueConfig>(s.critique_config_json, { enabled: false, scope: "both", requireApproval: false, prompts: [] });

const keyOf = (k: unknown) => (typeof k === "string" && /^[a-z0-9_]{1,24}$/.test(k) ? k : `k_${randomCode(5).toLowerCase()}`);

export function cleanReactionConfig(v: unknown): ReactionConfig {
  const o = obj(v);
  if (!Array.isArray(o.types) || o.types.length > 6) throw badRequest("Give at most 6 reaction types.");
  const types = o.types.map((t) => {
    const x = obj(t);
    const key = keyOf(x.key);
    const label = text(x.label, "Reaction label", { max: 20 });
    const icon = x.icon === undefined || x.icon === null || x.icon === "" ? inferIcon(key, label) : oneOf(x.icon, "Reaction icon", REACTION_ICONS);
    return { key, label, icon };
  });
  if (new Set(types.map((t) => t.key)).size !== types.length) throw badRequest("Reaction types must be different.");
  return { enabled: o.enabled === true, scope: oneOf(o.scope, "Reaction scope", ["group", "published", "both"] as const), types };
}

export function cleanCritiqueConfig(v: unknown): CritiqueConfig {
  const o = obj(v);
  if (!Array.isArray(o.prompts) || o.prompts.length > 8) throw badRequest("Give at most 8 response prompts.");
  const prompts = o.prompts.map((p) => { const x = obj(p); return { key: keyOf(x.key), label: text(x.label, "Prompt", { max: 80 }), enabled: x.enabled !== false }; });
  if (new Set(prompts.map((t) => t.key)).size !== prompts.length) throw badRequest("Response prompts must be different.");
  return { enabled: o.enabled === true, scope: oneOf(o.scope, "Peer response scope", ["group", "published", "both"] as const), requireApproval: o.requireApproval === true, prompts };
}

/* ---------- publications ---------- */

export interface PubContent {
  type: "entry" | "submission" | "ai_output";
  stageTitle: string;
  title?: string;
  /** shown to participants */
  entries: { questionText: string | null; kind: string; body: string; tags: string[]; table: unknown; attachment: { id: string; mime: string } | null }[];
  synthesis: string | null;
  revision?: number;
  /** AI outputs carry structured content here (phase 5) */
  ai?: unknown;
  /** NEVER sent to participants or the projector: internal attribution kept for facilitators */
  internal: { groupName: string | null; groupId: string | null; authors: { id: string; name: string }[] };
}

export function sourceVersionOf(type: string, id: string): { version: string; groupId: string | null; stageId: string | null } | null {
  if (type === "entry") {
    const e = get("SELECT version, group_id, stage_id, deleted_at, hidden_at FROM entries WHERE id=?", id);
    return e ? { version: `${num(e.version)}${e.deleted_at ? ":deleted" : ""}${e.hidden_at ? ":hidden" : ""}`, groupId: str(e.group_id), stageId: str(e.stage_id) } : null;
  }
  if (type === "submission") {
    const s = get("SELECT revision, group_id, stage_id, reopened_at FROM submissions WHERE id=?", id);
    return s ? { version: `${num(s.revision)}`, groupId: str(s.group_id), stageId: str(s.stage_id) } : null;
  }
  if (type === "ai_output") {
    const o = get("SELECT edited_json, original_json, group_id FROM ai_outputs WHERE id=?", id);
    return o ? { version: sha256(str(o.edited_json ?? o.original_json)).slice(0, 16), groupId: o.group_id ? str(o.group_id) : null, stageId: null } : null;
  }
  return null;
}

export function buildContent(sessionId: string, type: string, id: string): { content: PubContent; version: string; groupId: string | null; stageId: string | null } | null {
  if (type === "entry") {
    const e = get("SELECT * FROM entries WHERE id=? AND session_id=? AND deleted_at IS NULL", id, sessionId);
    if (!e) return null;
    const stage = get("SELECT title FROM stages WHERE id=?", str(e.stage_id))!;
    const group = get("SELECT name FROM groups WHERE id=?", str(e.group_id));
    const q = e.question_id ? get("SELECT text FROM stage_questions WHERE id=?", str(e.question_id)) : undefined;
    const att = e.attachment_id ? get("SELECT id,mime FROM attachments WHERE id=? AND deleted_at IS NULL", str(e.attachment_id)) : undefined;
    return {
      version: `${num(e.version)}`, groupId: str(e.group_id), stageId: str(e.stage_id),
      content: {
        type: "entry", stageTitle: str(stage.title),
        entries: [{ questionText: q ? str(q.text) : null, kind: str(e.kind), body: str(e.body), tags: parseJson<string[]>(e.tags_json, []), table: e.table_json ? parseJson(e.table_json, null) : null, attachment: att ? { id: str(att.id), mime: str(att.mime) } : null }],
        synthesis: null,
        internal: { groupName: group ? str(group.name) : null, groupId: str(e.group_id), authors: [{ id: str(e.author_id), name: str(e.author_name) }] },
      },
    };
  }
  if (type === "submission") {
    const s = get("SELECT * FROM submissions WHERE id=? AND session_id=?", id, sessionId);
    if (!s) return null;
    const snap = parseJson<{ stageTitle: string; entries: { authorId: string; authorName: string; questionText: string | null; kind: string; body: string; tags: string[]; table: unknown; attachment: { id: string; mime: string } | null }[]; synthesis: { body: string } | null }>(s.snapshot_json, { stageTitle: "", entries: [], synthesis: null });
    const group = get("SELECT name FROM groups WHERE id=?", str(s.group_id));
    const authors = new Map<string, string>();
    for (const e of snap.entries) authors.set(e.authorId, e.authorName);
    return {
      version: `${num(s.revision)}`, groupId: str(s.group_id), stageId: str(s.stage_id),
      content: {
        type: "submission", stageTitle: snap.stageTitle, revision: num(s.revision),
        // author names are deliberately left out of the public part of a group submission
        entries: snap.entries.map((e) => ({ questionText: e.questionText, kind: e.kind, body: e.body, tags: e.tags, table: e.table, attachment: e.attachment ? { id: e.attachment.id, mime: e.attachment.mime } : null })),
        synthesis: snap.synthesis?.body || null,
        internal: { groupName: group ? str(group.name) : null, groupId: str(s.group_id), authors: [...authors].map(([id, name]) => ({ id, name })) },
      },
    };
  }
  return null;
}

export const attachmentIds = (c: PubContent): string[] => c.entries.map((e) => e.attachment?.id).filter((x): x is string => !!x);

export function nextLabelNo(sessionId: string): number {
  return num(get("SELECT COALESCE(MAX(label_no),0)+1 AS n FROM publications WHERE session_id=?", sessionId)!.n);
}

/**
 * What participants and the projector are allowed to see of a publication. Built from an explicit list of fields,
 * so identity can only appear if it is added here on purpose. With anonymous labels there is no name, group, id of a
 * person or id of the source anywhere in the result.
 */
export function publicView(p: Row) {
  const c = parseJson<PubContent>(p.snapshot_json, { type: "entry", stageTitle: "", entries: [], synthesis: null, internal: { groupName: null, groupId: null, authors: [] } });
  const anonymous = p.label_mode === "anonymous";
  return {
    id: p.id,
    label: anonymous ? `Sample Response ${num(p.label_no)}` : c.internal.groupName ?? (c.type === "ai_output" ? "Class summary" : "A group"),
    kind: c.type,
    stageTitle: c.stageTitle,
    revision: c.revision ?? null,
    entries: c.entries.map((e) => ({ questionText: e.questionText, kind: e.kind, body: e.body, tags: e.tags, table: e.table, attachmentId: e.attachment?.id ?? null })),
    synthesis: c.synthesis,
    ai: c.ai ?? null,
    publishedAt: num(p.updated_at),
  };
}

/* ---------- reactions and comments ---------- */

export function reactionSummary(targetType: string, ids: string[], viewerId: string | null, cfg: ReactionConfig) {
  const out: Record<string, { counts: Record<string, number>; mine: string[]; total: number }> = {};
  for (const id of ids) out[id] = { counts: {}, mine: [], total: 0 };
  if (!ids.length) return out;
  const enabled = new Set(cfg.types.map((t) => t.key));
  const rows = all(`SELECT target_id, type, participant_id FROM reactions WHERE target_type=? AND target_id IN (${ids.map(() => "?").join(",")})`, targetType, ...ids);
  for (const r of rows) {
    if (!enabled.has(str(r.type))) continue;
    const o = out[str(r.target_id)];
    o.counts[str(r.type)] = (o.counts[str(r.type)] ?? 0) + 1;
    o.total++;
    if (viewerId && r.participant_id === viewerId) o.mine.push(str(r.type));
  }
  return out;
}

export function engagementStamp(targetType: string, ids: string[]): string {
  if (!ids.length) return "0";
  const q = ids.map(() => "?").join(",");
  const r = get(`SELECT COUNT(*) AS c, COALESCE(MAX(created_at),0) AS m FROM reactions WHERE target_type=? AND target_id IN (${q})`, targetType, ...ids)!;
  const c = get(`SELECT COUNT(*) AS c, COALESCE(MAX(COALESCE(moderated_at,created_at)),0) AS m FROM peer_comments WHERE target_type=? AND target_id IN (${q})`, targetType, ...ids)!;
  return `${num(r.c)}.${num(r.m)}.${num(c.c)}.${num(c.m)}`;
}

/** Comments visible to this viewer: approved ones, plus their own while they await approval. Never mixed into the original entry. */
export function commentsFor(targetType: string, ids: string[], viewerId: string | null, anonymous: (targetId: string) => boolean) {
  const out: Record<string, { id: string; author: string; mine: boolean; promptKey: string; body: string; status: string; createdAt: number }[]> = {};
  for (const id of ids) out[id] = [];
  if (!ids.length) return out;
  const rows = all(`SELECT c.*, g.name AS gname FROM peer_comments c LEFT JOIN groups g ON g.id=c.author_group_id WHERE c.target_type=? AND c.target_id IN (${ids.map(() => "?").join(",")}) ORDER BY c.created_at, c.id`, targetType, ...ids);
  for (const r of rows) {
    const mine = !!viewerId && r.author_id === viewerId;
    if (!(r.status === "approved" || (mine && r.status === "pending"))) continue;
    const anon = targetType === "publication" && anonymous(str(r.target_id));
    out[str(r.target_id)].push({
      id: str(r.id), mine, promptKey: str(r.prompt_key), body: str(r.body), status: str(r.status), createdAt: num(r.created_at),
      // inside a group names are shown; on class-published content the commenter is anonymous or shown by group, following the publication's setting
      author: mine ? "You" : targetType === "entry" ? str(r.author_name) : anon ? "A peer" : r.gname ? str(r.gname) : "A peer",
    });
  }
  return out;
}

/**
 * Creates a publication, or refreshes the frozen copy of an existing one (keeping its label number, so anonymous labels stay consistent).
 * Used for entries, group submissions and AI outputs alike.
 */
export function upsertPublication(o: { sessionId: string; userId: string; type: "entry" | "submission" | "ai_output"; sourceId: string; content: PubContent; version: string; groupId: string | null; stageId: string | null; mode: "group" | "anonymous" }): string {
  return tx(() => {
    const existing = get("SELECT * FROM publications WHERE session_id=? AND source_type=? AND source_id=?", o.sessionId, o.type, o.sourceId);
    const ids = JSON.stringify(attachmentIds(o.content));
    if (existing) {
      run("UPDATE publications SET snapshot_json=?, attachment_ids_json=?, source_version=?, label_mode=?, updated_at=?, unpublished_at=NULL, published_by=? WHERE id=?", JSON.stringify(o.content), ids, o.version, o.mode, now(), o.userId, str(existing.id));
      audit("facilitator", o.userId, "publication_updated", { sessionId: o.sessionId, target: str(existing.id) });
      return str(existing.id);
    }
    const pid = newId("pub");
    run("INSERT INTO publications(id,session_id,source_type,source_id,source_version,stage_id,group_id,snapshot_json,attachment_ids_json,label_no,label_mode,published_by,published_at,updated_at) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?)", pid, o.sessionId, o.type, o.sourceId, o.version, o.stageId, o.groupId, JSON.stringify(o.content), ids, nextLabelNo(o.sessionId), o.mode, o.userId, now(), now());
    audit("facilitator", o.userId, "published", { sessionId: o.sessionId, target: pid, detail: { type: o.type, labelMode: o.mode } });
    return pid;
  });
}
