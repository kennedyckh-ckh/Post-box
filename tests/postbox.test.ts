import { describe, it, expect, beforeAll } from "vitest";
import { Client, adminClient, newFacilitator, newSession, joinAs } from "./helpers";

let admin: Client;
beforeAll(async () => { admin = await adminClient(); });

type Q = { id: string; heading: string; text: string; options: string[]; parentId: string | null };

describe("Post-box template and choice questions", () => {
  it("creates a Post-box session: Agree / Disagree statements, station reflections and an open part", async () => {
    const fac = await newFacilitator(admin);
    const t = (await fac.get("/templates")).body.templates.find((x: { key: string }) => x.key === "post_box");
    expect(t.label).toBe("Post-box");
    const s = await newSession(fac, { template: "post_box" });
    const st = (await fac.get(`/sessions/${s.id}/stages`)).body.stages;
    expect(st.map((x: { title: string }) => x.title)).toEqual(["Part 1: Post-box statements", "Part 2: Station reflections", "Part 3: Open reflection"]);
    expect(st[0].questions).toHaveLength(4);
    expect(st[0].questions.every((q: Q) => q.options.join("|") === "Agree|Disagree")).toBe(true);
    expect(st[0].questions[0].heading).toBe("Statement 1");
    expect(st[1].questions.map((q: Q) => q.heading)).toEqual(["Station 1", "Station 2", "Station 3", "Station 4"]);
    expect(st[1].questions.every((q: Q) => q.options.length === 0)).toBe(true);
    expect(st[2].questions).toHaveLength(0);
    expect(st[0].tallies).toHaveLength(4);
    // duplicating keeps the response options
    const dup = (await fac.post(`/sessions/${s.id}/duplicate`, { title: "Copy" })).body;
    expect(dup.id).toBeTruthy();
    const ds = (await fac.get(`/sessions/${dup.id}/stages`)).body.stages;
    expect(ds[0].questions[0].options).toEqual(["Agree", "Disagree"]);
  });

  it("requires a choice, allows one answer per person per statement, and counts people for the class results", async () => {
    const fac = await newFacilitator(admin);
    const s = await newSession(fac, { template: "post_box", groupCount: 2 });
    await fac.post(`/sessions/${s.id}/start`);
    const stage = s.stages[0].id;
    const qs: Q[] = (await fac.get(`/sessions/${s.id}/stages`)).body.stages[0].questions;
    const q1 = qs[0].id;
    const a = await joinAs(s, "Ann", { group: 0 });
    const b = await joinAs(s, "Ben", { group: 0 });
    const c = await joinAs(s, "Cat", { group: 1 });
    // participants see the options
    expect((await a.c.get(`/stages/${stage}`)).body.questions[0].options).toEqual(["Agree", "Disagree"]);
    // no choice, or a choice that is not an option, is refused
    expect((await a.c.post(`/stages/${stage}/entries`, { kind: "text", body: "Because", questionId: q1 })).status).toBe(400);
    expect((await a.c.post(`/stages/${stage}/entries`, { kind: "text", body: "Because", questionId: q1, choice: "Maybe" })).status).toBe(400);
    const ea = await a.c.post(`/stages/${stage}/entries`, { kind: "text", body: "Evidence from class", questionId: q1, choice: "Agree" });
    expect(ea.status).toBe(200);
    expect(ea.body.entry.choice).toBe("Agree");
    // a second answer to the same statement is refused; editing the first one is how to change your mind
    const dupe = await a.c.post(`/stages/${stage}/entries`, { kind: "text", body: "Again", questionId: q1, choice: "Disagree" });
    expect(dupe.status).toBe(409);
    expect(dupe.body.error.code).toBe("already_answered");
    await b.c.post(`/stages/${stage}/entries`, { kind: "text", body: "Not always", questionId: q1, choice: "Disagree" });
    await c.c.post(`/stages/${stage}/entries`, { kind: "text", body: "Seen it", questionId: q1, choice: "Agree" });
    // an open entry in the same part has no choice and is not counted
    const open = await c.c.post(`/stages/${stage}/entries`, { kind: "text", body: "General note" });
    expect(open.status).toBe(200);
    expect(open.body.entry.choice).toBeNull();

    let t = (await fac.get(`/sessions/${s.id}/stages`)).body.stages[0].tallies.find((x: { questionId: string }) => x.questionId === q1);
    expect(t.options).toEqual([{ label: "Agree", count: 2 }, { label: "Disagree", count: 1 }]);
    expect(t.total).toBe(3);
    expect(t.byGroup.find((g: { groupId: string }) => g.groupId === s.groups[0].id).counts).toEqual({ Agree: 1, Disagree: 1 });

    // Ann changes her mind
    const ch = await a.c.patch(`/entries/${ea.body.entry.id}`, { kind: "text", body: "Changed after discussion", questionId: q1, choice: "Disagree", baseVersion: 1 });
    expect(ch.status).toBe(200);
    t = (await fac.get(`/sessions/${s.id}/stages`)).body.stages[0].tallies.find((x: { questionId: string }) => x.questionId === q1);
    expect(t.options).toEqual([{ label: "Agree", count: 1 }, { label: "Disagree", count: 2 }]);

    // the projector receives the counts for revealed statements only, with no names or reasons
    const proj = (await fac.get(`/sessions/${s.id}/projector`)).body;
    const pt = proj.stages[0].tallies.find((x: { questionId: string }) => x.questionId === q1);
    expect(pt.total).toBe(3);
    expect(JSON.stringify(proj.stages[0].tallies)).not.toMatch(/Ann|Ben|Cat|Changed after/);
    await fac.patch(`/questions/${qs[3].id}`, { visible: false });
    const proj2 = (await fac.get(`/sessions/${s.id}/projector`)).body;
    expect(proj2.stages[0].tallies.map((x: { questionId: string }) => x.questionId)).not.toContain(qs[3].id);

    // a hidden entry is not counted
    await fac.post(`/entries/${ea.body.entry.id}/hide`, { hidden: true });
    t = (await fac.get(`/sessions/${s.id}/stages`)).body.stages[0].tallies.find((x: { questionId: string }) => x.questionId === q1);
    expect(t.total).toBe(2);
    await fac.post(`/entries/${ea.body.entry.id}/hide`, { hidden: false });

    // renaming options keeps earlier answers, counted as "other" until people choose again
    expect((await fac.patch(`/questions/${q1}`, { options: ["Agree", "Not sure", "Disagree"] })).status).toBe(200);
    expect((await fac.patch(`/questions/${q1}`, { options: ["Yes", "Yes"] })).status).toBe(400);
    expect((await fac.patch(`/questions/${q1}`, { options: ["Only one"] })).status).toBe(400);
    await fac.patch(`/questions/${q1}`, { options: ["Strongly agree", "Disagree"] });
    t = (await fac.get(`/sessions/${s.id}/stages`)).body.stages[0].tallies.find((x: { questionId: string }) => x.questionId === q1);
    expect(t.options).toEqual([{ label: "Strongly agree", count: 0 }, { label: "Disagree", count: 2 }]);
    expect(t.other).toBe(1);
    expect(t.total).toBe(3);

    // switching a station question to custom options works the same way
    const station = (await fac.get(`/sessions/${s.id}/stages`)).body.stages[1].questions[0].id;
    expect((await fac.patch(`/questions/${station}`, { options: ["Confirmed my thinking", "Changed my thinking"] })).status).toBe(200);
    // and back to an open answer
    expect((await fac.patch(`/questions/${station}`, { options: [] })).status).toBe(200);
    expect((await fac.get(`/sessions/${s.id}/stages`)).body.stages[1].questions[0].options).toEqual([]);

    // the choice is kept in the submitted snapshot and in the export
    for (const q of [qs[1], qs[2]]) expect((await c.c.post(`/stages/${stage}/entries`, { kind: "text", body: "Reason", questionId: q.id, choice: "Agree" })).status).toBe(200);
    const sub = await c.c.post(`/stages/${stage}/submit`, { confirm: true });
    expect(sub.status).toBe(200);
    const subs = (await fac.get(`/sessions/${s.id}/submissions`)).body;
    expect(JSON.stringify(subs)).toContain('"choice":"Agree"');
    const exp = await fac.get(`/sessions/${s.id}/export?format=json`);
    const data = JSON.parse(exp.raw!.toString("utf8"));
    expect(data.participantContent.entries.find((e: { entryId: string }) => e.entryId === ea.body.entry.id).choice).toBe("Disagree");
  });

  it("lets a facilitator add a new choice question with custom options", async () => {
    const fac = await newFacilitator(admin);
    const s = await newSession(fac);
    const r = await fac.post(`/stages/${s.stages[0].id}/questions`, { text: "Plants need light to grow.", heading: "Statement A", options: ["True", "False", "Not sure"] });
    expect(r.status).toBe(200);
    const q = (await fac.get(`/sessions/${s.id}/stages`)).body.stages[0].questions.find((x: Q) => x.id === r.body.id);
    expect(q.options).toEqual(["True", "False", "Not sure"]);
  });
});
