import { all, get, run, tx, now, num, str, audit } from "../db";
import { newId } from "../crypto";
import { route, badRequest, conflict } from "../router";
import { requireStaff, facilitatorSession } from "../authz";
import { obj, text } from "../validate";
import { copyStored, removeStored } from "../files";
import { newJoinCode } from "./sessions";
import { parseJson } from "../content";

/**
 * Duplicate = a clean copy of the activity's STRUCTURE.
 * Copied:     settings, stages (titles, instructions, tags, types, questions, links, files, reference choices), groups (names, seat caps).
 * Not copied: participants and their recovery codes, entries, submissions, group responses, group PINs (a copy gets no credentials from
 *             the original: set new PINs), per-group overrides, join code (a new one is made), co-facilitators, and anything published.
 * Facilitator files are physically copied, so the copy keeps working if the original is later deleted.
 */
route("POST", "/sessions/:id/duplicate", (ctx) => {
  const u = requireStaff(ctx);
  const src = facilitatorSession(ctx, ctx.params.id);
  const title = text(obj(ctx.req.body).title ?? `${src.title} (copy)`, "Title", { max: 120 });
  const id = newId("ses");
  const newFiles: string[] = [];
  let groupsNeedingPin: string[] = [];
  try {
    tx(() => {
      run(
        "INSERT INTO sessions(id,title,join_code,joining_open,early_join,status,owner_id,group_join_mode,submit_policy,participant_fields_json,anonymise_default,template,reaction_config_json,critique_config_json,ai_criteria_json,created_at,updated_at) VALUES(?,?,?,1,?,'setup',?,?,?,?,?,?,?,?,?,?,?)",
        id, title, newJoinCode(), num(src.early_join), u.id, str(src.group_join_mode), str(src.submit_policy), str(src.participant_fields_json), num(src.anonymise_default), str(src.template), str(src.reaction_config_json), str(src.critique_config_json), str(src.ai_criteria_json), now(), now()
      );
      run("INSERT INTO session_facilitators(session_id,user_id,role,added_at) VALUES(?,?,'owner',?)", id, u.id, now());

      const stageMap = new Map<string, string>();
      const stages = all("SELECT * FROM stages WHERE session_id=? ORDER BY position", str(src.id));
      for (const st of stages) {
        const nid = newId("stg");
        stageMap.set(str(st.id), nid);
        run(
          "INSERT INTO stages(id,session_id,position,title,enabled,visible,availability,instructions,contribution_types_json,tags_json,submit_mode) VALUES(?,?,?,?,?,?,'locked',?,?,?,?)",
          nid, id, num(st.position), str(st.title), num(st.enabled), num(st.visible), str(st.instructions), str(st.contribution_types_json), str(st.tags_json), str(st.submit_mode ?? "group")
        );
        const qMap = new Map<string, string>();
        // parents first, so each sub-question can point at its parent's copy
        for (const q of all("SELECT * FROM stage_questions WHERE stage_id=? AND deleted_at IS NULL ORDER BY (parent_id IS NOT NULL), position", str(st.id))) {
          const parent = q.parent_id ? qMap.get(str(q.parent_id)) : null;
          if (q.parent_id && !parent) continue; // sub-question of a removed question
          const nq = newId("que");
          qMap.set(str(q.id), nq);
          run("INSERT INTO stage_questions(id,stage_id,position,text,required,visible,parent_id,heading,options_json) VALUES(?,?,?,?,?,?,?,?,?)", nq, nid, num(q.position), str(q.text), num(q.required), q.visible === undefined ? 1 : num(q.visible), parent ?? null, str(q.heading ?? ""), str(q.options_json ?? "[]"));
        }
        for (const r of all("SELECT * FROM stage_resources WHERE stage_id=? ORDER BY position", str(st.id))) {
          if (r.kind === "link") {
            run("INSERT INTO stage_resources(id,stage_id,position,kind,title,url) VALUES(?,?,?,'link',?,?)", newId("res"), nid, num(r.position), str(r.title), str(r.url));
          } else {
            const a = get("SELECT * FROM attachments WHERE id=? AND deleted_at IS NULL", str(r.attachment_id));
            if (!a) continue;
            const stored = copyStored(str(a.stored_name));
            if (!stored) continue;
            newFiles.push(stored);
            const aid = newId("att");
            run("INSERT INTO attachments(id,session_id,owner_user_id,purpose,mime,bytes,sha256,stored_name,original_name,created_at) VALUES(?,?,?,'resource',?,?,?,?,?,?)", aid, id, u.id, str(a.mime), num(a.bytes), str(a.sha256), stored, str(a.original_name), now());
            run("INSERT INTO stage_resources(id,stage_id,position,kind,title,attachment_id) VALUES(?,?,?,'file',?,?)", newId("res"), nid, num(r.position), str(r.title), aid);
          }
        }
      }
      // reference choices point at the copied stages
      for (const st of stages) {
        const refs = parseJson<string[]>(st.reference_stage_ids_json, []).map((x) => stageMap.get(x)).filter((x): x is string => !!x);
        run("UPDATE stages SET reference_stage_ids_json=? WHERE id=?", JSON.stringify(refs), stageMap.get(str(st.id))!);
      }
      for (const g of all("SELECT * FROM groups WHERE session_id=? ORDER BY position", str(src.id))) {
        run("INSERT INTO groups(id,session_id,name,position,seat_cap,created_at) VALUES(?,?,?,?,?,?)", newId("grp"), id, str(g.name), num(g.position), g.seat_cap ?? null, now());
        if (g.pin_hash) groupsNeedingPin.push(str(g.name));
      }
      audit("facilitator", u.id, "session_duplicated", { sessionId: id, target: str(src.id) });
    });
  } catch (e) {
    for (const f of newFiles) removeStored(f);
    groupsNeedingPin = [];
    throw e;
  }
  return { id, groupsNeedingPin };
});

route("POST", "/sessions/:id/archive", (ctx) => {
  const u = requireStaff(ctx);
  const s = facilitatorSession(ctx, ctx.params.id);
  if (s.status === "archived") throw conflict("This session is already archived.", "bad_state");
  run("UPDATE sessions SET status='archived', archived_at=?, updated_at=? WHERE id=?", now(), now(), str(s.id));
  audit("facilitator", u.id, "session_archived", { sessionId: str(s.id) });
  return { ok: true };
});

route("POST", "/sessions/:id/restore", (ctx) => {
  const u = requireStaff(ctx);
  const s = facilitatorSession(ctx, ctx.params.id);
  if (s.status !== "archived") throw conflict("This session is not archived.", "bad_state");
  // back to where it was: a session that had been started returns to live, otherwise to setup
  run("UPDATE sessions SET status=?, archived_at=NULL, updated_at=? WHERE id=?", s.started_at ? "live" : "setup", now(), str(s.id));
  audit("facilitator", u.id, "session_restored", { sessionId: str(s.id) });
  return { ok: true };
});

/**
 * Permanent deletion. Owner only, and the owner must type the exact session title.
 * Removes: every database record of the session (groups, participants, entries and their versions, submissions, resources,
 * group responses, and later phases' sharing and AI records), all uploaded files, and the session's audit history,
 * leaving a single tombstone line (who, when, which id; no content). Backups already taken still hold the data until they expire.
 */
route("DELETE", "/sessions/:id", (ctx) => {
  const u = requireStaff(ctx);
  const s = facilitatorSession(ctx, ctx.params.id, { owner: true });
  const typed = text(obj(ctx.req.body).confirmTitle, "Confirmation", { max: 200 });
  if (typed !== str(s.title)) throw badRequest("To delete this session permanently, type its exact title.", "confirmation_mismatch");
  const files = all("SELECT stored_name FROM attachments WHERE session_id=?", str(s.id)).map((a) => str(a.stored_name));
  const participants = all("SELECT id FROM participants WHERE session_id=?", str(s.id)).map((p) => str(p.id));
  tx(() => {
    for (const pid of participants) run("DELETE FROM auth_sessions WHERE participant_id=?", pid);
    run("DELETE FROM audit_log WHERE session_id=?", str(s.id));
    run("DELETE FROM sessions WHERE id=?", str(s.id));
    audit("facilitator", u.id, "session_deleted", { target: str(s.id), detail: { participants: participants.length, files: files.length } });
  });
  for (const f of files) removeStored(f);
  return { ok: true };
});
