import { all, get, run, now, num, str, audit, type Row } from "../db";
import { newId, sha256 } from "../crypto";
import { route, badRequest, conflict, notFound, HttpError } from "../router";
import { requireStaff, requireAdmin, facilitatorSession, mustBeEditable } from "../authz";
import { obj, text, bool, oneOf, int } from "../validate";
import { hit } from "../throttle";
import { parseJson } from "../content";
import { aiStatus, aiSettings } from "../ai/config";
import { getProvider } from "../ai";
import { AiError, SIMULATED_LABEL, type AiContent, type AiKind } from "../ai/types";
import { PRESETS, cleanCriteria, cleanScope, buildInput, buildMessages, simContext, maxTokensFor, validateContent, effectiveContent, isOutdated, type Criteria, type Scope, type Source } from "../ai/analysis";
import { limits, setLimits, checkQuota, recordUsage, liveUsage, usageReport, usageCsv } from "../ai/usage";
import { upsertPublication, type PubContent } from "../sharing";
import { questionText, setQuestionRevealed, revealedIds } from "../presentation";

const KINDS = ["group_summary", "cross_group", "discussion_points"] as const;
/** One generation at a time per session, kind and group, so a double click cannot start two paid requests. */
const inflight = new Set<string>();

/** A failed validation inside a route must reach the user as a clear message, not as a server error. */
const checked = <T,>(fn: () => T): T => { try { return fn(); } catch (e) { throw asHttp(e); } };
const asHttp = (e: unknown): HttpError => (e instanceof AiError ? new HttpError(e.status, e.code, e.message) : e instanceof HttpError ? e : new HttpError(500, "server_error", "Something went wrong."));

function outputView(sessionId: string, o: Row) {
  const sources = parseJson<Source[]>(o.sources_json, []);
  const pub = get("SELECT id, unpublished_at, source_version FROM publications WHERE session_id=? AND source_type='ai_output' AND source_id=?", sessionId, str(o.id));
  const g = o.group_id ? get("SELECT name FROM groups WHERE id=?", str(o.group_id)) : undefined;
  return {
    id: o.id, kind: o.kind, groupId: o.group_id ?? null, groupName: g ? g.name : null, status: o.status, simulated: !!num(o.simulated), provider: o.provider, model: o.model,
    createdAt: num(o.created_at), updatedAt: num(o.updated_at), generationMs: o.generation_ms === null ? null : num(o.generation_ms),
    scope: parseJson<Scope | null>(o.scope_json, null), criteria: parseJson<Criteria | null>(o.criteria_json, null),
    /** the model's own words, untouched */ original: parseJson<AiContent>(o.original_json, { overview: "", points: [] }),
    /** the facilitator's edited version, or null if never edited */ edited: o.edited_json ? parseJson<AiContent>(o.edited_json, { overview: "", points: [] }) : null,
    content: effectiveContent(o),
    sources: sources.map((s) => ({ alias: s.alias, entryId: s.entryId, version: s.version, groupId: s.groupId, stageId: s.stageId })),
    outdated: isOutdated(sessionId, o),
    reviewed: o.status === "reviewed" || o.status === "published",
    publicationId: pub ? str(pub.id) : null,
    published: !!pub && !pub.unpublished_at,
    simulatedLabel: num(o.simulated) ? SIMULATED_LABEL : null,
  };
}

function outputFor(ctx: Parameters<typeof facilitatorSession>[0], id: string): { o: Row; s: Row } {
  requireStaff(ctx); // sign-in is checked before anything is looked up, so an unknown id and a known id look the same to a stranger
  const o = get("SELECT * FROM ai_outputs WHERE id=?", id);
  if (!o) throw notFound("AI output not found");
  return { o, s: facilitatorSession(ctx, str(o.session_id)) };
}

/* ---------- setup information ---------- */

route("GET", "/ai/presets", (ctx) => {
  requireStaff(ctx);
  return { presets: PRESETS };
});

route("GET", "/ai/status", (ctx) => {
  const u = requireStaff(ctx);
  const l = limits();
  const use = liveUsage(u.id);
  return {
    status: aiStatus(), limits: l, usage: use,
    remaining: { requestsToday: Math.max(0, l.requestsPerDay - use.requestsToday), tokensThisMonth: Math.max(0, l.tokensPerMonth - use.tokensThisMonth) },
    simulatedLabel: aiStatus().simulated ? SIMULATED_LABEL : null,
  };
});

/* ---------- scope preview and generation ---------- */

function prepare(ctx: Parameters<typeof facilitatorSession>[0]) {
  const u = requireStaff(ctx);
  const s = facilitatorSession(ctx, ctx.params.id);
  mustBeEditable(s);
  const b = obj(ctx.req.body);
  const kind = oneOf(b.kind, "kind", KINDS) as AiKind;
  const scope = cleanScope(str(s.id), kind, b.scope);
  const criteria = b.criteria !== undefined ? cleanCriteria(b.criteria) : cleanCriteria(parseJson(s.ai_criteria_json, {}));
  const built = buildInput(str(s.id), scope);
  return { u, s, b, kind, scope, criteria, built };
}

/** Shows what WOULD be sent before anything is sent. No names, class details, PINs or recovery data are ever part of it. */
route("POST", "/sessions/:id/ai/preview", (ctx) => {
  const { kind, scope, criteria, built } = prepare(ctx);
  const st = aiStatus();
  const messages = buildMessages(kind, criteria, built);
  return {
    kind, entries: built.entries.length, chars: built.chars, maxChars: aiSettings().maxInputChars, tooLarge: built.chars > aiSettings().maxInputChars, skipped: built.skipped,
    groups: scope.groupIds.length, parts: scope.stageIds.length, usesDrafts: scope.includeDrafts, includesPeerComments: scope.includeComments,
    willBeSentTo: st.provider === "simulated" ? "Nobody: this is the built-in demo (no data leaves this server)." : "The HKU AI service (Azure OpenAI gateway)",
    excludedByDefault: ["participant names", "class and class number", "group names (groups are shown as Group A, B…)", "group PINs and recovery codes", "pictures and files (not analysed in this version)"],
    // the exact text that would be sent, so it can be inspected; truncated only for display here
    samplePrompt: messages[1].content.slice(0, 3000),
    configured: st.configured, problems: st.problems, simulated: st.simulated,
  };
});

route("POST", "/sessions/:id/ai/generate", async (ctx) => {
  const { u, s, b, kind, scope, criteria, built } = prepare(ctx);
  const st = aiStatus();
  // Live settings missing or invalid: say so plainly. Never fall back to the simulator.
  if (!st.configured) throw new HttpError(503, "ai_not_configured", `Live AI is not set up yet. The administrator needs to set: ${st.problems.join(", ")}. Everything else in the platform still works.`, { problems: st.problems });
  const provider = getProvider();
  const requestKey = b.requestKey === undefined ? null : text(b.requestKey, "requestKey", { max: 64 });
  if (requestKey) {
    // a repeated request returns what was already generated instead of paying for a second one
    const prior = get("SELECT output_id FROM ai_usage WHERE user_id=? AND request_key=?", u.id, requestKey);
    if (prior?.output_id) {
      const o = get("SELECT * FROM ai_outputs WHERE id=?", str(prior.output_id));
      if (o) return { output: outputView(str(s.id), o), duplicate: true };
    }
    if (prior) throw conflict("That request already ran and failed. Start a new one.", "request_already_used");
  }
  hit(`ai:${u.id}`, 40, 10 * 60_000);
  if (built.entries.length === 0) throw new HttpError(400, "nothing_to_analyse", "There is no submitted work in this selection. Choose other parts or groups, or tick the option to include drafts.", { skipped: built.skipped });
  const max = aiSettings().maxInputChars;
  // Never cut the text to fit: ask for a narrower selection instead.
  if (built.chars > max) throw new HttpError(413, "scope_too_large", `This selection is too long to analyse in one go (${built.chars.toLocaleString("en")} characters; the limit is ${max.toLocaleString("en")}). Choose fewer parts, groups or questions and try again. Nothing was cut or sent.`, { chars: built.chars, max });
  checkQuota(u.id, provider.name);

  const lock = `${s.id}:${kind}:${scope.groupIds.join(",")}`;
  if (inflight.has(lock)) throw conflict("This analysis is already running. Wait for it to finish.", "generation_in_progress");
  inflight.add(lock);
  try {
    const messages = buildMessages(kind, criteria, built);
    const started = Date.now();
    let result;
    try {
      result = await provider.generate({ kind, messages, maxTokens: maxTokensFor(criteria.detail), context: provider.name === "simulated" ? simContext(kind, criteria, built) : undefined });
    } catch (e) {
      const ae = e instanceof AiError ? e : new AiError("ai_failed", "The AI request failed.", 502);
      recordUsage({ userId: u.id, sessionId: str(s.id), outputId: null, kind, provider: provider.name, model: aiSettings().model, status: "error", errorCode: ae.code, httpStatus: ae.httpStatus, latencyMs: Date.now() - started, requestKey });
      throw asHttp(ae);
    }
    let content: AiContent;
    try {
      content = validateContent(result.text, new Set(built.sources.map((x) => x.alias)), kind);
    } catch (e) {
      recordUsage({ userId: u.id, sessionId: str(s.id), outputId: null, kind, provider: provider.name, model: result.model, status: "invalid_output", errorCode: "ai_invalid_output", promptTokens: result.promptTokens, completionTokens: result.completionTokens, latencyMs: result.latencyMs, requestKey });
      throw asHttp(e);
    }
    const id = newId("aio");
    run("INSERT INTO ai_outputs(id,session_id,kind,group_id,scope_json,criteria_json,provider,model,simulated,original_json,sources_json,created_by,created_at,updated_at,generation_ms) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)",
      id, str(s.id), kind, kind === "group_summary" ? scope.groupIds[0] : null, JSON.stringify(scope), JSON.stringify(criteria), provider.name, result.model, provider.name === "simulated" ? 1 : 0, JSON.stringify(content), JSON.stringify(built.sources), u.id, now(), now(), result.latencyMs);
    recordUsage({ userId: u.id, sessionId: str(s.id), outputId: id, kind, provider: provider.name, model: result.model, status: "ok", promptTokens: result.promptTokens, completionTokens: result.completionTokens, latencyMs: result.latencyMs, requestKey });
    // Generating never publishes. The result is a private draft.
    audit("facilitator", u.id, "ai_generated", { sessionId: str(s.id), target: id, detail: { kind, provider: provider.name, entries: built.entries.length } });
    return { output: outputView(str(s.id), get("SELECT * FROM ai_outputs WHERE id=?", id)!), skipped: built.skipped, duplicate: false };
  } finally {
    inflight.delete(lock);
  }
});

/* ---------- review, edit, publish ---------- */

route("GET", "/sessions/:id/ai/outputs", (ctx) => {
  const s = facilitatorSession(ctx, ctx.params.id);
  return { outputs: all("SELECT * FROM ai_outputs WHERE session_id=? ORDER BY created_at DESC", str(s.id)).map((o) => outputView(str(s.id), o)) };
});

route("PUT", "/ai/outputs/:id/edit", (ctx) => {
  const u = requireStaff(ctx);
  const { o, s } = outputFor(ctx, ctx.params.id);
  mustBeEditable(s);
  const aliases = new Set(parseJson<Source[]>(o.sources_json, []).map((x) => x.alias));
  // an edit is checked like the original: only sources from the selected work, and the same rules for the output type
  const edited = checked(() => validateContent(obj(ctx.req.body), aliases, str(o.kind) as AiKind));
  run("UPDATE ai_outputs SET edited_json=?, status='edited', reviewed_at=NULL, updated_at=? WHERE id=?", JSON.stringify(edited), now(), str(o.id));
  audit("facilitator", u.id, "ai_edited", { sessionId: str(s.id), target: str(o.id) });
  return { output: outputView(str(s.id), get("SELECT * FROM ai_outputs WHERE id=?", str(o.id))!) };
});

route("POST", "/ai/outputs/:id/revert", (ctx) => {
  const u = requireStaff(ctx);
  const { o, s } = outputFor(ctx, ctx.params.id);
  mustBeEditable(s);
  run("UPDATE ai_outputs SET edited_json=NULL, status=CASE WHEN status='published' THEN 'published' ELSE 'draft' END, reviewed_at=NULL, updated_at=? WHERE id=?", now(), str(o.id));
  audit("facilitator", u.id, "ai_edit_reverted", { sessionId: str(s.id), target: str(o.id) });
  return { output: outputView(str(s.id), get("SELECT * FROM ai_outputs WHERE id=?", str(o.id))!) };
});

route("POST", "/ai/outputs/:id/review", (ctx) => {
  const u = requireStaff(ctx);
  const { o, s } = outputFor(ctx, ctx.params.id);
  mustBeEditable(s);
  const reviewed = bool(obj(ctx.req.body).reviewed, "reviewed");
  if (o.status !== "published") run("UPDATE ai_outputs SET status=?, reviewed_at=?, updated_at=? WHERE id=?", reviewed ? "reviewed" : o.edited_json ? "edited" : "draft", reviewed ? now() : null, now(), str(o.id));
  audit("facilitator", u.id, reviewed ? "ai_reviewed" : "ai_review_withdrawn", { sessionId: str(s.id), target: str(o.id) });
  return { output: outputView(str(s.id), get("SELECT * FROM ai_outputs WHERE id=?", str(o.id))!) };
});

/** Publishing a summary or comparison. Needs a human review first, and stays separate from revealing discussion questions. */
route("POST", "/ai/outputs/:id/publish", (ctx) => {
  const u = requireStaff(ctx);
  const { o, s } = outputFor(ctx, ctx.params.id);
  mustBeEditable(s);
  if (o.kind === "discussion_points") throw badRequest("Discussion questions are not published. Reveal them one at a time instead.", "use_reveal");
  if (o.status !== "reviewed" && o.status !== "published") throw conflict("Review the draft and mark it as reviewed before publishing.", "review_required");
  if (o.status === "published" && !get("SELECT 1 AS x FROM publications WHERE session_id=? AND source_type='ai_output' AND source_id=?", str(s.id), str(o.id)) ) throw conflict("This output is not published.", "bad_state");
  const b = obj(ctx.req.body);
  if (num(o.simulated) && b.acknowledgeSimulated !== true) throw conflict("This is a demo output made by the built-in simulator, not by an AI model. Confirm to publish it anyway.", "simulated_acknowledgement_required");
  const aliases = new Set(parseJson<Source[]>(o.sources_json, []).map((x) => x.alias));
  const content = checked(() => validateContent(effectiveContent(o), aliases, str(o.kind) as AiKind)); // sources are checked again just before publication
  // Participants see the points but never the entry ids or aliases they rest on.
  const group = o.group_id ? get("SELECT name FROM groups WHERE id=?", str(o.group_id)) : undefined;
  const pub: PubContent = {
    type: "ai_output", stageTitle: o.kind === "cross_group" ? "Comparison across groups (AI-assisted)" : "Summary (AI-assisted)", entries: [], synthesis: null,
    ai: { kind: o.kind, overview: content.overview, points: content.points.map((p) => ({ heading: p.heading, text: p.text, kind: p.kind })), simulated: !!num(o.simulated), label: num(o.simulated) ? SIMULATED_LABEL : "AI-assisted draft, reviewed by your facilitator" },
    internal: { groupName: group ? str(group.name) : null, groupId: o.group_id ? str(o.group_id) : null, authors: [] },
  };
  const mode = b.labelMode === undefined ? (num(s.anonymise_default) ? "anonymous" : "group") : oneOf(b.labelMode, "labelMode", ["group", "anonymous"] as const);
  const pid = upsertPublication({ sessionId: str(s.id), userId: u.id, type: "ai_output", sourceId: str(o.id), content: pub, version: sha256(str(o.edited_json ?? o.original_json)).slice(0, 16), groupId: o.group_id ? str(o.group_id) : null, stageId: null, mode });
  run("UPDATE ai_outputs SET status='published', published_at=?, updated_at=? WHERE id=?", now(), now(), str(o.id));
  audit("facilitator", u.id, "ai_published", { sessionId: str(s.id), target: str(o.id), detail: { publicationId: pid, simulated: !!num(o.simulated) } });
  return { publicationId: pid };
});

/** Reveal (or hide again) one discussion question for the class and the projector. */
route("POST", "/ai/outputs/:id/reveal", (ctx) => {
  const u = requireStaff(ctx);
  const { o, s } = outputFor(ctx, ctx.params.id);
  mustBeEditable(s);
  if (o.kind !== "discussion_points") throw badRequest("Only discussion questions are revealed.");
  if (o.status !== "reviewed" && o.status !== "published") throw conflict("Review the questions before revealing any.", "review_required");
  const b = obj(ctx.req.body);
  const index = int(b.index, "index", { min: 0, max: 100 })!;
  const qid = `${o.id}:${index}`;
  const revealed = bool(b.revealed, "revealed");
  if (revealed && !questionText(str(s.id), qid)) throw badRequest("That question does not exist.");
  setQuestionRevealed(str(s.id), qid, revealed);
  audit("facilitator", u.id, revealed ? "question_revealed" : "question_hidden", { sessionId: str(s.id), target: qid });
  return { ok: true, revealed: revealedIds(str(s.id)).includes(qid) };
});

/** The supporting entries behind each point, at the exact versions the AI saw. For the facilitator only. */
route("GET", "/ai/outputs/:id/sources", (ctx) => {
  const { o } = outputFor(ctx, ctx.params.id);
  const sources = parseJson<Source[]>(o.sources_json, []);
  return {
    sources: sources.map((s) => {
      const v = get("SELECT * FROM entry_versions WHERE entry_id=? AND version=?", s.entryId, s.version);
      const e = get("SELECT author_name, group_id FROM entries WHERE id=?", s.entryId);
      const g = get("SELECT name FROM groups WHERE id=?", s.groupId);
      const stage = get("SELECT title FROM stages WHERE id=?", s.stageId);
      return { alias: s.alias, entryId: s.entryId, version: s.version, group: g ? g.name : null, part: stage ? stage.title : null, author: e ? e.author_name : null, kind: v?.kind ?? null, text: v ? str(v.body) : null, table: v?.table_json ? parseJson(v.table_json, null) : null, tags: v ? parseJson<string[]>(v.tags_json, []) : [] };
    }),
  };
});

route("DELETE", "/ai/outputs/:id", (ctx) => {
  const u = requireStaff(ctx);
  const { o, s } = outputFor(ctx, ctx.params.id);
  mustBeEditable(s);
  if (get("SELECT 1 AS x FROM publications WHERE session_id=? AND source_type='ai_output' AND source_id=? AND unpublished_at IS NULL", str(s.id), str(o.id))) throw conflict("This output is published. Stop sharing it first.", "published");
  run("DELETE FROM ai_outputs WHERE id=?", str(o.id));
  audit("facilitator", u.id, "ai_discarded", { sessionId: str(s.id), target: str(o.id) });
  return { ok: true };
});

route("PUT", "/sessions/:id/ai/criteria", (ctx) => {
  const u = requireStaff(ctx);
  const s = facilitatorSession(ctx, ctx.params.id);
  mustBeEditable(s);
  const c = cleanCriteria(ctx.req.body);
  run("UPDATE sessions SET ai_criteria_json=?, updated_at=? WHERE id=?", JSON.stringify(c), now(), str(s.id));
  audit("facilitator", u.id, "ai_criteria_changed", { sessionId: str(s.id) });
  return { criteria: c };
});

/* ---------- usage page, limits, connection test ---------- */

route("GET", "/ai/usage", (ctx) => {
  const u = requireStaff(ctx);
  const l = limits();
  const use = liveUsage(u.id);
  return {
    status: aiStatus(), limits: l, usage: use,
    remaining: { requestsToday: Math.max(0, l.requestsPerDay - use.requestsToday), tokensThisMonth: Math.max(0, l.tokensPerMonth - use.tokensThisMonth) },
    note: "These numbers are this app's own count of requests and the token counts the AI service reported. They can differ from any limit the AI service itself applies. Demo (simulated) requests are listed but never count against a limit.",
    mine: usageReport(u.id),
    everyone: u.isAdmin ? usageReport(null) : null,
    isAdmin: u.isAdmin,
  };
});

route("GET", "/ai/usage/export", (ctx) => {
  const u = requireStaff(ctx);
  const all_ = ctx.req.query.scope === "all";
  if (all_) requireAdmin(ctx);
  ctx.headersOut["content-type"] = "text/csv; charset=utf-8";
  ctx.headersOut["content-disposition"] = `attachment; filename="ai-usage-${all_ ? "everyone" : "mine"}.csv"`;
  ctx.headersOut["cache-control"] = "private, no-store";
  ctx.rawOut = Buffer.from(usageCsv(all_ ? null : u.id), "utf8");
  return undefined;
});

route("PUT", "/admin/ai/limits", (ctx) => {
  const a = requireAdmin(ctx);
  const b = obj(ctx.req.body);
  const r = int(b.requestsPerDay, "Requests per day", { min: 0, max: 1_000_000 })!;
  const t = int(b.tokensPerMonth, "Tokens per month", { min: 0, max: 1_000_000_000 })!;
  setLimits(r, t, a.id);
  audit("admin", a.id, "ai_limits_changed", { detail: { requestsPerDay: r, tokensPerMonth: t } });
  return { limits: limits() };
});

/** Harmless test: a one-word question, no participant data. For the simulator it says plainly that no live request was made. */
route("POST", "/ai/test-connection", async (ctx) => {
  const u = requireStaff(ctx);
  const st = aiStatus();
  if (st.simulated) return { ok: true, simulated: true, provider: "simulated", model: "simulated", message: `${SIMULATED_LABEL} No live request was made. Set AI_PROVIDER=hku and the HKU settings on the host to connect the real service.` };
  if (!st.configured) throw new HttpError(503, "ai_not_configured", `Live AI is not set up yet. Missing or invalid: ${st.problems.join(", ")}.`, { problems: st.problems });
  hit(`aitest:${u.id}`, 10, 10 * 60_000);
  checkQuota(u.id, "hku");
  const provider = getProvider();
  const started = Date.now();
  try {
    const r = await provider.generate({ kind: "test", maxTokens: 8, messages: [{ role: "system", content: "This is a connection test. Reply with the single word: ok" }, { role: "user", content: "ok" }] });
    recordUsage({ userId: u.id, sessionId: null, outputId: null, kind: "test", provider: provider.name, model: r.model, status: "ok", promptTokens: r.promptTokens, completionTokens: r.completionTokens, latencyMs: r.latencyMs });
    return { ok: true, simulated: false, provider: provider.name, model: r.model, latencyMs: r.latencyMs, message: "The AI service answered." };
  } catch (e) {
    const ae = e instanceof AiError ? e : new AiError("ai_failed", "The test failed.", 502);
    recordUsage({ userId: u.id, sessionId: null, outputId: null, kind: "test", provider: provider.name, model: aiSettings().model, status: "error", errorCode: ae.code, httpStatus: ae.httpStatus, latencyMs: Date.now() - started });
    throw asHttp(ae);
  }
});
