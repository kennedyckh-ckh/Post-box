import { run, now, str, audit } from "../db";
import { route, badRequest, conflict } from "../router";
import { requireStaff, facilitatorSession, requireParticipant, mustBeEditable } from "../authz";
import { obj, text, int, oneOf } from "../validate";
import { timerView } from "../timer";

const MAX_MS = 4 * 60 * 60_000;

/** Facilitator controls for the session timer. It is a visible countdown only: nothing is locked when it ends. */
route("POST", "/sessions/:id/timer", (ctx) => {
  const u = requireStaff(ctx);
  const s = facilitatorSession(ctx, ctx.params.id);
  mustBeEditable(s);
  const sid = str(s.id);
  const b = obj(ctx.req.body);
  const action = oneOf(b.action, "action", ["start", "pause", "resume", "add", "reset"] as const);
  const t = now();
  const cur = timerView(sid, t);
  const upsert = (label: string, duration: number, endsAt: number | null, remaining: number | null) =>
    run("INSERT INTO session_timers(session_id,label,duration_ms,ends_at,remaining_ms,updated_by,updated_at) VALUES(?,?,?,?,?,?,?) ON CONFLICT(session_id) DO UPDATE SET label=excluded.label, duration_ms=excluded.duration_ms, ends_at=excluded.ends_at, remaining_ms=excluded.remaining_ms, updated_by=excluded.updated_by, updated_at=excluded.updated_at", sid, label, duration, endsAt, remaining, u.id, t);

  if (action === "start") {
    const seconds = int(b.seconds, "Timer length (seconds)", { min: 5, max: MAX_MS / 1000 })!;
    const label = text(b.label, "Timer label", { max: 60, optional: true });
    upsert(label, seconds * 1000, t + seconds * 1000, null);
  } else if (action === "pause") {
    if (cur.state !== "running") throw conflict("The timer is not running.", "timer_not_running");
    upsert(cur.label, cur.durationMs, null, cur.remainingMs);
  } else if (action === "resume") {
    if (cur.state !== "paused") throw conflict("The timer is not paused.", "timer_not_paused");
    upsert(cur.label, cur.durationMs, t + cur.remainingMs, null);
  } else if (action === "add") {
    const seconds = int(b.seconds, "Seconds to add", { min: -3600, max: 3600 })!;
    if (cur.state === "idle") throw conflict("Start the timer first.", "timer_idle");
    const base = cur.state === "finished" ? 0 : cur.remainingMs;
    const left = Math.min(MAX_MS, Math.max(0, base + seconds * 1000));
    if (left === 0) throw badRequest("That would leave no time on the timer.");
    const duration = Math.min(MAX_MS, Math.max(cur.durationMs + seconds * 1000, left));
    if (cur.state === "paused") upsert(cur.label, duration, null, left);
    else upsert(cur.label, duration, t + left, null);
  } else {
    run("DELETE FROM session_timers WHERE session_id=?", sid);
  }
  audit("facilitator", u.id, `timer_${action}`, { sessionId: sid, detail: action === "start" || action === "add" ? { seconds: b.seconds } : undefined });
  return { timer: timerView(sid) };
});

route("GET", "/sessions/:id/timer", (ctx) => {
  const s = facilitatorSession(ctx, ctx.params.id);
  return { timer: timerView(str(s.id)) };
});

/** Participants see the same countdown. */
route("GET", "/me/timer", (ctx) => {
  const { session } = requireParticipant(ctx, { allowArchived: true });
  return { timer: session.status === "live" ? timerView(str(session.id)) : timerView("") };
});
