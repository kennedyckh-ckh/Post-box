import { get, run, now } from "./db";
import { tooMany } from "./router";

/**
 * Throttling stored in the database, so it survives restarts and works across requests.
 * `hit` counts every attempt; `fail`/`blocked`/`clear` count only failures (logins, PINs, recovery codes).
 */
export function hit(key: string, max: number, windowMs: number) {
  const t = now();
  const r = get("SELECT count, window_start FROM rate_limits WHERE key=?", key);
  if (!r || t - Number(r.window_start) > windowMs) {
    run("INSERT INTO rate_limits(key,count,window_start,locked_until) VALUES(?,1,?,0) ON CONFLICT(key) DO UPDATE SET count=1, window_start=excluded.window_start, locked_until=0", key, t);
    return;
  }
  const count = Number(r.count) + 1;
  run("UPDATE rate_limits SET count=? WHERE key=?", count, key);
  if (count > max) {
    const wait = Math.ceil((Number(r.window_start) + windowMs - t) / 1000);
    throw tooMany("Too many attempts. Please wait a few minutes and try again.", Math.max(wait, 1));
  }
}

export function blocked(key: string) {
  const r = get("SELECT locked_until FROM rate_limits WHERE key=?", key);
  const until = r ? Number(r.locked_until) : 0;
  if (until > now()) throw tooMany("Too many failed attempts. Please wait a few minutes and try again.", Math.ceil((until - now()) / 1000));
}

export function fail(key: string, max: number, windowMs: number, lockMs: number) {
  const t = now();
  const r = get("SELECT count, window_start FROM rate_limits WHERE key=?", key);
  let count = 1;
  let start = t;
  if (r && t - Number(r.window_start) <= windowMs) {
    count = Number(r.count) + 1;
    start = Number(r.window_start);
  }
  const lock = count >= max ? t + lockMs : 0;
  run("INSERT INTO rate_limits(key,count,window_start,locked_until) VALUES(?,?,?,?) ON CONFLICT(key) DO UPDATE SET count=excluded.count, window_start=excluded.window_start, locked_until=excluded.locked_until", key, count, start, lock);
}

export function clear(key: string) {
  run("DELETE FROM rate_limits WHERE key=?", key);
}
