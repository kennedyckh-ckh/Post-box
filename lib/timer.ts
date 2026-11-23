import { get, str, num } from "./db";

export type TimerState = "idle" | "running" | "paused" | "finished";
export interface TimerView { state: TimerState; label: string; durationMs: number; remainingMs: number; endsAt: number | null; serverNow: number }

/** The session's countdown as everyone sees it. serverNow lets each screen correct for its own clock. */
export function timerView(sessionId: string, at = Date.now()): TimerView {
  const t = get("SELECT * FROM session_timers WHERE session_id=?", sessionId);
  if (!t) return { state: "idle", label: "", durationMs: 0, remainingMs: 0, endsAt: null, serverNow: at };
  const label = str(t.label);
  const durationMs = num(t.duration_ms);
  if (t.ends_at !== null && t.ends_at !== undefined) {
    const left = num(t.ends_at) - at;
    return { state: left > 0 ? "running" : "finished", label, durationMs, remainingMs: Math.max(0, left), endsAt: num(t.ends_at), serverNow: at };
  }
  if (t.remaining_ms !== null && t.remaining_ms !== undefined) return { state: "paused", label, durationMs, remainingMs: num(t.remaining_ms), endsAt: null, serverNow: at };
  return { state: "idle", label, durationMs, remainingMs: durationMs, endsAt: null, serverNow: at };
}
