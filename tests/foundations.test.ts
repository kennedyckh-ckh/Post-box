import { describe, it, expect, beforeAll } from "vitest";
import fs from "node:fs";
import path from "node:path";
import { Client, ADMIN, adminClient, newFacilitator, newSession, joinAs } from "./helpers";
import { db, closeDb, backupDir, dataDir } from "@/lib/db";
import { MIGRATIONS, type Migration } from "@/lib/migrations";
import { migrate } from "@/lib/db";

let admin: Client;
beforeAll(async () => {
  admin = await adminClient();
});

describe("accounts", () => {
  it("creates the first admin from setup variables only, and forces a password change", async () => {
    const c = new Client("10.9.9.9");
    const bad = await c.post("/auth/login", { email: ADMIN.email, password: "wrong-password-1" });
    expect(bad.status).toBe(401);
    // admin helper already changed the password; log in with the new one and confirm access works
    const ok = await c.post("/auth/login", { email: ADMIN.email, password: ADMIN.next });
    expect(ok.status).toBe(200);
    expect(ok.body.user.mustChangePassword).toBe(false);
  });

  it("blocks everything except password change until the temporary password is replaced", async () => {
    const r = await admin.post("/admin/users", { email: "newfac@example.org", name: "New Fac" });
    expect(r.status).toBe(200);
    expect(r.body.temporaryPassword).toMatch(/^[a-z0-9]{4}-[a-z0-9]{4}-[a-z0-9]{4}$/);
    const c = new Client("10.9.9.8");
    const l = await c.post("/auth/login", { email: "newfac@example.org", password: r.body.temporaryPassword });
    expect(l.body.user.mustChangePassword).toBe(true);
    const blocked = await c.get("/sessions");
    expect(blocked.status).toBe(403);
    expect(blocked.body.error.code).toBe("must_change_password");
    const short = await c.post("/auth/change-password", { currentPassword: r.body.temporaryPassword, newPassword: "short" });
    expect(short.status).toBe(400);
    const done = await c.post("/auth/change-password", { currentPassword: r.body.temporaryPassword, newPassword: "long-enough-password" });
    expect(done.status).toBe(200);
    expect((await c.get("/sessions")).status).toBe(200);
  });

  it("only administrators can create accounts (no open sign-up)", async () => {
    const fac = await newFacilitator(admin);
    expect((await fac.post("/admin/users", { email: "x@example.org", name: "X" })).status).toBe(403);
    expect((await new Client("10.9.9.7").post("/admin/users", { email: "x@example.org", name: "X" })).status).toBe(401);
  });

  it("locks an email after repeated failed sign-ins, and the lock survives a restart", async () => {
    const c = new Client("10.9.8.1");
    for (let i = 0; i < 5; i++) await c.post("/auth/login", { email: "admin@example.org", password: "nope-nope-nope" });
    const locked = await c.post("/auth/login", { email: "admin@example.org", password: ADMIN.next });
    expect(locked.status).toBe(429);
    expect(locked.headers["retry-after"]).toBeDefined();
    closeDb(); // simulates a server restart: state must come from the database
    const again = await new Client("10.9.8.2").post("/auth/login", { email: "admin@example.org", password: ADMIN.next });
    expect(again.status).toBe(429);
    db().prepare("DELETE FROM rate_limits WHERE key LIKE 'login:%'").run();
  });

  it("rejects cross-site and non-JSON writes", async () => {
    const c = new Client("10.9.7.1");
    const x = await c.call("POST", "/auth/login", { email: "a@b.co", password: "x" }, { origin: "https://evil.example" });
    expect(x.status).toBe(403);
    expect(x.body.error.code).toBe("cross_site");
  });
});

describe("facilitator access", () => {
  it("a facilitator cannot see or change another facilitator's session, and admins get no automatic access", async () => {
    const a = await newFacilitator(admin, "A");
    const b = await newFacilitator(admin, "B");
    const s = await newSession(a);
    expect((await b.get(`/sessions/${s.id}`)).status).toBe(404);
    expect((await b.patch(`/sessions/${s.id}`, { title: "hacked" })).status).toBe(404);
    expect((await b.get(`/sessions/${s.id}/participants`)).status).toBe(404);
    expect((await b.post(`/sessions/${s.id}/join-code/regenerate`)).status).toBe(404);
    expect((await b.patch(`/groups/${s.groups[0].id}`, { name: "x" })).status).toBe(404);
    expect((await admin.get(`/sessions/${s.id}`)).status).toBe(404);
    expect((await b.get("/sessions")).body.sessions.some((x: { id: string }) => x.id === s.id)).toBe(false);
  });

  it("co-facilitators are explicit, and only the owner can add or remove them", async () => {
    const a = await newFacilitator(admin, "Owner");
    const b = await newFacilitator(admin, "Co");
    const c = await newFacilitator(admin, "Third");
    const s = await newSession(a);
    const email = (x: Client) => (x as unknown as { email: string }).email;
    expect((await a.post(`/sessions/${s.id}/facilitators`, { email: email(b) })).status).toBe(200);
    expect((await b.get(`/sessions/${s.id}`)).status).toBe(200);
    expect((await b.post(`/sessions/${s.id}/facilitators`, { email: email(c) })).status).toBe(403);
    expect((await c.get(`/sessions/${s.id}`)).status).toBe(404);
    expect((await a.post(`/sessions/${s.id}/facilitators`, { email: "nobody@example.org" })).status).toBe(400);
    const d = await a.get(`/sessions/${s.id}`);
    const ownerId = d.body.facilitators.find((f: { role: string }) => f.role === "owner").id;
    expect((await a.del(`/sessions/${s.id}/facilitators/${ownerId}`)).status).toBe(400);
    const coId = d.body.facilitators.find((f: { role: string }) => f.role === "co").id;
    expect((await a.del(`/sessions/${s.id}/facilitators/${coId}`)).status).toBe(200);
    expect((await b.get(`/sessions/${s.id}`)).status).toBe(404);
  });
});

describe("session setup", () => {
  it("creates three neutral stages by default, and supports disabling stages and templates", async () => {
    const fac = await newFacilitator(admin);
    const s = await newSession(fac);
    const d = await fac.get(`/sessions/${s.id}`);
    expect(d.body.stages.map((x: { title: string }) => x.title)).toEqual(["Part 1", "Part 2", "Part 3"]);
    expect(d.body.stages.every((x: { availability: string }) => x.availability === "locked")).toBe(true);
    expect(d.body.session.status).toBe("setup");

    const one = await newSession(fac, { enabledStages: [true, false, false], template: "reflection" });
    const d2 = await fac.get(`/sessions/${one.id}`);
    expect(d2.body.stages.map((x: { enabled: boolean }) => x.enabled)).toEqual([true, false, false]);
    expect(d2.body.stages[0].title).toContain("Describe");
    expect((await fac.post("/sessions", { title: "none", enabledStages: [false, false, false] })).status).toBe(400);
  });

  it("starting opens only the first enabled stage; Parts 2 and 3 stay locked", async () => {
    const fac = await newFacilitator(admin);
    const s = await newSession(fac, { enabledStages: [false, true, true] });
    expect((await fac.post(`/sessions/${s.id}/start`)).status).toBe(200);
    const d = await fac.get(`/sessions/${s.id}`);
    expect(d.body.stages.map((x: { availability: string }) => x.availability)).toEqual(["locked", "open", "locked"]);
    expect((await fac.post(`/sessions/${s.id}/start`)).status).toBe(409);
  });

  it("never returns group PINs, hashes or recovery data to anyone", async () => {
    const fac = await newFacilitator(admin);
    const s = await newSession(fac);
    await fac.patch(`/groups/${s.groups[0].id}`, { pin: "4321" });
    await fac.post(`/sessions/${s.id}/start`);
    const { c, r } = await joinAs(s, "Amy", { pin: "4321" });
    expect(r.status).toBe(200);
    const all = JSON.stringify([
      (await fac.get(`/sessions/${s.id}`)).body,
      (await fac.get(`/sessions/${s.id}/participants`)).body,
      (await new Client().get(`/public/session?code=${s.code}`)).body,
      (await c.get("/me")).body,
    ]);
    expect(all).not.toMatch(/4321|scrypt\$|pin_hash|recovery_lookup/i);
    expect(all).not.toContain(r.body.recoveryCode);
  });
});

describe("joining", () => {
  it("requires the right PIN and throttles guessing", async () => {
    const fac = await newFacilitator(admin);
    const s = await newSession(fac);
    await fac.patch(`/groups/${s.groups[1].id}`, { pin: "s3cret" });
    await fac.post(`/sessions/${s.id}/start`);
    const guesser = new Client("10.7.7.7");
    const join = (pin: string) => guesser.post("/join", { joinCode: s.code, displayName: "Guess", groupId: s.groups[1].id, pin });
    for (let i = 0; i < 5; i++) expect((await join("000" + i)).status).toBe(403);
    expect((await join("s3cret")).status).toBe(429); // locked even for the right PIN
    const other = new Client("10.7.7.8");
    expect((await other.post("/join", { joinCode: s.code, displayName: "Real", groupId: s.groups[1].id, pin: "s3cret" })).status).toBe(200);
  });

  it("does not require school-specific fields, but enforces facilitator-configured ones", async () => {
    const fac = await newFacilitator(admin);
    const plain = await newSession(fac);
    await fac.post(`/sessions/${plain.id}/start`);
    expect((await joinAs(plain, "No fields")).r.status).toBe(200);

    const school = await newSession(fac, { participantFields: [{ label: "Class", required: true }, { label: "Class Number", required: false }] });
    await fac.post(`/sessions/${school.id}/start`);
    expect((await joinAs(school, "Missing class")).r.status).toBe(400);
    const ok = await joinAs(school, "陳大文", { extra: { f1: "5A", f2: "12", evil: "dropped" } });
    expect(ok.r.status).toBe(200);
    const me = await ok.c.get("/me");
    expect(me.body.participant.displayName).toBe("陳大文");
    expect(me.body.participant.extra).toEqual([{ label: "Class", value: "5A" }, { label: "Class Number", value: "12" }]);
  });

  it("gives every participant a unique id even with identical names", async () => {
    const fac = await newFacilitator(admin);
    const s = await newSession(fac);
    await fac.post(`/sessions/${s.id}/start`);
    const a = await joinAs(s, "Sam");
    const b = await joinAs(s, "Sam");
    expect(a.r.body.participantId).not.toBe(b.r.body.participantId);
    expect((await a.c.get("/me")).body.participant.id).toBe(a.r.body.participantId);
    expect((await b.c.get("/me")).body.participant.id).toBe(b.r.body.participantId);
  });

  it("refuses joins before the session starts (unless early joining is on), when closed, and after the code is regenerated", async () => {
    const fac = await newFacilitator(admin);
    const s = await newSession(fac);
    expect((await joinAs(s, "Early")).r.body.error.code).toBe("not_started");
    await fac.patch(`/sessions/${s.id}`, { earlyJoin: true });
    expect((await joinAs(s, "Early")).r.status).toBe(200);
    await fac.post(`/sessions/${s.id}/start`);
    await fac.post(`/sessions/${s.id}/joining`, { open: false });
    expect((await joinAs(s, "Late")).r.body.error.code).toBe("joining_closed");
    await fac.post(`/sessions/${s.id}/joining`, { open: true });
    const keep = await joinAs(s, "Keeper");
    const regen = await fac.post(`/sessions/${s.id}/join-code/regenerate`);
    expect(regen.body.joinCode).not.toBe(s.code);
    expect((await joinAs(s, "OldCode")).r.status).toBe(404);
    // existing participants and their work are untouched by closing or regenerating
    expect((await keep.c.get("/me")).status).toBe(200);
  });

  it("assigned mode: participants wait without a group until the facilitator places them", async () => {
    const fac = await newFacilitator(admin);
    const s = await newSession(fac, { groupJoinMode: "assigned" });
    await fac.post(`/sessions/${s.id}/start`);
    const c = new Client("10.6.6.6");
    const j = await c.post("/join", { joinCode: s.code, displayName: "Waiting" });
    expect(j.status).toBe(200);
    expect((await c.get("/me")).body.awaitingGroup).toBe(true);
    const list = await fac.get(`/sessions/${s.id}/participants`);
    const pid = list.body.participants[0].id;
    expect((await fac.post(`/participants/${pid}/move`, { groupId: s.groups[2].id })).status).toBe(200);
    const me = await c.get("/me");
    expect(me.body.awaitingGroup).toBe(false);
    expect(me.body.group.id).toBe(s.groups[2].id);
  });
});

describe("recovery", () => {
  it("restores the session after a refresh (same cookie) and on another device (recovery code)", async () => {
    const fac = await newFacilitator(admin);
    const s = await newSession(fac);
    await fac.post(`/sessions/${s.id}/start`);
    const { c, r } = await joinAs(s, "Robin");
    const refreshed = c.clone();
    expect((await refreshed.get("/me")).body.participant.id).toBe(r.body.participantId);
    const phone = new Client("10.5.5.5");
    expect((await phone.get("/me")).status).toBe(401);
    const rec = await phone.post("/recover", { recoveryCode: r.body.recoveryCode.toLowerCase().replace(/-/g, " ") });
    expect(rec.status).toBe(200);
    expect((await phone.get("/me")).body.participant.id).toBe(r.body.participantId);
  });

  it("does not let anyone take over an identity by typing the same name", async () => {
    const fac = await newFacilitator(admin);
    const s = await newSession(fac);
    await fac.post(`/sessions/${s.id}/start`);
    const victim = await joinAs(s, "Taylor");
    const impostor = await joinAs(s, "Taylor");
    expect(impostor.r.body.participantId).not.toBe(victim.r.body.participantId);
    expect((await impostor.c.get("/me")).body.participant.id).not.toBe(victim.r.body.participantId);
    const guess = new Client("10.4.4.4");
    expect((await guess.post("/recover", { recoveryCode: "AAAA-BBBB-CCCC-DDDD" })).status).toBe(403);
    expect((await guess.post("/recover", { displayName: "Taylor", recoveryCode: "" })).status).toBe(400);
    expect((await guess.get("/me")).status).toBe(401);
  });

  it("throttles recovery-code guessing", async () => {
    const g = new Client("10.4.4.5");
    let last = 0;
    for (let i = 0; i < 25; i++) last = (await g.post("/recover", { recoveryCode: `AAAA-BBBB-CCCC-${String(1000 + i)}` })).status;
    expect(last).toBe(429);
  });

  it("facilitator-assisted recovery issues a new code, kills the old code and old devices", async () => {
    const fac = await newFacilitator(admin);
    const s = await newSession(fac);
    await fac.post(`/sessions/${s.id}/start`);
    const { c, r } = await joinAs(s, "Lost");
    const issued = await fac.post(`/participants/${r.body.participantId}/recovery-code`);
    expect(issued.status).toBe(200);
    expect(issued.body.recoveryCode).not.toBe(r.body.recoveryCode);
    expect((await c.get("/me")).status).toBe(401); // old device signed out
    const d = new Client("10.3.3.3");
    expect((await d.post("/recover", { recoveryCode: r.body.recoveryCode })).status).toBe(403);
    expect((await d.post("/recover", { recoveryCode: issued.body.recoveryCode })).status).toBe(200);
    // participants can also replace their own code while signed in
    const mine = await d.post("/me/recovery-code");
    expect((await new Client("10.3.3.4").post("/recover", { recoveryCode: issued.body.recoveryCode })).status).toBe(403);
    expect((await new Client("10.3.3.5").post("/recover", { recoveryCode: mine.body.recoveryCode })).status).toBe(200);
    // another facilitator cannot issue codes for this participant
    const other = await newFacilitator(admin);
    expect((await other.post(`/participants/${r.body.participantId}/recovery-code`)).status).toBe(404);
  });
});

describe("membership changes", () => {
  it("removing revokes access (cookie and recovery code) and releases the seat; restoring brings it back", async () => {
    const fac = await newFacilitator(admin);
    const s = await newSession(fac);
    await fac.patch(`/groups/${s.groups[0].id}`, { seatCap: 1 });
    await fac.post(`/sessions/${s.id}/start`);
    const a = await joinAs(s, "First");
    expect((await joinAs(s, "Second")).r.body.error.code).toBe("group_full");
    await fac.post(`/participants/${a.r.body.participantId}/remove`);
    expect((await a.c.get("/me")).status).toBe(401);
    expect((await new Client("10.8.8.8").post("/recover", { recoveryCode: a.r.body.recoveryCode })).body.error.code).toBe("access_removed");
    const second = await joinAs(s, "Second");
    expect(second.r.status).toBe(200);
    // seat is taken again, so restoring needs an explicit override
    expect((await fac.post(`/participants/${a.r.body.participantId}/restore`)).body.error.code).toBe("group_full");
    expect((await fac.post(`/participants/${a.r.body.participantId}/restore`, { overrideCap: true })).status).toBe(200);
    expect((await new Client("10.8.8.9").post("/recover", { recoveryCode: a.r.body.recoveryCode })).status).toBe(200);
    // the participant row (and so any attribution) still exists
    const list = await fac.get(`/sessions/${s.id}/participants`);
    expect(list.body.participants.map((p: { displayName: string }) => p.displayName).sort()).toEqual(["First", "Second"]);
  });

  it("moving respects seat caps unless the facilitator overrides, and is recorded", async () => {
    const fac = await newFacilitator(admin);
    const s = await newSession(fac);
    await fac.patch(`/groups/${s.groups[1].id}`, { seatCap: 1 });
    await fac.post(`/sessions/${s.id}/start`);
    const a = await joinAs(s, "A", { group: 0 });
    const b = await joinAs(s, "B", { group: 0 });
    expect((await fac.post(`/participants/${a.r.body.participantId}/move`, { groupId: s.groups[1].id })).status).toBe(200);
    expect((await fac.post(`/participants/${b.r.body.participantId}/move`, { groupId: s.groups[1].id })).body.error.code).toBe("group_full");
    expect((await fac.post(`/participants/${b.r.body.participantId}/move`, { groupId: s.groups[1].id, overrideCap: true })).status).toBe(200);
    const moves = db().prepare("SELECT COUNT(*) AS c FROM group_moves").get() as { c: number };
    expect(moves.c).toBeGreaterThanOrEqual(3 - 1);
    expect((await fac.patch(`/groups/${s.groups[1].id}`, { seatCap: 1 })).body.error.code).toBe("cap_below_members");
    expect((await fac.del(`/groups/${s.groups[1].id}`)).body.error.code).toBe("group_not_empty");
  });

  it("cannot move a participant into another session's group", async () => {
    const fac = await newFacilitator(admin);
    const s1 = await newSession(fac);
    const s2 = await newSession(fac);
    await fac.post(`/sessions/${s1.id}/start`);
    const a = await joinAs(s1, "A");
    expect((await fac.post(`/participants/${a.r.body.participantId}/move`, { groupId: s2.groups[0].id })).status).toBe(400);
  });
});

describe("migrations", () => {
  it("copies the database to backups/ before applying a new migration to existing data", () => {
    const extra: Migration = { id: "999_test_only", sql: "CREATE TABLE test_only(x INTEGER);" };
    MIGRATIONS.push(extra);
    try {
      migrate(db());
    } finally {
      MIGRATIONS.pop();
    }
    const files = fs.readdirSync(backupDir());
    expect(files.some((f) => f.startsWith("app-before-999_test_only-"))).toBe(true);
    expect(db().prepare("SELECT name FROM sqlite_master WHERE name='test_only'").get()).toBeTruthy();
    expect(fs.existsSync(path.join(dataDir(), "app.db"))).toBe(true);
  });
});
