import "../lib/handlers";
import { listRoutes } from "../lib/router";
for (const r of listRoutes().sort((a, b) => a.path.localeCompare(b.path) || a.method.localeCompare(b.method))) console.log(`${r.method.padEnd(6)} /api${r.path}${r.raw ? "   (raw upload)" : ""}`);
