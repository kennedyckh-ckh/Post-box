/** Prints the real, final database schema by applying every migration to an empty database. */
import Database from "better-sqlite3";
import { MIGRATIONS } from "../lib/migrations";
const d = new Database(":memory:");
for (const m of MIGRATIONS) d.exec(m.sql);
const rows = d.prepare("SELECT type, name, sql FROM sqlite_master WHERE sql IS NOT NULL AND name NOT LIKE 'sqlite_%' ORDER BY CASE type WHEN 'table' THEN 0 ELSE 1 END, name").all() as { sql: string }[];
console.log(rows.map((r) => r.sql.trim() + ";").join("\n\n"));
