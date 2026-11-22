import { all, run, now, num, str } from "./db";
import { removeStored } from "./files";

/**
 * Housekeeping, run once at start and then every 6 hours. It never touches participants' saved work:
 *  - pictures that were uploaded but never attached to an entry for 24 hours are removed (they would otherwise pile up);
 *  - expired or revoked sign-in records, old throttling counters and old "who is typing" markers are cleared.
 */
export function cleanup(): { orphanFiles: number; sessions: number } {
  const dayAgo = now() - 24 * 3600_000;
  const orphans = all(
    `SELECT a.id, a.stored_name FROM attachments a
     WHERE a.purpose='entry' AND a.deleted_at IS NULL AND a.created_at<?
       AND NOT EXISTS (SELECT 1 FROM entries e WHERE e.attachment_id=a.id)
       AND NOT EXISTS (SELECT 1 FROM entry_versions v WHERE v.attachment_id=a.id)`,
    dayAgo
  );
  for (const o of orphans) {
    run("UPDATE attachments SET deleted_at=? WHERE id=?", now(), str(o.id));
    removeStored(str(o.stored_name));
  }
  const dead = run("DELETE FROM auth_sessions WHERE expires_at<? OR (revoked_at IS NOT NULL AND revoked_at<?)", now(), dayAgo);
  run("DELETE FROM rate_limits WHERE window_start<? AND locked_until<?", dayAgo, now());
  run("DELETE FROM presence WHERE last_beat<?", dayAgo);
  return { orphanFiles: orphans.length, sessions: num(dead.changes) };
}

type G = typeof globalThis & { __gw_maint?: NodeJS.Timeout };
export function startMaintenance() {
  const g = globalThis as G;
  try {
    cleanup();
  } catch (e) {
    console.error("Maintenance failed:", (e as Error).message);
  }
  if (g.__gw_maint) return;
  g.__gw_maint = setInterval(() => {
    try {
      cleanup();
    } catch (e) {
      console.error("Maintenance failed:", (e as Error).message);
    }
  }, 6 * 3600_000);
  g.__gw_maint.unref();
}
