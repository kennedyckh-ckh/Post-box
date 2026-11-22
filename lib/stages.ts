import { get, all, num, str, type Row } from "./db";
import { forbidden, notFound } from "./router";
import type { ParticipantCtx } from "./authz";
import { isSubmitted } from "./submissions";

export type Availability = "locked" | "open" | "closed";

export function groupSetting(groupId: string, stageId: string): { override: Availability | null; excluded: boolean } {
  const r = get("SELECT availability_override, excluded FROM group_stage_settings WHERE group_id=? AND stage_id=?", groupId, stageId);
  return { override: (r?.availability_override as Availability | null) ?? null, excluded: !!num(r?.excluded) };
}

/** A group's override, when set, wins over the stage's own state. */
export const effective = (stage: Row, setting: { override: Availability | null }): Availability => setting.override ?? (stage.availability as Availability);

export interface StageAccess {
  stage: Row;
  availability: Availability;
  excluded: boolean;
  canRead: boolean;
  canWrite: boolean;
  /** why writing is not possible (null when it is) */
  blocked: { code: string; message: string } | null;
}

/**
 * The single place that decides what a participant may do with a stage. Every stage, entry, upload and synthesis
 * route calls this, so hidden, disabled, locked and closed stages cannot be bypassed by calling the API directly.
 * Hidden or disabled stages answer 404, exactly as if they did not exist.
 */
export function stageAccess(pc: ParticipantCtx, stageId: string): StageAccess {
  const stage = get("SELECT * FROM stages WHERE id=? AND session_id=?", stageId, str(pc.session.id));
  if (!stage || !num(stage.enabled) || !num(stage.visible)) throw notFound("Part not found");
  if (!pc.group) throw forbidden("Your facilitator has not placed you in a group yet.", "no_group");
  const setting = groupSetting(str(pc.group.id), stageId);
  const availability = effective(stage, setting);
  if (setting.excluded) throw forbidden("Your group is not taking part in this part.", "group_excluded");
  if (availability === "locked") throw forbidden("This part is locked until your facilitator opens it.", "stage_locked");
  let blocked: StageAccess["blocked"] = null;
  if (pc.session.status !== "live") blocked = { code: "session_not_live", message: pc.session.status === "archived" ? "This session is archived and read-only." : "This session has not started yet." };
  else if (availability === "closed") blocked = { code: "stage_closed", message: "This part is closed. You can read it but not change it." };
  else if (isSubmitted(str(pc.group.id), stageId)) blocked = { code: "submitted", message: "Your group has submitted this part. Ask your facilitator to reopen it to make changes." };
  return { stage, availability, excluded: false, canRead: true, canWrite: blocked === null, blocked };
}

export function assertWritable(a: StageAccess) {
  if (a.blocked) throw forbidden(a.blocked.message, a.blocked.code);
}

/** State of every enabled, visible stage as one group sees it (titles only: no instructions or questions). */
export function stageStates(sessionId: string, groupId: string | null) {
  return all("SELECT * FROM stages WHERE session_id=? AND enabled=1 AND visible=1 ORDER BY position", sessionId).map((s) => {
    const setting = groupId ? groupSetting(groupId, str(s.id)) : { override: null, excluded: false };
    return { id: s.id, position: num(s.position), title: s.title, availability: setting.excluded ? ("locked" as const) : effective(s, setting), excluded: setting.excluded };
  });
}

