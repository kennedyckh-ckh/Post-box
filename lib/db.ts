import fs from "node:fs";
import path from "node:path";
import Database from "better-sqlite3";
import { MIGRATIONS } from "./migrations";
import { bootstrapAdmin } from "./bootstrap";
import { startMaintenance } from "./maintenance"; // circular on purpose: only called at runtime, after both modules have loaded

export type Row = Record<string, unknown>;

export function dataDir(): string {
  return process.env.DATA_DIR || path.join(process.cwd(), "data");
}
export const uploadDir = () => path.join(dataDir(), "uploads");
export const backupDir = () => path.join(dataDir(), "backups");

type G = typeof globalThis & { __gw_db?: Database.Database; __gw_db_path?: string };

function open(): Database.Database {
  const dir = dataDir();
  fs.mkdirSync(dir, { recursive: true });
  fs.mkdirSync(uploadDir(), { recursive: true });
  const file = path.join(dir, process.env.DB_FILE || "app.db");
  const d = new Database(file);
  d.pragma("journal_mode = WAL");
  d.pragma("foreign_keys = ON");
  d.pragma("busy_timeout = 5000");
  migrate(d);
  return d;
}

/** Applies pending migrations. An existing database with data is copied to backups/ first. */
export function migrate(d: Database.Database) {
  d.exec("CREATE TABLE IF NOT EXISTS schema_migrations(id TEXT PRIMARY KEY, applied_at INTEGER NOT NULL)");
  const done = new Set((d.prepare("SELECT id FROM schema_migrations").all() as { id: string }[]).map((r) => r.id));
  const pending = MIGRATIONS.filter((m) => !done.has(m.id));
  if (!pending.length) return;
  if (done.size > 0) {
    fs.mkdirSync(backupDir(), { recursive: true });
    const dest = path.join(backupDir(), `app-before-${pending[0].id}-${Date.now()}.db`);
    d.exec(`VACUUM INTO '${dest.replace(/'/g, "''")}'`);
  }
  for (const m of pending) {
    d.exec("BEGIN");
    try {
      d.exec(m.sql);
      d.prepare("INSERT INTO schema_migrations(id, applied_at) VALUES(?,?)").run(m.id, Date.now());
      d.exec("COMMIT");
    } catch (e) {
      d.exec("ROLLBACK");
      throw new Error(`Migration ${m.id} failed: ${(e as Error).message}`);
    }
  }
}

export function db(): Database.Database {
  const g = globalThis as G;
  const wanted = path.join(dataDir(), process.env.DB_FILE || "app.db");
  if (g.__gw_db && g.__gw_db_path !== wanted) {
    g.__gw_db.close();
    g.__gw_db = undefined;
  }
  if (!g.__gw_db) {
    g.__gw_db = open();
    g.__gw_db_path = wanted;
    bootstrapAdmin();
    startMaintenance();
  }
  return g.__gw_db;
}

export function closeDb() {
  const g = globalThis as G;
  g.__gw_db?.close();
  g.__gw_db = undefined;
}

export const all = (sql: string, ...p: unknown[]): Row[] => db().prepare(sql).all(...p) as Row[];
export const get = (sql: string, ...p: unknown[]): Row | undefined => db().prepare(sql).get(...p) as Row | undefined;
export function run(sql: string, ...p: unknown[]): { changes: number } {
  const r = db().prepare(sql).run(...p);
  return { changes: Number(r.changes) };
}
/** Write transaction. BEGIN IMMEDIATE takes the write lock up front, so concurrent joins/submits serialise. */
export function tx<T>(fn: () => T): T {
  return db().transaction(fn).immediate();
}
export const now = () => Date.now();
export const num = (v: unknown) => Number(v);
export const str = (v: unknown) => String(v ?? "");

export function audit(actorType: string, actorId: string | null, action: string, opts: { sessionId?: string | null; target?: string; detail?: unknown } = {}) {
  run(
    "INSERT INTO audit_log(session_id,actor_type,actor_id,action,target,detail_json,at) VALUES(?,?,?,?,?,?,?)",
    opts.sessionId ?? null,
    actorType,
    actorId,
    action,
    opts.target ?? null,
    opts.detail === undefined ? null : JSON.stringify(opts.detail),
    now()
  );
}
