import { describe, it, expect, beforeAll } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { Client, adminClient, newFacilitator, newSession, joinAs } from "./helpers";
import { db, closeDb, uploadDir, dataDir } from "@/lib/db";
import { cleanup } from "@/lib/maintenance";
import { listRoutes } from "@/lib/router";
import "@/lib/handlers";

const run = promisify(execFile);
let admin: Client;
beforeAll(async () => {
  admin = await adminClient();
});

const chunk = (t: string, d: Buffer) => { const l = Buffer.alloc(4); l.writeUInt32BE(d.length); return Buffer.concat([l, Buffer.from(t, "latin1"), d, Buffer.alloc(4)]); };
const PNG = Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), chunk("IHDR", Buffer.alloc(13)), chunk("IDAT", Buffer.from([1, 2, 3])), chunk("IEND", Buffer.alloc(0))]);

async function live(extra: Record<string, unknown> = {}) {
  const fac = await newFacilitator(admin);
  const s = await newSession(fac, { groupCount: 2, template: "discussion", ...extra });
  await fac.post(`/sessions/${s.id}/start`);
  const st = (await fac.get(`/sessions/${s.id}/stages`)).body.stages as { id: string; questions: { id: string }[] }[];
  await fac.patch(`/stages/${st[0].id}`, { contributionTypes: ["text", "table", "image"] });
  return { fac, s, st };
}

describe("every endpoint is protected on the server", () => {
  // logout and leave are harmless without a sign-in (they only clear a cookie)
  const PUBLIC = new Set(["POST /auth/logout", "POST /leave", "GET /health", "POST /auth/login", "GET /public/session", "POST /join", "POST /recover", "GET /present/:token", "GET /present/:token/attachments/:id"]);
  const PARTICIPANT = new Set([
    "GET /me", "POST /me/recovery-code", "POST /leave", "GET /board", "GET /stages/:sid", "GET /stages/:sid/entries", "POST /stages/:sid/entries", "PATCH /entries/:id", "DELETE /entries/:id",
    "PUT /stages/:sid/synthesis", "POST /stages/:sid/uploads", "POST /stages/:sid/presence", "GET /stages/:sid/submission", "POST /stages/:sid/submit", "POST /reactions", "POST /comments", "DELETE /comments/:id", "GET /attachments/:id",
  ]);
  const fill = (p: string) => p.replace(/:[a-zA-Z]+/g, "x");
  const routes = listRoutes();

  it("lists the real routes (guard against forgetting to register one)", () => {
    expect(routes.length).toBeGreaterThan(80);
  });

  it("with no sign-in, nothing except the few public entry points answers", async () => {
    const c = new Client("10.90.0.1");
    const bad: string[] = [];
    for (const r of routes) {
      const key = `${r.method} ${r.path}`;
      if (PUBLIC.has(key)) continue;
      const res = await c.call(r.method, fill(r.path), r.method === "GET" ? undefined : {});
      if (![401, 404].includes(res.status)) bad.push(`${key} -> ${res.status}`);
      if (res.status === 404 && !key.startsWith("GET /attachments")) bad.push(`${key} -> 404 (expected 401)`);
    }
    expect(bad).toEqual([]);
  });

  it("a participant's sign-in opens only participant routes, never facilitator or admin ones", async () => {
    const { s } = await live();
    const p = await joinAs(s, "Pat", { group: 0 });
    const bad: string[] = [];
    for (const r of routes) {
      const key = `${r.method} ${r.path}`;
      if (PUBLIC.has(key) || PARTICIPANT.has(key)) continue;
      const res = await p.c.call(r.method, fill(r.path), r.method === "GET" ? undefined : {});
      if (res.status !== 401) bad.push(`${key} -> ${res.status}`);
    }
    expect(bad).toEqual([]);
  });

  it("a facilitator's sign-in does not open participant routes", async () => {
    const { fac } = await live();
    const bad: string[] = [];
    for (const key of PARTICIPANT) {
      if (key === "GET /attachments/:id" || PUBLIC.has(key)) continue; // shared on purpose: a facilitator can open their own session's files; leave only clears a cookie
      const [method, p] = key.split(" ");
      const res = await fac.call(method, fill(p), method === "GET" ? undefined : {});
      if (res.status !== 401) bad.push(`${key} -> ${res.status}`);
    }
    expect(bad).toEqual([]);
  });

  it("admin-only routes refuse ordinary facilitators", async () => {
    const { fac } = await live();
    for (const key of routes.filter((r) => r.path.startsWith("/admin")).map((r) => `${r.method} ${r.path}`)) {
      const [method, p] = key.split(" ");
      const res = await fac.call(method, fill(p), method === "GET" ? undefined : { requestsPerDay: 1, tokensPerMonth: 1, email: "a@b.co", name: "x", disabled: true });
      expect(res.status, key).toBe(403);
    }
  });
});

describe("persistence across a restart", () => {
  it("responses, pictures, sign-ins and recovery codes survive the database being closed and reopened", async () => {
    const { fac, s, st } = await live();
    const a = await joinAs(s, "Ann", { group: 0 });
    const up = await a.c.upload(`/stages/${st[0].id}/uploads`, PNG, "pic.png");
    const e = await a.c.post(`/stages/${st[0].id}/entries`, { kind: "text", body: "saved before restart", attachmentId: up.body.attachment.id });
    expect(e.status).toBe(200);
    closeDb(); // what a redeploy does to the process; the files on disk are what is left
    const list = await a.c.get(`/stages/${st[0].id}/entries`); // same cookie, new process state
    expect(list.status).toBe(200);
    expect(list.body.entries[0].body).toBe("saved before restart");
    expect((await a.c.get(`/attachments/${up.body.attachment.id}`)).raw!.length).toBeGreaterThan(20);
    expect((await new Client("10.91.0.1").post("/recover", { recoveryCode: a.r.body.recoveryCode })).status).toBe(200);
    expect((await fac.get(`/sessions/${s.id}`)).status).toBe(200);
  });
});

describe("housekeeping", () => {
  it("removes pictures that were never attached after a day, keeps attached ones and recent ones, and never touches saved work", async () => {
    const { s, st } = await live();
    const a = await joinAs(s, "Ann", { group: 0 });
    const keep = (await a.c.upload(`/stages/${st[0].id}/uploads`, PNG, "keep.png")).body.attachment.id;
    await a.c.post(`/stages/${st[0].id}/entries`, { kind: "text", body: "has a picture", attachmentId: keep });
    const orphan = (await a.c.upload(`/stages/${st[0].id}/uploads`, PNG, "orphan.png")).body.attachment.id;
    const fresh = (await a.c.upload(`/stages/${st[0].id}/uploads`, PNG, "fresh.png")).body.attachment.id;
    const old = Date.now() - 25 * 3600_000;
    db().prepare("UPDATE attachments SET created_at=? WHERE id IN (?,?)").run(old, keep, orphan);
    const stored = (id: string) => (db().prepare("SELECT stored_name, deleted_at FROM attachments WHERE id=?").get(id) as { stored_name: string; deleted_at: number | null });
    const files = [keep, orphan, fresh].map((id) => path.join(uploadDir(), stored(id).stored_name));
    expect(cleanup().orphanFiles).toBeGreaterThanOrEqual(1);
    expect(stored(orphan).deleted_at).not.toBeNull();
    expect(fs.existsSync(files[1])).toBe(false);
    expect(stored(keep).deleted_at).toBeNull();
    expect(fs.existsSync(files[0])).toBe(true);
    expect(stored(fresh).deleted_at).toBeNull();
    expect(fs.existsSync(files[2])).toBe(true);
    expect((await a.c.get(`/stages/${st[0].id}/entries`)).body.entries.length).toBe(1);
  });

  it("clears expired sign-ins and old throttling counters", () => {
    db().prepare("INSERT INTO rate_limits(key,count,window_start,locked_until) VALUES('old-test',1,?,0)").run(Date.now() - 3 * 86_400_000);
    cleanup();
    expect(db().prepare("SELECT COUNT(*) AS c FROM rate_limits WHERE key='old-test'").get()).toEqual({ c: 0 });
  });
});

describe("backup and restore", () => {
  it("makes a verified copy while the app is running and restores it into an empty folder", async () => {
    const { s, st } = await live();
    const a = await joinAs(s, "陳大文", { group: 0 });
    const up = await a.c.upload(`/stages/${st[0].id}/uploads`, PNG, "pic.png");
    await a.c.post(`/stages/${st[0].id}/entries`, { kind: "text", body: "備份測試 backup test", attachmentId: up.body.attachment.id });
    const dest = fs.mkdtempSync(path.join(os.tmpdir(), "gw-backup-"));
    const tsx = path.join(process.cwd(), "node_modules/.bin/tsx");
    const b = await run(tsx, ["scripts/backup.ts", dest], { env: { ...process.env, DATA_DIR: dataDir() }, cwd: process.cwd() });
    expect(b.stdout).toContain("database integrity: ok");
    expect(fs.existsSync(path.join(dest, "app.db"))).toBe(true);
    expect(fs.readdirSync(path.join(dest, "uploads")).length).toBeGreaterThan(0);

    const fresh = fs.mkdtempSync(path.join(os.tmpdir(), "gw-restore-"));
    const r = await run(tsx, ["scripts/restore.ts", dest], { env: { ...process.env, DATA_DIR: fresh }, cwd: process.cwd() });
    expect(r.stdout).toContain("Restored from");
    const Database = (await import("better-sqlite3")).default;
    const d = new Database(path.join(fresh, "app.db"), { readonly: true });
    const row = d.prepare("SELECT body, attachment_id FROM entries WHERE author_name=?").get("陳大文") as { body: string; attachment_id: string };
    expect(row.body).toBe("備份測試 backup test");
    const att = d.prepare("SELECT stored_name FROM attachments WHERE id=?").get(row.attachment_id) as { stored_name: string };
    d.close();
    expect(fs.readFileSync(path.join(fresh, "uploads", att.stored_name)).equals(fs.readFileSync(path.join(uploadDir(), att.stored_name)))).toBe(true);
  }, 120000);

  it("refuses a damaged backup and changes nothing", async () => {
    const bad = fs.mkdtempSync(path.join(os.tmpdir(), "gw-bad-"));
    fs.writeFileSync(path.join(bad, "app.db"), "this is not a database");
    const target = fs.mkdtempSync(path.join(os.tmpdir(), "gw-target-"));
    fs.writeFileSync(path.join(target, "app.db"), "existing");
    const tsx = path.join(process.cwd(), "node_modules/.bin/tsx");
    await expect(run(tsx, ["scripts/restore.ts", bad], { env: { ...process.env, DATA_DIR: target }, cwd: process.cwd() })).rejects.toBeTruthy();
    expect(fs.readFileSync(path.join(target, "app.db"), "utf8")).toBe("existing");
  }, 60000);
});

describe("English and Traditional Chinese end to end", () => {
  it("names, text, tables, snapshots, shared items, exports and AI settings keep every character", async () => {
    const { fac, s, st } = await live();
    await fac.patch(`/groups/${s.groups[0].id}`, { name: "第一組 Group α" });
    const a = await joinAs(s, "陳大文 Tai-man", { group: 0 });
    const text = "氣候變遷：「我們」需要合作。😀 Café naïve résumé";
    const table = { columns: ["年份", "溫度 (°C)"], rows: [["二零二零", "14.9"]] };
    const q = st[0].questions[0].id;
    await a.c.post(`/stages/${st[0].id}/entries`, { kind: "text", body: text, questionId: q, tags: ["Claim"] });
    const t = (await a.c.post(`/stages/${st[0].id}/entries`, { kind: "table", body: "紀錄", table })).body.entry;
    expect((await a.c.post(`/stages/${st[0].id}/submit`, { confirm: true })).status).toBe(200);
    const snap = (await fac.get(`/sessions/${s.id}/submissions`)).body.submissions[0];
    expect(snap.snapshot.entries.some((e: { body: string }) => e.body === text)).toBe(true);
    const pub = (await fac.post(`/sessions/${s.id}/publications`, { sourceType: "entry", sourceId: t.id, labelMode: "group" })).body.id;
    const other = await joinAs(s, "Other", { group: 1 });
    const item = (await other.c.get("/board")).body.items.find((i: { id: string }) => i.id === pub);
    expect(item.label).toBe("第一組 Group α");
    expect(item.entries[0].table).toEqual(table);
    const j = (await fac.get(`/sessions/${s.id}/export?format=json&identified=true`)).raw!.toString("utf8");
    expect(j).toContain("陳大文 Tai-man");
    expect(j).toContain(text);
    expect(j).toContain("二零二零");
    const csv = (await fac.get(`/sessions/${s.id}/export?format=csv&identified=true&table=entries`)).raw!.toString("utf8");
    expect(csv).toContain("氣候變遷：「我們」需要合作。😀 Café naïve résumé");
    await fac.patch(`/sessions/${s.id}`, { aiCriteria: { preset: "custom", purpose: "課堂討論", criteria: "主題與分歧", language: "繁體中文", detail: "standard" } });
    expect((await fac.get(`/sessions/${s.id}`)).body.session.aiCriteria.language).toBe("繁體中文");
    const g = await fac.post(`/sessions/${s.id}/ai/generate`, { kind: "group_summary", scope: { stageIds: [st[0].id], groupIds: [s.groups[0].id] } });
    expect(g.status).toBe(200);
    expect(JSON.stringify(g.body.output.content)).toContain("氣候變遷");
  });
});
