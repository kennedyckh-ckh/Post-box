/**
 * Puts a backup back. STOP THE APP FIRST. usage: npm run restore -- <backup folder>
 * The current data is not deleted: it is moved to <DATA_DIR>/replaced-<timestamp>/ so a mistake can be undone.
 */
import fs from "node:fs";
import path from "node:path";
import Database from "better-sqlite3";

const src = process.argv[2] ? path.resolve(process.argv[2]) : "";
const dataDir = process.env.DATA_DIR || path.join(process.cwd(), "data");
if (!src || !fs.existsSync(path.join(src, "app.db"))) {
  console.error("Give the backup folder (it must contain app.db). Example: npm run restore -- /var/data/backups/backup-20261122-101500");
  process.exit(1);
}
const check = new Database(path.join(src, "app.db"), { readonly: true });
const ok = check.pragma("integrity_check", { simple: true });
check.close();
if (ok !== "ok") {
  console.error("The backup's database failed its integrity check. Nothing was changed.");
  process.exit(2);
}
const stamp = new Date().toISOString().replace(/[-:]/g, "").replace(/\..+/, "").replace("T", "-");
const aside = path.join(dataDir, `replaced-${stamp}`);
fs.mkdirSync(aside, { recursive: true });
for (const name of ["app.db", "app.db-wal", "app.db-shm"]) {
  const p = path.join(dataDir, name);
  if (fs.existsSync(p)) fs.renameSync(p, path.join(aside, name));
}
const up = path.join(dataDir, "uploads");
if (fs.existsSync(up)) fs.renameSync(up, path.join(aside, "uploads"));
fs.copyFileSync(path.join(src, "app.db"), path.join(dataDir, process.env.DB_FILE || "app.db"));
fs.mkdirSync(up, { recursive: true });
let n = 0;
if (fs.existsSync(path.join(src, "uploads"))) for (const f of fs.readdirSync(path.join(src, "uploads"))) { fs.copyFileSync(path.join(src, "uploads", f), path.join(up, f)); n++; }
console.log(`Restored from ${src}\n  uploaded files restored: ${n}\n  previous data kept in ${aside}\nNow start the app again.`);
