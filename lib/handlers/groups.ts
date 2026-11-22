import { get, run, now, num, audit, tx } from "../db";
import { newId, hashSecret } from "../crypto";
import { route, badRequest, conflict } from "../router";
import { requireStaff, facilitatorSession, groupForFacilitator, mustBeEditable } from "../authz";
import { obj, text, int, LIMITS } from "../validate";

function pinValue(v: unknown): string {
  const pin = text(v, "Group PIN", { max: LIMITS.pinMax });
  if ([...pin].length < LIMITS.pinMin) throw badRequest(`A group PIN must be at least ${LIMITS.pinMin} characters.`);
  return pin;
}

route("POST", "/sessions/:id/groups", (ctx) => {
  const u = requireStaff(ctx);
  const s = facilitatorSession(ctx, ctx.params.id);
  mustBeEditable(s);
  const b = obj(ctx.req.body);
  const name = text(b.name, "Group name", { max: LIMITS.name });
  const cap = int(b.seatCap, "Seat cap", { min: 1, max: LIMITS.seatCapMax, optional: true });
  const pin = b.pin ? hashSecret(pinValue(b.pin)) : null;
  const id = newId("grp");
  tx(() => {
    const count = num(get("SELECT COUNT(*) AS c FROM groups WHERE session_id=?", String(s.id))!.c);
    if (count >= LIMITS.maxGroups) throw badRequest(`A session can have at most ${LIMITS.maxGroups} groups.`);
    run("INSERT INTO groups(id,session_id,name,position,pin_hash,seat_cap,created_at) VALUES(?,?,?,?,?,?,?)", id, String(s.id), name, count + 1, pin, cap, now());
    audit("facilitator", u.id, "group_created", { sessionId: String(s.id), target: id });
  });
  return { id };
});

route("PATCH", "/groups/:gid", (ctx) => {
  const u = requireStaff(ctx);
  const { group, session } = groupForFacilitator(ctx, ctx.params.gid);
  mustBeEditable(session);
  const b = obj(ctx.req.body);
  const sets: string[] = [];
  const vals: unknown[] = [];
  if (b.name !== undefined) { sets.push("name=?"); vals.push(text(b.name, "Group name", { max: LIMITS.name })); }
  if (b.pin !== undefined) { sets.push("pin_hash=?"); vals.push(b.pin === null || b.pin === "" ? null : hashSecret(pinValue(b.pin))); }
  if (b.seatCap !== undefined) {
    const cap = b.seatCap === null ? null : int(b.seatCap, "Seat cap", { min: 1, max: LIMITS.seatCapMax });
    const active = num(get("SELECT COUNT(*) AS c FROM participants WHERE group_id=? AND status='active'", String(group.id))!.c);
    if (cap !== null && cap < active) throw conflict(`This group already has ${active} members. Move some out before lowering the cap.`, "cap_below_members");
    sets.push("seat_cap=?");
    vals.push(cap);
  }
  if (!sets.length) throw badRequest("Nothing to change.");
  vals.push(String(group.id));
  run(`UPDATE groups SET ${sets.join(",")} WHERE id=?`, ...vals);
  audit("facilitator", u.id, "group_updated", { sessionId: String(session.id), target: String(group.id), detail: { fields: Object.keys(b).filter((k) => k !== "pin") , pinChanged: b.pin !== undefined } });
  return { ok: true };
});

route("DELETE", "/groups/:gid", (ctx) => {
  const u = requireStaff(ctx);
  const { group, session } = groupForFacilitator(ctx, ctx.params.gid);
  mustBeEditable(session);
  // Removed participants also count: their contributions stay attributed to this group.
  if (get("SELECT 1 AS x FROM participants WHERE group_id=? LIMIT 1", String(group.id))) throw conflict("This group has (or had) participants, so it cannot be deleted. Move them out first, or keep the group.", "group_not_empty");
  run("DELETE FROM groups WHERE id=?", String(group.id));
  audit("facilitator", u.id, "group_deleted", { sessionId: String(session.id), target: String(group.id) });
  return { ok: true };
});

route("POST", "/groups/:gid/representative", (ctx) => {
  const u = requireStaff(ctx);
  const { group, session } = groupForFacilitator(ctx, ctx.params.gid);
  mustBeEditable(session);
  const pid = obj(ctx.req.body).participantId;
  if (pid !== null && typeof pid !== "string") throw badRequest("participantId must be text or null.");
  if (pid) {
    const p = get("SELECT id FROM participants WHERE id=? AND group_id=? AND status='active'", pid, String(group.id));
    if (!p) throw badRequest("That participant is not an active member of this group.");
  }
  run("UPDATE groups SET representative_id=? WHERE id=?", pid, String(group.id));
  audit("facilitator", u.id, "representative_set", { sessionId: String(session.id), target: String(group.id), detail: { participantId: pid } });
  return { ok: true };
});
