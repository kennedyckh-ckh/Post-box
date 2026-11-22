import { all, get, num, str } from "../db";
import { route } from "../router";
import { facilitatorSession } from "../authz";
import { parseJson } from "../content";

/** Basic audit history for the session's facilitators: stage release, reopening, publication, membership changes, deletion and more. */
route("GET", "/sessions/:id/audit", (ctx) => {
  const s = facilitatorSession(ctx, ctx.params.id);
  const limit = Math.min(Math.max(Number(ctx.req.query.limit) || 200, 1), 500);
  const rows = all("SELECT * FROM audit_log WHERE session_id=? ORDER BY id DESC LIMIT ?", str(s.id), limit);
  const name = (type: string, id: unknown): string => {
    if (!id) return "System";
    if (type === "participant") return str(get("SELECT display_name FROM participants WHERE id=?", str(id))?.display_name) || "A participant";
    return str(get("SELECT name FROM users WHERE id=?", str(id))?.name) || "A facilitator";
  };
  return {
    events: rows.map((r) => ({ id: num(r.id), at: num(r.at), actorType: r.actor_type, actor: name(str(r.actor_type), r.actor_id), action: r.action, target: r.target ?? null, detail: parseJson<unknown>(r.detail_json, null) })),
  };
});
