import { get, num, str } from "../db";
import { route, notFound, type Ctx } from "../router";
import { staffFrom, participantIdFrom } from "../auth";
import { readStored } from "../files";
import { groupSetting, effective } from "../stages";
import { servePublished } from "./sharing";

type Access = "full" | "published" | null;

/**
 * Who may download an attachment:
 *  - a facilitator of the session (original name);
 *  - for a participant's picture: an active member of the same group (original name);
 *  - for a facilitator's file: participants of the session, once the stage it belongs to is enabled, visible and not locked for their group;
 *  - a picture inside an item the facilitator has published: any active participant of the session, with a generic file name.
 * Everyone else gets 404, as if the file did not exist. Files are never served from a public folder.
 */
function access(ctx: Ctx, att: Record<string, unknown>): Access {
  const staff = staffFrom(ctx);
  if (staff && get("SELECT 1 AS x FROM session_facilitators WHERE session_id=? AND user_id=?", str(att.session_id), staff.id)) return "full";
  const pid = participantIdFrom(ctx);
  if (!pid) return null;
  const p = get("SELECT * FROM participants WHERE id=? AND status='active'", pid);
  if (!p || p.session_id !== att.session_id) return null;
  if (att.purpose === "entry") {
    if (p.group_id && p.group_id === att.group_id) return "full";
    // someone else's picture is visible only through a publication that is currently shared
    const shared = get("SELECT 1 AS x FROM publications WHERE session_id=? AND unpublished_at IS NULL AND attachment_ids_json LIKE ?", str(att.session_id), `%"${str(att.id)}"%`);
    return shared ? "published" : null;
  }
  const r = get("SELECT r.stage_id FROM stage_resources r WHERE r.attachment_id=?", str(att.id));
  if (!r) return null;
  const st = get("SELECT * FROM stages WHERE id=?", str(r.stage_id));
  if (!st || !num(st.enabled) || !num(st.visible) || !p.group_id) return null;
  const setting = groupSetting(str(p.group_id), str(st.id));
  return !setting.excluded && effective(st, setting) !== "locked" ? "full" : null;
}

route("GET", "/attachments/:id", (ctx) => {
  const att = get("SELECT * FROM attachments WHERE id=? AND deleted_at IS NULL", ctx.params.id);
  const a = att ? access(ctx, att) : null;
  if (!att || !a) throw notFound("File not found");
  if (a === "published") return servePublished(ctx, att);
  const data = readStored(str(att.stored_name));
  if (!data) throw notFound("File not found");
  const isImage = str(att.mime).startsWith("image/");
  ctx.headersOut["content-type"] = str(att.mime);
  ctx.headersOut["content-disposition"] = `${isImage ? "inline" : "attachment"}; filename="${encodeURIComponent(str(att.original_name))}"`;
  ctx.headersOut["x-content-type-options"] = "nosniff";
  // Even if a file were somehow interpreted as a page, it could not run script or load anything.
  ctx.headersOut["content-security-policy"] = "default-src 'none'; sandbox";
  ctx.headersOut["cache-control"] = "private, no-store";
  ctx.rawOut = data;
  return undefined;
});
