"use client";
import { useCallback, useEffect, useRef, useState } from "react";
import { api, errText } from "@/lib/client/api";
import { Button, Card, inputCls } from "@/components/ui";

export interface TimerView { state: "idle" | "running" | "paused" | "finished"; label: string; durationMs: number; remainingMs: number; endsAt: number | null; serverNow: number }

/** Remaining milliseconds, ticking locally between polls and corrected for the difference between this clock and the server's. */
export function useRemaining(t: TimerView | null): number {
  const offset = useRef(0);
  const [, force] = useState(0);
  useEffect(() => { if (t) offset.current = t.serverNow - Date.now(); }, [t]);
  useEffect(() => {
    if (!t || t.state !== "running") return;
    const i = setInterval(() => force((x) => x + 1), 250);
    return () => clearInterval(i);
  }, [t]);
  if (!t) return 0;
  if (t.state === "running" && t.endsAt) return Math.max(0, t.endsAt - (Date.now() + offset.current));
  return t.state === "finished" ? 0 : t.remainingMs;
}

export function fmt(ms: number): string {
  const total = Math.ceil(ms / 1000);
  const h = Math.floor(total / 3600), m = Math.floor((total % 3600) / 60), s = total % 60;
  return h ? `${h}:${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}` : `${m}:${String(s).padStart(2, "0")}`;
}

/** Polls a timer endpoint. Returns null until the first answer. */
export function useTimer(path: string, everyMs = 4000): [TimerView | null, (t: TimerView) => void] {
  const [t, setT] = useState<TimerView | null>(null);
  useEffect(() => {
    let live = true;
    const load = () => api<{ timer: TimerView }>("GET", path).then((r) => { if (live) setT(r.timer); }).catch(() => {});
    load();
    const i = setInterval(load, everyMs);
    return () => { live = false; clearInterval(i); };
  }, [path, everyMs]);
  return [t, setT];
}

const clockIcon = <svg aria-hidden="true" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><circle cx="12" cy="13" r="8" /><path d="M12 9v4l2.5 2.5M9.5 2.5h5" /></svg>;

/** Participants: a slim bar that appears only while the facilitator's timer is running, paused or just finished. */
export function ParticipantTimer() {
  const [t] = useTimer("/me/timer", 5000);
  const left = useRemaining(t);
  if (!t || t.state === "idle") return null;
  const done = t.state === "finished" || left === 0;
  const low = !done && left <= 60_000;
  return (
    <div role="timer" aria-live={done ? "assertive" : "off"} className={`sticky top-[64px] z-20 border-b ${done ? "border-amber-300 bg-amber-50 text-amber-950" : low ? "border-amber-200 bg-[#fdf6ec] text-ink" : "border-line bg-brand-soft text-brand-strong"}`}>
      <div className="mx-auto flex max-w-6xl items-center justify-center gap-3 px-4 py-2 text-sm font-semibold sm:px-6">
        {clockIcon}
        <span>{t.label || "Time left"}</span>
        <span className="text-lg font-bold tabular-nums tracking-tight">{done ? "Time's up" : fmt(left)}</span>
        {t.state === "paused" && <span className="rounded-full bg-white/70 px-2 py-0.5 text-xs">Paused</span>}
      </div>
    </div>
  );
}

const PRESETS = [1, 2, 3, 5, 10, 15];

/** Facilitator controls: presets or a custom length, optional label, pause/resume, add a minute, reset. */
export function FacilitatorTimer({ sessionId, disabled }: { sessionId: string; disabled: boolean }) {
  const [t, setT] = useTimer(`/sessions/${sessionId}/timer`, 5000);
  const left = useRemaining(t);
  const [mins, setMins] = useState("5");
  const [label, setLabel] = useState("");
  const [err, setErr] = useState("");
  const send = useCallback(async (body: Record<string, unknown>) => {
    setErr("");
    try { setT((await api<{ timer: TimerView }>("POST", `/sessions/${sessionId}/timer`, body)).timer); } catch (e) { setErr(errText(e)); }
  }, [sessionId, setT]);
  const active = t && t.state !== "idle";
  const done = t?.state === "finished" || (t?.state === "running" && left === 0);

  return (
    <Card className="mb-8" label="Timer">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <p className="text-xs font-semibold uppercase tracking-[0.14em] text-accent">Timer</p>
          <p className={`mt-1 text-4xl font-bold tabular-nums tracking-tight ${done ? "text-amber-700" : "text-ink"}`} role="timer" aria-label={active ? `${done ? "Time is up" : `${fmt(left)} left`}` : "Timer not started"}>{active ? (done ? "0:00" : fmt(left)) : "–:––"}</p>
          <p className="mt-1 text-sm text-muted">
            {!active ? "Not started. Participants and the projector see it once you start it." : done ? `${t!.label || "Timer"}: time is up.` : t!.state === "paused" ? `${t!.label || "Timer"}: paused.` : `${t!.label || "Timer"}: running, shown to participants and on the projector.`}
          </p>
        </div>
        {active && (
          <div className="flex flex-wrap gap-2">
            {t!.state === "running" && !done && <Button variant="secondary" disabled={disabled} onClick={() => void send({ action: "pause" })}>Pause</Button>}
            {t!.state === "paused" && <Button disabled={disabled} onClick={() => void send({ action: "resume" })}>Resume</Button>}
            <Button variant="secondary" disabled={disabled} onClick={() => void send({ action: "add", seconds: 60 })}>+1 min</Button>
            <Button variant="ghost" disabled={disabled} onClick={() => void send({ action: "reset" })}>Reset</Button>
          </div>
        )}
      </div>
      <div className="mt-4 flex flex-wrap items-end gap-2 border-t border-line pt-4">
        <div className="flex flex-wrap gap-1.5" role="group" aria-label="Start a timer">
          {PRESETS.map((m) => <Button key={m} variant="secondary" disabled={disabled} onClick={() => void send({ action: "start", seconds: m * 60, label })}>{m} min</Button>)}
        </div>
        <div className="flex items-end gap-2">
          <label className="text-sm font-semibold">
            <span className="mb-1 block">Minutes</span>
            <input type="number" min={1} max={240} className={`${inputCls} w-24`} value={mins} onChange={(e) => setMins(e.target.value)} />
          </label>
          <label className="text-sm font-semibold">
            <span className="mb-1 block">Label (optional)</span>
            <input className={`${inputCls} w-52`} maxLength={60} placeholder="e.g. Discuss in groups" value={label} onChange={(e) => setLabel(e.target.value)} />
          </label>
          <Button disabled={disabled || !(Number(mins) > 0)} onClick={() => void send({ action: "start", seconds: Math.round(Number(mins) * 60), label })}>{active ? "Restart" : "Start"}</Button>
        </div>
      </div>
      {err && <p role="alert" className="mt-2 text-sm text-red-800">{err}</p>}
    </Card>
  );
}
