/**
 * Makes a consistent copy of everything: the database (taken with SQLite's own backup, safe while the app is running)
 * and the uploaded files. usage: npm run backup [-- <destination folder>]
 * Default destination: <DATA_DIR>/backups/backup-<timestamp>/
 */
import fs from "node:fs";
import path from "node:path";
import Database from "better-sqlite3";

const dataDir = process.env.DATA_DIR || path.join(process.cwd(), "data");
const dbFile = path.join(dataDir, process.env.DB_FILE || "app.db");
if (!fs.existsSync(dbFile)) {
  console.error(`No database at ${dbFile}. Set DATA_DIR to the folder that holds app.db.`);
  process.exit(1);
}
const stamp = new Date().toISOString().replace(/[-:]/g, "").replace(/\..+/, "").replace("T", "-");
const dest = path.resolve(process.argv[2] || path.join(dataDir, "backups", `backup-${stamp}`));
fs.mkdirSync(dest, { recursive: true });

const db = new Database(dbFile, { readonly: true });
db.exec(`VACUUM INTO '${path.join(dest, "app.db").replace(/'/g, "''")}'`);
db.close();

const up = path.join(dataDir, "uploads");
let files = 0;
if (fs.existsSync(up)) {
  fs.mkdirSync(path.join(dest, "uploads"), { recursive: true });
  for (const f of fs.readdirSync(up)) {
    fs.copyFileSync(path.join(up, f), path.join(dest, "uploads", f));
    files++;
  }
}
const check = new Database(path.join(dest, "app.db"), { readonly: true });
const ok = check.pragma("integrity_check", { simple: true });
const sessions = (check.prepare("SELECT COUNT(*) AS c FROM sessions").get() as { c: number }).c;
check.close();
fs.writeFileSync(path.join(dest, "BACKUP-INFO.txt"), `Backup made ${new Date().toISOString()}\nDatabase integrity: ${ok}\nSessions: ${sessions}\nUploaded files: ${files}\nThis folder contains personal data. Store it as carefully as the live data.\n`);
console.log(`Backup written to ${dest}\n  database integrity: ${ok}\n  sessions: ${sessions}\n  uploaded files: ${files}`);
if (ok !== "ok") process.exit(2);
