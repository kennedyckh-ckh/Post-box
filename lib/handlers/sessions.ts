import { all, get, run, tx, now, num, str, audit, type Row } from "../db";
import { newId, randomCode } from "../crypto";
import { route, badRequest, conflict } from "../router";
import { requireStaff, facilitatorSession, mustBeEditable } from "../authz";
import { obj, text, int, bool, oneOf, emailAddr, LIMITS } from "../validate";
import { parseJson } from "../content";
import { TEMPLATES, templateByKey } from "../templates";
import { reactionConfig, critiqueConfig, cleanReactionConfig, cleanCritiqueConfig } from "../sharing";
import { cleanCriteria } from "../ai/analysis";

export interface FieldDef {
  key: string;
  label: string;
  required: boolean;
}

export function parseFields(json: unknown): FieldDef[] {
  try {
    return JSON.parse(str(json)) as FieldDef[];
  } catch {
    return [];
  }
}

function cleanFields(v: unknown): FieldDef[] {
  if (v === undefined || v === null) return [];
  if (!Array.isArray(v)) throw badRequest("Participant fields must be a list.");
  if (v.length > LIMITS.maxFields) throw badRequest(`At most ${LIMITS.maxFields} extra participant fields are allowed.`);
  return v.map((f, i) => {
    const o = obj(f);
    return { key: `f${i + 1}`, label: text(o.label, "Field label", { max: LIMITS.fieldLabel }), required: o.required === true };
  });
}

export function newJoinCode(): string {
  for (let i = 0; i < 20; i++) {
    const c = randomCode(6);
    if (!get("SELECT 1 AS x FROM sessions WHERE join_code=?", c)) return c;
  }
  throw new Error("Could not generate a unique join code");
}

export function sessionView(s: Row) {
  return {
    id: s.id, title: s.title, joinCode: s.join_code, joiningOpen: !!num(s.joining_open), earlyJoin: !!num(s.early_join),
    status: s.status, groupJoinMode: s.group_join_mode, submitPolicy: s.submit_policy, participantFields: parseFields(s.participant_fields_json),
    anonymiseDefault: !!num(s.anonymise_default), reactionConfig: reactionConfig(s), critiqueConfig: critiqueConfig(s), aiCriteria: parseJson(s.ai_criteria_json, null), template: s.template, myRole: s.my_role, createdAt: s.created_at, startedAt: s.started_at, archivedAt: s.archived_at,
  };
}

export function groupsView(sessionId: string) {
  return all(
    `SELECT g.*, (SELECT COUNT(*) FROM participants p WHERE p.group_id=g.id AND p.status='active') AS active_count FROM groups g WHERE g.session_id=? ORDER BY g.position`,
    sessionId
  ).map((g) => ({ id: g.id, name: g.name, seatCap: g.seat_cap ?? null, hasPin: !!g.pin_hash, activeCount: num(g.active_count), representativeId: g.representative_id ?? null }));
}

function stagesView(sessionId: string) {
  return all("SELECT id,position,title,enabled,visible,availability,submit_mode FROM stages WHERE session_id=? ORDER BY position", sessionId).map((s) => ({
    id: s.id, position: num(s.position), title: s.title, enabled: !!num(s.enabled), visible: !!num(s.visible), availability: s.availability, submitMode: s.submit_mode,
  }));
}

route("GET", "/templates", (ctx) => {
  requireStaff(ctx);
  return { templates: TEMPLATES.map((t) => ({ key: t.key, label: t.label, description: t.description, stageTitles: t.stages.map((s) => s.title) })) };
});

route("GET", "/sessions", (ctx) => {
  const u = requireStaff(ctx);
  const rows = all(
    `SELECT s.*, f.role AS my_role,
       (SELECT COUNT(*) FROM participants p WHERE p.session_id=s.id AND p.status='active') AS participant_count,
       (SELECT COUNT(*) FROM groups g WHERE g.session_id=s.id) AS group_count
     FROM sessions s JOIN session_facilitators f ON f.session_id=s.id AND f.user_id=? ORDER BY s.created_at DESC`,
    u.id
  );
  return { sessions: rows.map((s) => ({ ...sessionView(s), participantCount: num(s.participant_count), groupCount: num(s.group_count) })) };
});

route("POST", "/sessions", (ctx) => {
  const u = requireStaff(ctx);
  const b = obj(ctx.req.body);
  const title = text(b.title, "Session title", { max: LIMITS.title });
  const template = templateByKey(typeof b.template === "string" ? b.template : "blank");
  if (!template) throw badRequest("Unknown template.");
  const fields = cleanFields(b.participantFields);
  const mode = b.groupJoinMode === undefined ? "choose" : oneOf(b.groupJoinMode, "Group joining", ["choose", "assigned"] as const);
  const policy = b.submitPolicy === undefined ? "any" : oneOf(b.submitPolicy, "Who may submit", ["any", "representative"] as const);
  const groupCount = int(b.groupCount ?? 4, "Number of groups", { min: 1, max: LIMITS.maxGroups })!;
  const names = Array.isArray(b.groupNames) ? b.groupNames : [];
  const enabled = Array.isArray(b.enabledStages) ? b.enabledStages : [true, true, true];
  if (enabled.length !== 3 || !enabled.some((e) => e === true)) throw badRequest("At least one of the three stages must be enabled.");

  const id = newId("ses");
  tx(() => {
    run(
      "INSERT INTO sessions(id,title,join_code,owner_id,group_join_mode,submit_policy,participant_fields_json,template,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?,?,?)",
      id, title, newJoinCode(), u.id, mode, policy, JSON.stringify(fields), template.key, now(), now()
    );
    run("INSERT INTO session_facilitators(session_id,user_id,role,added_at) VALUES(?,?,'owner',?)", id, u.id, now());
    template.stages.forEach((st, i) => {
      const stageId = newId("stg");
      // Defaults (brief section 5): every stage starts locked; starting the session opens the first enabled stage.
      run("INSERT INTO stages(id,session_id,position,title,enabled,visible,availability,instructions,tags_json) VALUES(?,?,?,?,?,1,'locked',?,?)", stageId, id, i + 1, st.title, enabled[i] === true ? 1 : 0, st.instructions, JSON.stringify(st.tags));
      if (st.contributionTypes) run("UPDATE stages SET contribution_types_json=? WHERE id=?", JSON.stringify(st.contributionTypes), stageId);
      if (st.submitMode) run("UPDATE stages SET submit_mode=? WHERE id=?", st.submitMode, stageId);
      st.questions.forEach((q, qi) => run("INSERT INTO stage_questions(id,stage_id,position,text,required,heading,options_json) VALUES(?,?,?,?,?,?,?)", newId("que"), stageId, qi + 1, q.text, q.required ? 1 : 0, q.heading ?? "", JSON.stringify(q.options ?? [])));
    });
    for (let i = 0; i < groupCount; i++) {
      const nm = typeof names[i] === "string" && names[i].trim() ? text(names[i], "Group name", { max: LIMITS.name }) : `Group ${i + 1}`;
      run("INSERT INTO groups(id,session_id,name,position,created_at) VALUES(?,?,?,?,?)", newId("grp"), id, nm, i + 1, now());
    }
    audit("facilitator", u.id, "session_created", { sessionId: id, detail: { template: template.key } });
  });
  return { id };
});

route("GET", "/sessions/:id", (ctx) => {
  const s = facilitatorSession(ctx, ctx.params.id);
  const facilitators = all("SELECT u.id,u.name,u.email,f.role FROM session_facilitators f JOIN users u ON u.id=f.user_id WHERE f.session_id=? ORDER BY f.role DESC, u.name", String(s.id));
  return { session: sessionView(s), groups: groupsView(String(s.id)), stages: stagesView(String(s.id)), facilitators };
});

route("PATCH", "/sessions/:id", (ctx) => {
  const u = requireStaff(ctx);
  const s = facilitatorSession(ctx, ctx.params.id);
  mustBeEditable(s);
  const b = obj(ctx.req.body);
  const sets: string[] = [];
  const vals: unknown[] = [];
  if (b.title !== undefined) { sets.push("title=?"); vals.push(text(b.title, "Session title", { max: LIMITS.title })); }
  if (b.participantFields !== undefined) { sets.push("participant_fields_json=?"); vals.push(JSON.stringify(cleanFields(b.participantFields))); }
  if (b.groupJoinMode !== undefined) { sets.push("group_join_mode=?"); vals.push(oneOf(b.groupJoinMode, "Group joining", ["choose", "assigned"] as const)); }
  if (b.submitPolicy !== undefined) { sets.push("submit_policy=?"); vals.push(oneOf(b.submitPolicy, "Who may submit", ["any", "representative"] as const)); }
  if (b.earlyJoin !== undefined) { sets.push("early_join=?"); vals.push(bool(b.earlyJoin, "Early joining") ? 1 : 0); }
  if (b.anonymiseDefault !== undefined) { sets.push("anonymise_default=?"); vals.push(bool(b.anonymiseDefault, "Anonymous sharing") ? 1 : 0); }
  if (b.reactionConfig !== undefined) { sets.push("reaction_config_json=?"); vals.push(JSON.stringify(cleanReactionConfig(b.reactionConfig))); }
  if (b.aiCriteria !== undefined) { sets.push("ai_criteria_json=?"); vals.push(JSON.stringify(cleanCriteria(b.aiCriteria))); }
  if (b.critiqueConfig !== undefined) { sets.push("critique_config_json=?"); vals.push(JSON.stringify(cleanCritiqueConfig(b.critiqueConfig))); }
  if (!sets.length) throw badRequest("Nothing to change.");
  sets.push("updated_at=?");
  vals.push(now(), String(s.id));
  run(`UPDATE sessions SET ${sets.join(",")} WHERE id=?`, ...vals);
  audit("facilitator", u.id, "session_updated", { sessionId: String(s.id), detail: { fields: Object.keys(b) } });
  return { ok: true };
});

/** Starting makes the session live and opens the first enabled stage. It does not publish anything. */
route("POST", "/sessions/:id/start", (ctx) => {
  const u = requireStaff(ctx);
  const s = facilitatorSession(ctx, ctx.params.id);
  if (s.status !== "setup") throw conflict(s.status === "live" ? "This session is already live." : "An archived session cannot be started. Restore it first.", "bad_state");
  tx(() => {
    run("UPDATE sessions SET status='live', started_at=?, updated_at=? WHERE id=?", now(), now(), String(s.id));
    const first = get("SELECT id FROM stages WHERE session_id=? AND enabled=1 ORDER BY position LIMIT 1", String(s.id))!;
    run("UPDATE stages SET availability='open', visible=1 WHERE id=?", String(first.id));
    audit("facilitator", u.id, "session_started", { sessionId: String(s.id), detail: { openedStage: first.id } });
  });
  return { ok: true };
});

route("POST", "/sessions/:id/joining", (ctx) => {
  const u = requireStaff(ctx);
  const s = facilitatorSession(ctx, ctx.params.id);
  mustBeEditable(s);
  const open = bool(obj(ctx.req.body).open, "open");
  run("UPDATE sessions SET joining_open=?, updated_at=? WHERE id=?", open ? 1 : 0, now(), String(s.id));
  audit("facilitator", u.id, open ? "joining_opened" : "joining_closed", { sessionId: String(s.id) });
  return { ok: true, joiningOpen: open };
});

/** New code for new joiners. Existing participants keep working: they use their own signed-in session or recovery code. */
route("POST", "/sessions/:id/join-code/regenerate", (ctx) => {
  const u = requireStaff(ctx);
  const s = facilitatorSession(ctx, ctx.params.id);
  mustBeEditable(s);
  const code = newJoinCode();
  run("UPDATE sessions SET join_code=?, updated_at=? WHERE id=?", code, now(), String(s.id));
  audit("facilitator", u.id, "join_code_regenerated", { sessionId: String(s.id) });
  return { joinCode: code };
});

route("POST", "/sessions/:id/facilitators", (ctx) => {
  const u = requireStaff(ctx);
  const s = facilitatorSession(ctx, ctx.params.id, { owner: true });
  mustBeEditable(s);
  const email = emailAddr(obj(ctx.req.body).email);
  const target = get("SELECT id,name,email FROM users WHERE email=? AND disabled_at IS NULL", email);
  if (!target) throw badRequest("No active facilitator account has that email. Ask an administrator to create one.", "no_such_user");
  if (get("SELECT 1 AS x FROM session_facilitators WHERE session_id=? AND user_id=?", String(s.id), String(target.id))) throw conflict("That person can already facilitate this session.", "already_member");
  run("INSERT INTO session_facilitators(session_id,user_id,role,added_by,added_at) VALUES(?,?, 'co',?,?)", String(s.id), String(target.id), u.id, now());
  audit("facilitator", u.id, "co_facilitator_added", { sessionId: String(s.id), target: String(target.id) });
  return { facilitator: { id: target.id, name: target.name, email: target.email, role: "co" } };
});

route("DELETE", "/sessions/:id/facilitators/:userId", (ctx) => {
  const u = requireStaff(ctx);
  const s = facilitatorSession(ctx, ctx.params.id, { owner: true });
  mustBeEditable(s);
  if (ctx.params.userId === String(s.owner_id)) throw badRequest("The owner cannot be removed.");
  const r = run("DELETE FROM session_facilitators WHERE session_id=? AND user_id=? AND role='co'", String(s.id), ctx.params.userId);
  if (!r.changes) throw badRequest("That person is not a co-facilitator of this session.");
  audit("facilitator", u.id, "co_facilitator_removed", { sessionId: String(s.id), target: ctx.params.userId });
  return { ok: true };
});
