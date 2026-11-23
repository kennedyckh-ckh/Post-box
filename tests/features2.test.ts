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

describe("optional sub-questions", () => {
  it("adds sub-questions under a main question, shown only with it, answerable, and removed with it", async () => {
    const { fac, s } = await liveSession();
    const stage = s.stages[0].id;
    for (const q of (await fac.get(`/sessions/${s.id}/stages`)).body.stages[0].questions) await fac.del(`/questions/${q.id}`);
    const main = (await fac.post(`/stages/${stage}/questions`, { text: "Main", visible: false })).body.id;
    const other = (await fac.post(`/stages/${stage}/questions`, { text: "Other", visible: true })).body.id;
    const a = (await fac.post(`/stages/${stage}/questions`, { text: "Sub a", parentId: main, required: true })).body.id;
    await fac.post(`/stages/${stage}/questions`, { text: "Sub b", parentId: main });
    // one level only, same part only
    expect((await fac.post(`/stages/${stage}/questions`, { text: "Deep", parentId: a })).status).toBe(400);
    expect((await fac.post(`/stages/${s.stages[1].id}/questions`, { text: "Wrong part", parentId: main })).status).toBe(400);
    // sub-question visibility follows the main question
    expect((await fac.patch(`/questions/${a}`, { visible: false })).status).toBe(400);
    const fq = (await fac.get(`/sessions/${s.id}/stages`)).body.stages[0].questions;
    expect(fq.map((q: { text: string }) => q.text)).toEqual(["Main", "Sub a", "Sub b", "Other"]);
    expect(fq.find((q: { id: string }) => q.id === a).parentId).toBe(main);
    const p = await joinAs(s, "Ivy");
    let seen = (await p.c.get(`/stages/${stage}`)).body;
    expect(seen.questions.map((q: { text: string }) => q.text)).toEqual(["Other"]);
    expect(seen.hiddenQuestions).toBe(1);
    expect((await p.c.post(`/stages/${stage}/entries`, { kind: "text", body: "x", questionId: a })).status).toBe(400);
    // hidden required sub-question does not block submission checks
    expect((await p.c.get(`/stages/${stage}/submission`)).body.missingRequired ?? []).not.toContainEqual(expect.objectContaining({ questionId: a }));
    const r = await fac.post(`/stages/${stage}/questions/reveal`, { mode: "next" });
    expect(r.body).toMatchObject({ changed: 1, visibleCount: 2, total: 2 });
    seen = (await p.c.get(`/stages/${stage}`)).body;
    expect(seen.questions.map((q: { text: string; parentId: string | null }) => [q.text, q.parentId])).toEqual([["Main", null], ["Sub a", main], ["Sub b", main], ["Other", null]]);
    expect((await p.c.post(`/stages/${stage}/entries`, { kind: "text", body: "answer a", questionId: a })).status).toBe(200);
    // projector feed carries sub-questions with their parent
    const pj = (await fac.get(`/sessions/${s.id}/projector`)).body.stages[0].questions;
    expect(pj.filter((q: { parentId: string | null }) => q.parentId === main).length).toBe(2);
    // removing the main question removes its sub-questions
    await fac.del(`/questions/${main}`);
    seen = (await p.c.get(`/stages/${stage}`)).body;
    expect(seen.questions.map((q: { text: string }) => q.text)).toEqual(["Other"]);
    expect(other).toBeTruthy();
  });

  it("a duplicated session keeps sub-questions under their copied main question", async () => {
    const { fac, s } = await liveSession();
    const stage = s.stages[0].id;
    const main = (await fac.post(`/stages/${stage}/questions`, { text: "Dup main" })).body.id;
    await fac.post(`/stages/${stage}/questions`, { text: "Dup sub", parentId: main });
    const copy = (await fac.post(`/sessions/${s.id}/duplicate`)).body.id;
    const qs = (await fac.get(`/sessions/${copy}/stages`)).body.stages[0].questions;
    const m = qs.find((q: { text: string }) => q.text === "Dup main");
    const sub = qs.find((q: { text: string }) => q.text === "Dup sub");
    expect(m.id).not.toBe(main);
    expect(sub.parentId).toBe(m.id);
  });
});

describe("reaction icons", () => {
  it("gives every reaction type an icon (inferred for older settings) and lets the facilitator choose one", async () => {
    const { fac, s } = await liveSession();
    let types = (await fac.get(`/sessions/${s.id}`)).body.session.reactionConfig.types;
    expect(types.map((t: { icon: string }) => t.icon)).toEqual(["star", "heart", "thumbs"]);
    const save = await fac.patch(`/sessions/${s.id}`, { reactionConfig: { enabled: true, scope: "both", types: [{ label: "Love it", icon: "heart" }, { label: "Agree" }, { label: "Big idea", icon: "idea" }] } });
    expect(save.status).toBe(200);
    types = (await fac.get(`/sessions/${s.id}`)).body.session.reactionConfig.types;
    expect(types.map((t: { icon: string }) => t.icon)).toEqual(["heart", "check", "idea"]);
    expect((await fac.patch(`/sessions/${s.id}`, { reactionConfig: { enabled: true, scope: "both", types: [{ label: "X", icon: "<script>" }] } })).status).toBe(400);
    const p = await joinAs(s, "Rae");
    const list = (await p.c.get(`/stages/${s.stages[0].id}/entries`)).body;
    expect(list.engagement.reactions.types[0]).toMatchObject({ label: "Love it", icon: "heart" });
  });
});

describe("session timer", () => {
  it("lets facilitators start, pause, resume, extend and reset; participants and the projector see it", async () => {
    const { fac, s } = await liveSession();
    const p = await joinAs(s, "Tim");
    expect((await p.c.get("/me/timer")).body.timer.state).toBe("idle");
    let r = await fac.post(`/sessions/${s.id}/timer`, { action: "start", seconds: 300, label: "Discuss" });
    expect(r.status).toBe(200);
    expect(r.body.timer).toMatchObject({ state: "running", label: "Discuss", durationMs: 300000 });
    const me = (await p.c.get("/me/timer")).body.timer;
    expect(me.state).toBe("running");
    expect(me.remainingMs).toBeGreaterThan(295000);
    expect((await fac.get(`/sessions/${s.id}/projector`)).body.timer.state).toBe("running");
    r = await fac.post(`/sessions/${s.id}/timer`, { action: "pause" });
    expect(r.body.timer.state).toBe("paused");
    const paused = r.body.timer.remainingMs;
    await new Promise((res) => setTimeout(res, 50));
    expect((await p.c.get("/me/timer")).body.timer.remainingMs).toBe(paused);
    r = await fac.post(`/sessions/${s.id}/timer`, { action: "add", seconds: 60 });
    expect(r.body.timer.remainingMs).toBe(paused + 60000);
    expect(r.body.timer.state).toBe("paused");
    r = await fac.post(`/sessions/${s.id}/timer`, { action: "resume" });
    expect(r.body.timer.state).toBe("running");
    expect((await fac.post(`/sessions/${s.id}/timer`, { action: "resume" })).status).toBe(409);
    expect((await fac.post(`/sessions/${s.id}/timer`, { action: "start", seconds: 1 })).status).toBe(400);
    expect((await p.c.post(`/sessions/${s.id}/timer`, { action: "reset" })).status).toBe(401);
    const other = await newFacilitator(admin);
    expect((await other.post(`/sessions/${s.id}/timer`, { action: "reset" })).status).toBe(404);
    r = await fac.post(`/sessions/${s.id}/timer`, { action: "reset" });
    expect(r.body.timer.state).toBe("idle");
    expect((await p.c.get("/me/timer")).body.timer.state).toBe("idle");
  });

  it("reports finished once the time has run out", async () => {
    const { fac, s } = await liveSession();
    await fac.post(`/sessions/${s.id}/timer`, { action: "start", seconds: 5 });
    const { db } = await import("@/lib/db");
    db().prepare("UPDATE session_timers SET ends_at=? WHERE session_id=?").run(Date.now() - 1000, s.id);
    const t = (await fac.get(`/sessions/${s.id}/timer`)).body.timer;
    expect(t).toMatchObject({ state: "finished", remainingMs: 0 });
    expect((await fac.post(`/sessions/${s.id}/timer`, { action: "add", seconds: 60 })).body.timer.state).toBe("running");
  });
});
