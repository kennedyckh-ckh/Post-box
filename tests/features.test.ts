import { describe, it, expect, beforeAll } from "vitest";
import { Client, adminClient, newFacilitator, newSession, joinAs } from "./helpers";

let admin: Client;
beforeAll(async () => { admin = await adminClient(); });

async function liveSession() {
  const fac = await newFacilitator(admin);
  const s = await newSession(fac);
  await fac.post(`/sessions/${s.id}/start`);
  return { fac, s };
}

describe("recovery code is looked up later, not shown at joining", () => {
  it("does not return the code when joining; the signed-in participant can view it any time and it works", async () => {
    const { s } = await liveSession();
    const c = new Client("10.60.0.1");
    const j = await c.post("/join", { joinCode: s.code, displayName: "Kit", groupId: s.groups[0].id });
    expect(j.status).toBe(200);
    expect(j.body.recoveryCode).toBeUndefined();
    const v1 = await c.get("/me/recovery-code");
    expect(v1.status).toBe(200);
    expect(v1.body.recoveryCode).toMatch(/^[A-Z2-9]{4}-[A-Z2-9]{4}-[A-Z2-9]{4}-[A-Z2-9]{4}$/);
    expect((await c.get("/me/recovery-code")).body.recoveryCode).toBe(v1.body.recoveryCode); // same code each time
    const phone = new Client("10.60.0.2");
    expect((await phone.post("/recover", { recoveryCode: v1.body.recoveryCode })).status).toBe(200);
    expect((await phone.get("/me/recovery-code")).body.recoveryCode).toBe(v1.body.recoveryCode);
  });

  it("only the participant's own signed-in device can view it, and replacing it shows the new code", async () => {
    const { fac, s } = await liveSession();
    const a = await joinAs(s, "Lee");
    expect((await new Client("10.60.1.1").get("/me/recovery-code")).status).toBe(401);
    expect((await fac.get("/me/recovery-code")).status).toBe(401);
    const old = a.r.body.recoveryCode;
    const repl = await a.c.post("/me/recovery-code");
    expect(repl.body.recoveryCode).not.toBe(old);
    expect((await a.c.get("/me/recovery-code")).body.recoveryCode).toBe(repl.body.recoveryCode);
    // facilitator-issued code also becomes the one the participant sees after signing in with it
    const issued = await fac.post(`/participants/${a.r.body.participantId}/recovery-code`);
    const d = new Client("10.60.1.2");
    expect((await d.post("/recover", { recoveryCode: issued.body.recoveryCode })).status).toBe(200);
    expect((await d.get("/me/recovery-code")).body.recoveryCode).toBe(issued.body.recoveryCode);
  });

  it("stores the code encrypted, never in plain text, and never in facilitator data", async () => {
    const { fac, s } = await liveSession();
    const a = await joinAs(s, "Mo");
    const code = a.r.body.recoveryCode as string;
    const { db } = await import("@/lib/db");
    const row = db().prepare("SELECT * FROM participants WHERE id=?").get(a.r.body.participantId) as Record<string, string>;
    expect(row.recovery_enc).toMatch(/^gcm1\$/);
    expect(JSON.stringify(row)).not.toContain(code);
    const dump = JSON.stringify([(await fac.get(`/sessions/${s.id}/participants`)).body, (await fac.get(`/sessions/${s.id}/export?format=json&identified=true`)).body, (await fac.get(`/sessions/${s.id}/projector`)).body]);
    expect(dump).not.toContain(code);
    expect(dump).not.toMatch(/recovery_enc|gcm1\$/);
  });
});

describe("facilitator controls how many questions participants see, revealed on click", () => {
  it("hides questions until revealed, one at a time or all, and enforces it on the server", async () => {
    const { fac, s } = await liveSession();
    const stage = s.stages[0].id;
    const before = (await fac.get(`/sessions/${s.id}/stages`)).body.stages[0].questions.length;
    const ids: string[] = [];
    for (const t of ["Q-one", "Q-two", "Q-three"]) ids.push((await fac.post(`/stages/${stage}/questions`, { text: t, visible: false, required: t === "Q-one" })).body.id);
    const p = await joinAs(s, "Pat");
    const seen = async () => (await p.c.get(`/stages/${stage}`)).body.questions.map((q: { text: string }) => q.text).filter((t: string) => t.startsWith("Q-"));
    expect(await seen()).toEqual([]);
    // hidden questions cannot be answered and do not block submission
    expect((await p.c.post(`/stages/${stage}/entries`, { kind: "text", body: "x", questionId: ids[0] })).status).toBe(400);
    const e1 = await p.c.get(`/stages/${stage}/entries`);
    let r = await fac.post(`/stages/${stage}/questions/reveal`, { mode: "next" });
    expect(r.body.changed).toBe(1);
    expect(await seen()).toEqual(["Q-one"]);
    // the participant page's poll notices the newly revealed question
    expect((await p.c.get(`/stages/${stage}/entries?etag=${e1.body.etag}`)).body.unchanged).toBeUndefined();
    expect((await p.c.post(`/stages/${stage}/entries`, { kind: "text", body: "answer", questionId: ids[0] })).status).toBe(200);
    await fac.patch(`/questions/${ids[2]}`, { visible: true });
    expect(await seen()).toEqual(["Q-one", "Q-three"]);
    r = await fac.post(`/stages/${stage}/questions/reveal`, { mode: "all" });
    expect(await seen()).toEqual(["Q-one", "Q-two", "Q-three"]);
    expect(r.body.visibleCount).toBe(before + 3);
    r = await fac.post(`/stages/${stage}/questions/reveal`, { mode: "none" });
    expect(r.body.visibleCount).toBe(0);
    expect(await seen()).toEqual([]);
    // an entry already linked to a now-hidden question can still be edited
    const list = (await p.c.get(`/stages/${stage}/entries`)).body.entries;
    const mine = list.find((x: { body: string }) => x.body === "answer");
    expect((await p.c.patch(`/entries/${mine.id}`, { kind: "text", body: "answer 2", questionId: ids[0], baseVersion: mine.version })).status).toBe(200);
    // facilitator list shows each question's visibility
    const fq = (await fac.get(`/sessions/${s.id}/stages`)).body.stages[0].questions;
    expect(fq.every((q: { visible: boolean }) => q.visible === false)).toBe(true);
    expect((await p.c.post(`/stages/${stage}/questions/reveal`, { mode: "all" })).status).toBe(401);
  });

  it("required questions that are still hidden do not block submission", async () => {
    const { fac, s } = await liveSession();
    const stage = s.stages[0].id;
    for (const q of (await fac.get(`/sessions/${s.id}/stages`)).body.stages[0].questions) await fac.del(`/questions/${q.id}`);
    await fac.post(`/stages/${stage}/questions`, { text: "Hidden required", visible: false, required: true });
    const p = await joinAs(s, "Sky");
    await p.c.post(`/stages/${stage}/entries`, { kind: "text", body: "work" });
    const sub = await p.c.post(`/stages/${stage}/submit`, { confirm: true });
    expect(sub.status).toBe(200);
  });
});

describe("facilitator projector view", () => {
  it("shows join code, parts with revealed questions only, progress and approved items, to facilitators only", async () => {
    const { fac, s } = await liveSession();
    const stage = s.stages[0].id;
    await fac.post(`/stages/${stage}/questions`, { text: "Secret until revealed", visible: false });
    const p = await joinAs(s, "Ash");
    const entry = (await p.c.post(`/stages/${stage}/entries`, { kind: "text", body: "Projector-worthy idea" })).body;
    let v = await fac.get(`/sessions/${s.id}/projector`);
    expect(v.status).toBe(200);
    expect(v.body.joinCode).toBe(s.code);
    expect(v.body.participants).toBe(1);
    expect(JSON.stringify(v.body)).not.toContain("Secret until revealed");
    expect(v.body.stages[0].hiddenQuestions).toBe(1);
    expect(v.body.stages[0].perGroup[0].entries).toBe(1);
    expect(v.body.items).toEqual([]);
    const pub = await fac.post(`/sessions/${s.id}/publications`, { sourceType: "entry", sourceId: entry.id ?? entry.entry?.id, labelMode: "anonymous" });
    expect(pub.status).toBe(200);
    await fac.post(`/publications/${pub.body.id}/present`, { present: true });
    await fac.post(`/stages/${stage}/questions/reveal`, { mode: "all" });
    v = await fac.get(`/sessions/${s.id}/projector`);
    expect(v.body.items.length).toBe(1);
    expect(JSON.stringify(v.body)).toContain("Projector-worthy idea");
    expect(JSON.stringify(v.body)).not.toContain("Ash");
    expect(v.body.stages[0].questions.map((q: { text: string }) => q.text)).toContain("Secret until revealed");
    expect((await p.c.get(`/sessions/${s.id}/projector`)).status).toBe(401);
    const other = await newFacilitator(admin);
    expect((await other.get(`/sessions/${s.id}/projector`)).status).toBe(404);
  });
});
