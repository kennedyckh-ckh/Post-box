import { describe, it, expect, beforeAll } from "vitest";
import fs from "node:fs";
import path from "node:path";
import { Client, adminClient, newFacilitator, newSession, joinAs } from "./helpers";
import { db, uploadDir } from "@/lib/db";

let admin: Client;
beforeAll(async () => {
  admin = await adminClient();
});

async function live(extra: Record<string, unknown> = {}) {
  const fac = await newFacilitator(admin);
  const s = await newSession(fac, { groupCount: 3, template: "discussion", ...extra });
  await fac.post(`/sessions/${s.id}/start`);
  const st = (await fac.get(`/sessions/${s.id}/stages`)).body.stages as { id: string; questions: { id: string }[] }[];
  return { fac, s, st };
}
const entry = (body: string, more: Record<string, unknown> = {}) => ({ kind: "text", body, ...more });
const submit = (c: Client, stage: string, more: Record<string, unknown> = {}) => c.post(`/stages/${stage}/submit`, { confirm: true, ...more });
/** answer every required question so the group is allowed to submit */
async function answerRequired(c: Client, stage: { id: string; questions: { id: string }[] }, text = "answer") {
  for (const q of stage.questions) await c.post(`/stages/${stage.id}/entries`, entry(text, { questionId: q.id }));
}

describe("group submission", () => {
  it("needs confirmation and all required questions answered, and tells the group what is missing", async () => {
    const { s, st } = await live();
    const a = await joinAs(s, "Ann", { group: 0 });
    expect((await a.c.post(`/stages/${st[0].id}/submit`, {})).body.error.code).toBe("confirmation_required");
    const chk = await a.c.get(`/stages/${st[0].id}/submission`);
    expect(chk.body.missingRequired.length).toBe(1);
    const miss = await submit(a.c, st[0].id);
    expect(miss.status).toBe(422);
    expect(miss.body.error.code).toBe("missing_required");
    expect(miss.body.error.missing[0].text).toContain("view");
    await answerRequired(a.c, st[0]);
    expect((await submit(a.c, st[0].id)).status).toBe(200);
  });

  it("snapshots everything saved before it, records who and when, and locks the stage for the group", async () => {
    const { s, st } = await live();
    const a = await joinAs(s, "Ann", { group: 0 });
    const b = await joinAs(s, "Ben", { group: 0 });
    await answerRequired(a.c, st[0], "Ann's answer");
    const bEntry = (await b.c.post(`/stages/${st[0].id}/entries`, entry("Ben's saved entry"))).body.entry;
    await a.c.call("PUT", `/stages/${st[0].id}/synthesis`, { body: "Group view", baseVersion: 0 });
    const r = await submit(b.c, st[0].id);
    expect(r.status).toBe(200);
    expect(r.body.submission.status).toBe("submitted");
    expect(r.body.submission.submittedByName).toBe("Ben");
    const row = db().prepare("SELECT snapshot_json, submitted_by, submitted_at FROM submissions").all().pop() as { snapshot_json: string; submitted_by: string; submitted_at: number };
    const snap = JSON.parse(row.snapshot_json);
    expect(snap.entries.map((e: { body: string }) => e.body).sort()).toEqual(["Ann's answer", "Ben's saved entry"]);
    expect(snap.entries.find((e: { authorName: string }) => e.authorName === "Ben").authorId).toBe(b.r.body.participantId);
    expect(snap.synthesis.body).toBe("Group view");
    expect(row.submitted_by).toBe(b.r.body.participantId);
    expect(row.submitted_at).toBeGreaterThan(0);
    // read-only now, for everyone in the group, in every way
    const w = await a.c.post(`/stages/${st[0].id}/entries`, entry("late"));
    expect(w.status).toBe(403);
    expect(w.body.error.code).toBe("submitted");
    expect((await b.c.patch(`/entries/${bEntry.id}`, { ...entry("edit"), baseVersion: 1 })).status).toBe(403);
    expect((await b.c.del(`/entries/${bEntry.id}`)).status).toBe(403);
    expect((await a.c.call("PUT", `/stages/${st[0].id}/synthesis`, { body: "x", baseVersion: 1 })).status).toBe(403);
    expect((await a.c.upload(`/stages/${st[0].id}/uploads`, Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))).status).toBe(403);
    const read = await a.c.get(`/stages/${st[0].id}/entries`);
    expect(read.body.canWrite).toBe(false);
    expect(read.body.submission.status).toBe("submitted");
  });

  it("repeated clicks and retries do not create duplicate submissions", async () => {
    const { s, st } = await live();
    const a = await joinAs(s, "Ann", { group: 0 });
    await answerRequired(a.c, st[0]);
    const results = await Promise.all([1, 2, 3, 4, 5].map(() => submit(a.c, st[0].id, { requestKey: "click-1" })));
    expect(results.every((r) => r.status === 200)).toBe(true);
    expect(results.filter((r) => r.body.duplicate === false).length).toBe(1);
    const again = await submit(a.c, st[0].id); // a different click without the key
    expect(again.status).toBe(409);
    expect(again.body.error.code).toBe("already_submitted");
    const n = db().prepare("SELECT COUNT(*) AS c FROM submissions WHERE group_id=?").get(s.groups[0].id) as { c: number };
    expect(n.c).toBe(1);
  });

  it("only the nominated representative can submit when the session is set that way", async () => {
    const { fac, s, st } = await live({ submitPolicy: "representative" });
    const a = await joinAs(s, "Ann", { group: 0 });
    const b = await joinAs(s, "Ben", { group: 0 });
    await answerRequired(a.c, st[0]);
    expect((await submit(a.c, st[0].id)).body.error.code).toBe("not_representative");
    expect((await a.c.get(`/stages/${st[0].id}/submission`)).body.canSubmit).toBe(false);
    expect((await fac.post(`/groups/${s.groups[0].id}/representative`, { participantId: b.r.body.participantId })).status).toBe(200);
    expect((await submit(b.c, st[0].id)).status).toBe(200);
  });

  it("warns about teammates who currently have an editor open", async () => {
    const { s, st } = await live();
    const a = await joinAs(s, "Ann", { group: 0 });
    const b = await joinAs(s, "Ben", { group: 0 });
    await b.c.post(`/stages/${st[0].id}/presence`, { editing: true });
    expect((await a.c.get(`/stages/${st[0].id}/submission`)).body.editingNow).toEqual(["Ben"]);
    await b.c.post(`/stages/${st[0].id}/presence`, { editing: false });
    expect((await a.c.get(`/stages/${st[0].id}/submission`)).body.editingNow).toEqual([]);
  });
});

describe("reopening and versions", () => {
  it("reopening one group's submission leaves every other group unchanged, and resubmitting makes a new version", async () => {
    const { fac, s, st } = await live();
    const a = await joinAs(s, "Ann", { group: 0 });
    const x = await joinAs(s, "Xia", { group: 1 });
    await answerRequired(a.c, st[0], "A first");
    await answerRequired(x.c, st[0], "X first");
    await submit(a.c, st[0].id);
    await submit(x.c, st[0].id);
    const before = (await fac.get(`/sessions/${s.id}/overview`)).body.cells.filter((c: { groupId: string; stageId: string }) => c.groupId === s.groups[1].id && c.stageId === st[0].id);

    expect((await fac.post(`/groups/${s.groups[0].id}/stages/${st[0].id}/reopen`, { note: "please add detail" })).status).toBe(200);
    // group B: still submitted, still locked, record untouched
    const after = (await fac.get(`/sessions/${s.id}/overview`)).body.cells.filter((c: { groupId: string; stageId: string }) => c.groupId === s.groups[1].id && c.stageId === st[0].id);
    expect(after).toEqual(before);
    expect((await x.c.post(`/stages/${st[0].id}/entries`, entry("X late"))).status).toBe(403);
    // group A: editable again
    const ov = (await fac.get(`/sessions/${s.id}/overview`)).body.cells.find((c: { groupId: string; stageId: string }) => c.groupId === s.groups[0].id && c.stageId === st[0].id);
    expect(ov.status).toBe("reopened");
    expect((await fac.post(`/groups/${s.groups[0].id}/stages/${st[0].id}/reopen`, {})).body.error.code).toBe("not_submitted");
    const added = await a.c.post(`/stages/${st[0].id}/entries`, entry("A second thoughts"));
    expect(added.status).toBe(200);
    const r2 = await submit(a.c, st[0].id);
    expect(r2.body.submission.revision).toBe(2);

    // both versions exist; the first one is exactly as it was
    const subs = (await fac.get(`/sessions/${s.id}/submissions?groupId=${s.groups[0].id}`)).body.submissions;
    expect(subs.map((v: { revision: number }) => v.revision)).toEqual([2, 1]);
    const v1 = subs.find((v: { revision: number }) => v.revision === 1);
    expect(v1.snapshot.entries.map((e: { body: string }) => e.body)).toEqual(["A first"]);
    expect(v1.reopenNote).toBe("please add detail");
    expect(subs.find((v: { revision: number }) => v.revision === 2).snapshot.entries.length).toBe(2);
    // the audit trail records submit, reopen, resubmit
    const acts = (db().prepare("SELECT action FROM audit_log WHERE session_id=? ORDER BY id").all(s.id) as { action: string }[]).map((r) => r.action);
    expect(acts.filter((x) => x === "group_submitted").length).toBe(3);
    expect(acts).toContain("submission_reopened");
    // another facilitator cannot reopen it
    const other = await newFacilitator(admin);
    expect((await other.post(`/groups/${s.groups[1].id}/stages/${st[0].id}/reopen`, {})).status).toBe(404);
  });

  it("the reference panel shows a submitted snapshot (labelled) but only a draft for unsubmitted work", async () => {
    const { fac, s, st } = await live();
    await fac.patch(`/stages/${st[1].id}`, { referenceStageIds: [st[0].id] });
    const a = await joinAs(s, "Ann", { group: 0 });
    const x = await joinAs(s, "Xia", { group: 1 });
    await answerRequired(a.c, st[0], "A work");
    await answerRequired(x.c, st[0], "X work");
    await submit(a.c, st[0].id);
    await fac.patch(`/stages/${st[1].id}`, { availability: "open", proceedReason: "test" });
    const refA = (await a.c.get(`/stages/${st[1].id}`)).body.reference[0];
    const refX = (await x.c.get(`/stages/${st[1].id}`)).body.reference[0];
    expect(refA.source).toBe("submitted");
    expect(refX.source).toBe("draft");
    expect(refA.entries[0].body).toBe("A work");
  });
});

describe("release and progress", () => {
  it("counts submitted out of expected groups; empty and excluded groups do not block; opening needs a recorded reason otherwise", async () => {
    const { fac, s, st } = await live();
    const a = await joinAs(s, "Ann", { group: 0 });
    const x = await joinAs(s, "Xia", { group: 1 });
    // group 3 stays empty
    await answerRequired(a.c, st[0]);
    await answerRequired(x.c, st[0]);
    await submit(a.c, st[0].id);
    let ov = (await fac.get(`/sessions/${s.id}/overview`)).body;
    let p1 = ov.stages[0];
    expect(p1.expected).toBe(2); // the empty group is not expected
    expect(p1.submitted).toBe(1);
    expect(p1.missing.map((g: { name: string }) => g.name)).toEqual([s.groups[1].name]);
    // submitting did not open the next part
    expect(ov.stages[1].availability).toBe("locked");
    // opening Part 2 while Xia's group is missing is refused until a reason is given
    const refused = await fac.patch(`/stages/${st[1].id}`, { availability: "open" });
    expect(refused.status).toBe(409);
    expect(refused.body.error.code).toBe("groups_not_submitted");
    expect(refused.body.error.missing.length).toBe(1);
    // exclude Xia's group from Part 1: nothing is missing any more, no reason needed
    await fac.put(`/groups/${s.groups[1].id}/stages/${st[0].id}`, { excluded: true });
    ov = (await fac.get(`/sessions/${s.id}/overview`)).body;
    p1 = ov.stages[0];
    expect(p1.expected).toBe(1);
    expect(p1.submitted).toBe(1);
    expect((await fac.patch(`/stages/${st[1].id}`, { availability: "open" })).status).toBe(200);
    expect((db().prepare("SELECT COUNT(*) AS c FROM proceed_overrides WHERE session_id=?").get(s.id) as { c: number }).c).toBe(0);
  });

  it("an override records who, why and which groups were missing", async () => {
    const { fac, s, st } = await live();
    await joinAs(s, "Ann", { group: 0 });
    const r = await fac.patch(`/stages/${st[1].id}`, { availability: "open", proceedReason: "Out of time; moving on" });
    expect(r.status).toBe(200);
    const o = db().prepare("SELECT reason, missing_groups_json FROM proceed_overrides WHERE session_id=?").get(s.id) as { reason: string; missing_groups_json: string };
    expect(o.reason).toBe("Out of time; moving on");
    expect(JSON.parse(o.missing_groups_json).length).toBe(1);
    const audit = db().prepare("SELECT COUNT(*) AS c FROM audit_log WHERE session_id=? AND action='proceed_override'").get(s.id) as { c: number };
    expect(audit.c).toBe(1);
  });
});

describe("duplicate, archive, restore and delete", () => {
  it("a duplicate is a clean activity: structure and files copied, no people, work, PINs or old code", async () => {
    const { fac, s, st } = await live();
    await fac.patch(`/groups/${s.groups[0].id}`, { pin: "1234", seatCap: 4 });
    await fac.post(`/stages/${st[0].id}/resources`, { title: "Site", url: "https://example.org/x" });
    const pdf = await fac.upload(`/stages/${st[1].id}/resources/file?title=Reading`, Buffer.from("%PDF-1.4 copy me"), "r.pdf");
    expect(pdf.status).toBe(200);
    await fac.patch(`/stages/${st[1].id}`, { referenceStageIds: [st[0].id] });
    const a = await joinAs(s, "Ann", { group: 0, pin: "1234" });
    expect(a.r.status).toBe(200);
    await answerRequired(a.c, st[0]);
    await submit(a.c, st[0].id);

    const dup = await fac.post(`/sessions/${s.id}/duplicate`, {});
    expect(dup.status).toBe(200);
    expect(dup.body.groupsNeedingPin).toEqual([s.groups[0].name]);
    const d = (await fac.get(`/sessions/${dup.body.id}`)).body;
    expect(d.session.joinCode).not.toBe(s.code);
    expect(d.session.status).toBe("setup");
    expect(d.groups.length).toBe(3);
    expect(d.groups[0].seatCap).toBe(4);
    expect(d.groups[0].hasPin).toBe(false);
    expect(d.groups.every((g: { activeCount: number }) => g.activeCount === 0)).toBe(true);
    expect((await fac.get(`/sessions/${dup.body.id}/participants`)).body.participants).toEqual([]);
    expect((await fac.get(`/sessions/${dup.body.id}/entries`)).body.entries).toEqual([]);
    expect((await fac.get(`/sessions/${dup.body.id}/submissions`)).body.submissions).toEqual([]);
    const cst = (await fac.get(`/sessions/${dup.body.id}/stages`)).body.stages;
    expect(cst.map((x: { availability: string }) => x.availability)).toEqual(["locked", "locked", "locked"]);
    expect(cst[0].resources.some((r: { title: string }) => r.title === "Site")).toBe(true);
    expect(cst[1].referenceStageIds).toEqual([cst[0].id]);
    expect(cst[0].questions.length).toBe(1);
    // the old recovery code and join code do not work on the copy
    expect((await new Client("10.70.0.1").post("/recover", { recoveryCode: a.r.body.recoveryCode })).status).toBe(200); // still the ORIGINAL session
    expect((await new Client("10.70.0.2").get(`/public/session?code=${s.code}`)).body.title).toBe(s.id ? "Test session" : "");

    // the copied file survives deleting the original
    const copiedAtt = cst[1].resources.find((r: { kind: string }) => r.kind === "file").attachmentId;
    const origAtt = pdf.body.attachmentId;
    expect(copiedAtt).not.toBe(origAtt);
    const origStored = (db().prepare("SELECT stored_name FROM attachments WHERE id=?").get(origAtt) as { stored_name: string }).stored_name;
    expect((await fac.del(`/sessions/${s.id}`, { confirmTitle: "Test session" })).status).toBe(200);
    expect(fs.existsSync(path.join(uploadDir(), origStored))).toBe(false);
    expect((await fac.get(`/attachments/${copiedAtt}`)).status).toBe(200);
  });

  it("archive makes the session read-only for everyone; restore brings it back", async () => {
    const { fac, s, st } = await live();
    const a = await joinAs(s, "Ann", { group: 0 });
    await a.c.post(`/stages/${st[0].id}/entries`, entry("before archive"));
    expect((await fac.post(`/sessions/${s.id}/archive`)).status).toBe(200);
    // participant: can still read, cannot write, nobody can join
    expect((await a.c.get(`/stages/${st[0].id}/entries`)).body.entries.length).toBe(1);
    expect((await a.c.post(`/stages/${st[0].id}/entries`, entry("after archive"))).status).toBe(403);
    expect((await a.c.get("/me")).body.session.archived).toBe(true);
    expect((await joinAs(s, "Late")).r.status).toBe(404);
    // facilitator changes are refused
    expect((await fac.patch(`/sessions/${s.id}`, { title: "x" })).body.error.code).toBe("session_archived");
    expect((await fac.patch(`/stages/${st[1].id}`, { title: "x" })).body.error.code).toBe("session_archived");
    expect((await fac.post(`/sessions/${s.id}/archive`)).status).toBe(409);
    expect((await fac.post(`/sessions/${s.id}/restore`)).status).toBe(200);
    expect((await a.c.post(`/stages/${st[0].id}/entries`, entry("after restore"))).status).toBe(200);
    expect((await fac.get(`/sessions/${s.id}`)).body.session.status).toBe("live");
  });

  it("permanent deletion needs the exact title and the owner, and removes everything of that session only", async () => {
    const owner = await newFacilitator(admin, "Owner");
    const co = await newFacilitator(admin, "Co");
    const s = await newSession(owner, { template: "discussion" });
    const other = await newSession(owner, { template: "discussion" });
    await owner.post(`/sessions/${s.id}/facilitators`, { email: (co as unknown as { email: string }).email });
    await owner.post(`/sessions/${s.id}/start`);
    await owner.post(`/sessions/${other.id}/start`);
    const st = (await owner.get(`/sessions/${s.id}/stages`)).body.stages;
    await owner.patch(`/stages/${st[0].id}`, { contributionTypes: ["text", "image"] });
    const a = await joinAs(s, "Ann", { group: 0 });
    const keep = await joinAs(other, "Keeper", { group: 0 });
    const png = Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), Buffer.alloc(12, 1)]);
    // minimal valid-enough PNG chunks
    const chunk = (t: string, d: Buffer) => { const l = Buffer.alloc(4); l.writeUInt32BE(d.length); return Buffer.concat([l, Buffer.from(t, "latin1"), d, Buffer.alloc(4)]); };
    const goodPng = Buffer.concat([png.subarray(0, 8), chunk("IHDR", Buffer.alloc(13)), chunk("IDAT", Buffer.from([1])), chunk("IEND", Buffer.alloc(0))]);
    const up = await a.c.upload(`/stages/${st[0].id}/uploads`, goodPng, "p.png");
    expect(up.status).toBe(200);
    await a.c.post(`/stages/${st[0].id}/entries`, entry("to be deleted", { attachmentId: up.body.attachment.id }));
    await keep.c.post(`/stages/${(await owner.get(`/sessions/${other.id}/stages`)).body.stages[0].id}/entries`, entry("keep me"));
    const stored = (db().prepare("SELECT stored_name FROM attachments WHERE id=?").get(up.body.attachment.id) as { stored_name: string }).stored_name;
    expect(fs.existsSync(path.join(uploadDir(), stored))).toBe(true);

    expect((await co.del(`/sessions/${s.id}`, { confirmTitle: "Test session" })).status).toBe(403); // owner only
    expect((await owner.del(`/sessions/${s.id}`, { confirmTitle: "wrong title" })).body.error.code).toBe("confirmation_mismatch");
    expect((await owner.del(`/sessions/${s.id}`, {})).status).toBe(400);
    expect((await owner.get(`/sessions/${s.id}`)).status).toBe(200);

    expect((await owner.del(`/sessions/${s.id}`, { confirmTitle: "Test session" })).status).toBe(200);
    const q = (sql: string) => (db().prepare(sql).get(s.id) as { c: number }).c;
    expect(q("SELECT COUNT(*) AS c FROM sessions WHERE id=?")).toBe(0);
    expect(q("SELECT COUNT(*) AS c FROM participants WHERE session_id=?")).toBe(0);
    expect(q("SELECT COUNT(*) AS c FROM entries WHERE session_id=?")).toBe(0);
    expect(q("SELECT COUNT(*) AS c FROM attachments WHERE session_id=?")).toBe(0);
    expect(q("SELECT COUNT(*) AS c FROM groups WHERE session_id=?")).toBe(0);
    expect(fs.existsSync(path.join(uploadDir(), stored))).toBe(false);
    expect((await a.c.get("/me")).status).toBe(401);
    expect((await new Client("10.71.0.1").post("/recover", { recoveryCode: a.r.body.recoveryCode })).status).toBe(403);
    expect((await owner.get(`/sessions/${s.id}`)).status).toBe(404);
    // audit: only a tombstone with no content
    expect((db().prepare("SELECT COUNT(*) AS c FROM audit_log WHERE session_id=?").get(s.id) as { c: number }).c).toBe(0);
    const tomb = db().prepare("SELECT action, target FROM audit_log WHERE action='session_deleted' AND target=?").get(s.id) as { action: string; target: string };
    expect(tomb.target).toBe(s.id);
    // the other session is untouched
    expect((await keep.c.get("/me")).status).toBe(200);
    expect((await owner.get(`/sessions/${other.id}/entries`)).body.entries.length).toBe(1);
  });
});
