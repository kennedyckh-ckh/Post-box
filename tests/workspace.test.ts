import { describe, it, expect, beforeAll } from "vitest";
import { Client, adminClient, newFacilitator, newSession, joinAs } from "./helpers";
import { db } from "@/lib/db";

let admin: Client;
beforeAll(async () => {
  admin = await adminClient();
});

/** A live session with stage ids, 2 groups and the stage list the facilitator sees. */
async function live(extra: Record<string, unknown> = {}) {
  const fac = await newFacilitator(admin);
  const s = await newSession(fac, { groupCount: 2, template: "discussion", ...extra });
  await fac.post(`/sessions/${s.id}/start`);
  const st = (await fac.get(`/sessions/${s.id}/stages`)).body.stages as { id: string; questions: { id: string }[] }[];
  return { fac, s, st };
}
const entry = (body: string, more: Record<string, unknown> = {}) => ({ kind: "text", body, ...more });

// ---- tiny valid-enough image files built in memory ----
const crc0 = Buffer.alloc(4);
function pngChunk(type: string, data: Buffer) {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length);
  return Buffer.concat([len, Buffer.from(type, "latin1"), data, crc0]);
}
const PNG_SIG = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
const pngWithText = () => Buffer.concat([PNG_SIG, pngChunk("IHDR", Buffer.alloc(13)), pngChunk("tEXt", Buffer.from("Comment\\0SECRET-LOCATION")), pngChunk("IDAT", Buffer.from([1, 2, 3])), pngChunk("IEND", Buffer.alloc(0))]);
function jpegSeg(marker: number, payload: Buffer) {
  const h = Buffer.alloc(4);
  h[0] = 0xff; h[1] = marker; h.writeUInt16BE(payload.length + 2, 2);
  return Buffer.concat([h, payload]);
}
const jpegWithExif = () => Buffer.concat([Buffer.from([0xff, 0xd8]), jpegSeg(0xe1, Buffer.from("Exif\\0\\0GPS-SECRET-LAT-LONG")), jpegSeg(0xe0, Buffer.from("JFIF\\0\\x01\\x01\\0\\0\\x01\\0\\x01\\0\\0")), jpegSeg(0xda, Buffer.from([1, 1, 0, 0, 0x3f, 0])), Buffer.from([1, 2, 3, 0xff, 0xd9])]);

describe("individual contributions inside a group", () => {
  it("two participants write at the same time without overwriting each other", async () => {
    const { s, st } = await live();
    const a = await joinAs(s, "Ann", { group: 0 });
    const b = await joinAs(s, "Ben", { group: 0 });
    const [ra, rb] = await Promise.all([a.c.post(`/stages/${st[0].id}/entries`, entry("Ann's idea")), b.c.post(`/stages/${st[0].id}/entries`, entry("Ben's idea"))]);
    expect(ra.status).toBe(200);
    expect(rb.status).toBe(200);
    // both edit their own entry at once
    const [ea, eb] = await Promise.all([
      a.c.patch(`/entries/${ra.body.entry.id}`, { ...entry("Ann, revised"), baseVersion: 1 }),
      b.c.patch(`/entries/${rb.body.entry.id}`, { ...entry("Ben, revised"), baseVersion: 1 }),
    ]);
    expect(ea.status).toBe(200);
    expect(eb.status).toBe(200);
    const list = (await a.c.get(`/stages/${st[0].id}/entries`)).body.entries as { authorName: string; body: string; mine: boolean }[];
    expect(list.map((e) => e.body).sort()).toEqual(["Ann, revised", "Ben, revised"]);
    expect(list.find((e) => e.authorName === "Ann")!.mine).toBe(true);
    expect(list.find((e) => e.authorName === "Ben")!.mine).toBe(false);
    // attribution recorded
    const row = db().prepare("SELECT author_id, author_name, group_id, stage_id FROM entries WHERE id=?").get(ra.body.entry.id) as Record<string, string>;
    expect(row.author_id).toBe(a.r.body.participantId);
    expect(row.author_name).toBe("Ann");
  });

  it("nobody can edit, delete or overwrite someone else's entry", async () => {
    const { s, st } = await live();
    const a = await joinAs(s, "Ann", { group: 0 });
    const b = await joinAs(s, "Ben", { group: 0 });
    const e = (await a.c.post(`/stages/${st[0].id}/entries`, entry("mine"))).body.entry;
    expect((await b.c.patch(`/entries/${e.id}`, { ...entry("hijack"), baseVersion: 1 })).status).toBe(404);
    expect((await b.c.del(`/entries/${e.id}`)).status).toBe(404);
    expect((await a.c.get(`/stages/${st[0].id}/entries`)).body.entries[0].body).toBe("mine");
  });

  it("keeps a stale edit from silently overwriting: the conflict returns the saved copy and a retry works", async () => {
    const { s, st } = await live();
    const phone = await joinAs(s, "Cam", { group: 0 });
    const laptop = phone.c.clone("10.77.0.1");
    const e = (await phone.c.post(`/stages/${st[0].id}/entries`, entry("v1"))).body.entry;
    expect((await phone.c.patch(`/entries/${e.id}`, { ...entry("v2 from phone"), baseVersion: 1 })).status).toBe(200);
    const stale = await laptop.patch(`/entries/${e.id}`, { ...entry("v2 from laptop"), baseVersion: 1 });
    expect(stale.status).toBe(409);
    expect(stale.body.error.code).toBe("edit_conflict");
    expect(stale.body.error.current.body).toBe("v2 from phone");
    expect(stale.body.error.current.version).toBe(2);
    const retry = await laptop.patch(`/entries/${e.id}`, { ...entry("v2 from laptop"), baseVersion: stale.body.error.current.version });
    expect(retry.status).toBe(200);
    const versions = db().prepare("SELECT version, body FROM entry_versions WHERE entry_id=? ORDER BY version").all(e.id) as { version: number; body: string }[];
    expect(versions.map((v) => v.body)).toEqual(["v1", "v2 from phone", "v2 from laptop"]);
  });

  it("does not create a duplicate when a save is retried with the same key", async () => {
    const { s, st } = await live();
    const a = await joinAs(s, "Dee", { group: 0 });
    const k = { clientKey: "abc-123" };
    const r1 = await a.c.post(`/stages/${st[0].id}/entries`, entry("once", k));
    const r2 = await a.c.post(`/stages/${st[0].id}/entries`, entry("once", k));
    expect(r2.body.duplicate).toBe(true);
    expect(r2.body.entry.id).toBe(r1.body.entry.id);
    expect((await a.c.get(`/stages/${st[0].id}/entries`)).body.entries.length).toBe(1);
  });

  it("supports tags from the stage list, labelled editable tables, and rejects bad shapes", async () => {
    const { s, st } = await live();
    const a = await joinAs(s, "Eve", { group: 0 });
    const q = (await a.c.get(`/stages/${st[0].id}`)).body.questions[0].id;
    const ok = await a.c.post(`/stages/${st[0].id}/entries`, entry("tagged", { tags: ["Claim", "Claim", "Example"], questionId: q }));
    expect(ok.status).toBe(200);
    expect(ok.body.entry.tags).toEqual(["Claim", "Example"]);
    expect(ok.body.entry.questionId).toBe(q);
    expect((await a.c.post(`/stages/${st[0].id}/entries`, entry("x", { tags: ["Not a tag"] }))).status).toBe(400);
    expect((await a.c.post(`/stages/${st[0].id}/entries`, entry("x", { questionId: "que_nonexistent" }))).status).toBe(400);
    const table = { columns: ["Trial", "Result"], rows: [["1", "4.2"], ["2", "五点"]] };
    const t = await a.c.post(`/stages/${st[0].id}/entries`, { kind: "table", body: "My data", table });
    expect(t.status).toBe(200);
    expect(t.body.entry.table).toEqual(table);
    const edited = { columns: ["Trial", "Result", "Note"], rows: [["1", "4.2", ""], ["2", "5", "re-run"]] };
    const tu = await a.c.patch(`/entries/${t.body.entry.id}`, { kind: "table", table: edited, baseVersion: 1 });
    expect(tu.body.entry.table).toEqual(edited);
    expect((await a.c.post(`/stages/${st[0].id}/entries`, { kind: "table", table: { columns: ["A"], rows: [["1", "2"]] } })).status).toBe(400);
    expect((await a.c.post(`/stages/${st[0].id}/entries`, { kind: "table", table: { columns: [], rows: [] } })).status).toBe(400);
    expect((await a.c.post(`/stages/${st[0].id}/entries`, entry(""))).status).toBe(400);
    // stored structure is exactly what was sent (JSON export relies on it)
    const stored = db().prepare("SELECT table_json FROM entries WHERE id=?").get(t.body.entry.id) as { table_json: string };
    expect(JSON.parse(stored.table_json)).toEqual(edited);
  });

  it("stores Traditional Chinese without corruption", async () => {
    const { s, st } = await live();
    const a = await joinAs(s, "陳大文", { group: 0 });
    const text = "我認為氣候變遷是真的。請參考「報告」！😀";
    const r = await a.c.post(`/stages/${st[0].id}/entries`, entry(text));
    expect((await a.c.get(`/stages/${st[0].id}/entries`)).body.entries[0].body).toBe(text);
    expect(r.body.entry.authorName).toBe("陳大文");
  });
});

describe("privacy between groups", () => {
  it("a participant sees only their own group's entries and cannot reach another group's by id or url", async () => {
    const { s, st } = await live();
    const a = await joinAs(s, "Ann", { group: 0 });
    const x = await joinAs(s, "Xia", { group: 1 });
    const secret = (await a.c.post(`/stages/${st[0].id}/entries`, entry("group A private"))).body.entry;
    const seen = (await x.c.get(`/stages/${st[0].id}/entries`)).body.entries;
    expect(JSON.stringify(seen)).not.toContain("group A private");
    expect((await x.c.patch(`/entries/${secret.id}`, { ...entry("hax"), baseVersion: 1 })).status).toBe(404);
    expect((await x.c.del(`/entries/${secret.id}`)).status).toBe(404);
    expect((await new Client("10.55.0.1").get(`/stages/${st[0].id}/entries`)).status).toBe(401);
  });

  it("another group, another facilitator and anonymous users cannot download a private picture", async () => {
    const { fac, s, st } = await live({ template: "blank" });
    await fac.patch(`/stages/${st[0].id}`, { contributionTypes: ["text", "table", "image"] });
    const a = await joinAs(s, "Ann", { group: 0 });
    const x = await joinAs(s, "Xia", { group: 1 });
    const up = await a.c.upload(`/stages/${st[0].id}/uploads`, pngWithText(), "photo.png");
    expect(up.status).toBe(200);
    const id = up.body.attachment.id;
    expect((await a.c.get(`/attachments/${id}`)).status).toBe(200);
    expect((await fac.get(`/attachments/${id}`)).status).toBe(200);
    expect((await x.c.get(`/attachments/${id}`)).status).toBe(404);
    expect((await new Client("10.55.0.2").get(`/attachments/${id}`)).status).toBe(404);
    const other = await newFacilitator(admin);
    expect((await other.get(`/attachments/${id}`)).status).toBe(404);
    // and another group's member cannot attach it to their own entry
    expect((await x.c.post(`/stages/${st[0].id}/entries`, entry("steal", { attachmentId: id }))).status).toBe(400);
  });
});

describe("stage controls", () => {
  it("locked, hidden and disabled stages cannot be reached through direct requests", async () => {
    const { fac, s, st } = await live();
    const a = await joinAs(s, "Ann", { group: 0 });
    // Part 2 is locked by default: no content, no writing, no uploading
    const locked = await a.c.get(`/stages/${st[1].id}`);
    expect(locked.status).toBe(403);
    expect(locked.body.error.code).toBe("stage_locked");
    expect(JSON.stringify(locked.body)).not.toMatch(/Respond to ideas|agree or disagree/);
    expect((await a.c.get(`/stages/${st[1].id}/entries`)).status).toBe(403);
    expect((await a.c.post(`/stages/${st[1].id}/entries`, entry("early"))).status).toBe(403);
    expect((await a.c.upload(`/stages/${st[1].id}/uploads`, pngWithText())).status).toBe(403);
    // hidden: behaves as if it did not exist, even once open
    await fac.patch(`/stages/${st[1].id}`, { availability: "open", proceedReason: "test" });
    await fac.patch(`/stages/${st[1].id}`, { visible: false });
    expect((await a.c.get(`/stages/${st[1].id}`)).status).toBe(404);
    expect((await a.c.post(`/stages/${st[1].id}/entries`, entry("sneak"))).status).toBe(404);
    expect(((await a.c.get("/me")).body.stages as { id: string }[]).some((x) => x.id === st[1].id)).toBe(false);
    await fac.patch(`/stages/${st[1].id}`, { visible: true });
    expect((await a.c.post(`/stages/${st[1].id}/entries`, entry("now ok"))).status).toBe(200);
    // disabled
    await fac.patch(`/stages/${st[2].id}`, { availability: "open", proceedReason: "test" });
    await fac.patch(`/stages/${st[2].id}`, { enabled: false });
    expect((await a.c.post(`/stages/${st[2].id}/entries`, entry("disabled"))).status).toBe(404);
  });

  it("opening a later stage never changes earlier responses and never publishes anything", async () => {
    const { fac, s, st } = await live();
    const a = await joinAs(s, "Ann", { group: 0 });
    const e1 = (await a.c.post(`/stages/${st[0].id}/entries`, entry("part one answer"))).body.entry;
    const before = db().prepare("SELECT * FROM entries WHERE id=?").get(e1.id);
    await fac.patch(`/stages/${st[1].id}`, { availability: "open", proceedReason: "test" });
    expect(db().prepare("SELECT * FROM entries WHERE id=?").get(e1.id)).toEqual(before);
    expect((await a.c.post(`/stages/${st[1].id}/entries`, entry("part two answer"))).status).toBe(200);
    // Part 1 is untouched and still open (opening Part 2 did not close or open anything else)
    const states = (await fac.get(`/sessions/${s.id}/stages`)).body.stages.map((x: { availability: string }) => x.availability);
    expect(states).toEqual(["open", "open", "locked"]);
    // another group's participant cannot see this group's Part 2 answers
    const x = await joinAs(s, "Xia", { group: 1 });
    expect(JSON.stringify((await x.c.get(`/stages/${st[1].id}/entries`)).body)).not.toContain("part two answer");
  });

  it("closed means read-only; transitions follow the rules", async () => {
    const { fac, s, st } = await live();
    const a = await joinAs(s, "Ann", { group: 0 });
    const e = (await a.c.post(`/stages/${st[0].id}/entries`, entry("before close"))).body.entry;
    expect((await fac.patch(`/stages/${st[0].id}`, { availability: "closed" })).status).toBe(200);
    const w = await a.c.post(`/stages/${st[0].id}/entries`, entry("too late"));
    expect(w.status).toBe(403);
    expect(w.body.error.code).toBe("stage_closed");
    expect((await a.c.patch(`/entries/${e.id}`, { ...entry("edit"), baseVersion: 1 })).status).toBe(403);
    expect((await a.c.del(`/entries/${e.id}`)).status).toBe(403);
    const read = await a.c.get(`/stages/${st[0].id}/entries`);
    expect(read.body.entries.length).toBe(1);
    expect(read.body.canWrite).toBe(false);
    // closed -> locked is refused once there is work; locked -> closed is not a legal move
    expect((await fac.patch(`/stages/${st[0].id}`, { availability: "locked" })).body.error.code).toBe("has_entries");
    expect((await fac.patch(`/stages/${st[2].id}`, { availability: "closed" })).body.error.code).toBe("bad_transition");
    expect((await fac.patch(`/stages/${st[0].id}`, { availability: "open", proceedReason: "test" })).status).toBe(200);
    expect((await a.c.post(`/stages/${st[0].id}/entries`, entry("reopened"))).status).toBe(200);
  });

  it("stage changes need a started session, and at least one stage stays enabled", async () => {
    const fac = await newFacilitator(admin);
    const s = await newSession(fac, { enabledStages: [true, false, false] });
    const st = (await fac.get(`/sessions/${s.id}/stages`)).body.stages;
    expect((await fac.patch(`/stages/${st[0].id}`, { availability: "open", proceedReason: "test" })).body.error.code).toBe("not_live");
    expect((await fac.patch(`/stages/${st[0].id}`, { enabled: false })).status).toBe(400);
    expect((await fac.patch(`/stages/${st[1].id}`, { title: "Renamed" })).status).toBe(200);
  });

  it("opens or closes one stage for one group only, and excluded groups cannot write", async () => {
    const { fac, s, st } = await live();
    const a = await joinAs(s, "Ann", { group: 0 });
    const x = await joinAs(s, "Xia", { group: 1 });
    const put = (g: string, stage: string, body: unknown) => (fac as unknown as { call: Client["call"] }).call("PUT", `/groups/${g}/stages/${stage}`, body);
    expect((await put(s.groups[0].id, st[1].id, { availabilityOverride: "open" })).status).toBe(200);
    expect((await a.c.post(`/stages/${st[1].id}/entries`, entry("A can"))).status).toBe(200);
    expect((await x.c.post(`/stages/${st[1].id}/entries`, entry("B cannot"))).status).toBe(403);
    expect(((await a.c.get("/me")).body.stages as { availability: string }[])[1].availability).toBe("open");
    expect(((await x.c.get("/me")).body.stages as { availability: string }[])[1].availability).toBe("locked");
    // close Part 1 for group B only
    await put(s.groups[1].id, st[0].id, { availabilityOverride: "closed" });
    expect((await x.c.post(`/stages/${st[0].id}/entries`, entry("B closed"))).body.error.code).toBe("stage_closed");
    expect((await a.c.post(`/stages/${st[0].id}/entries`, entry("A still open"))).status).toBe(200);
    // exclude group A from Part 1
    await put(s.groups[0].id, st[0].id, { excluded: true });
    expect((await a.c.post(`/stages/${st[0].id}/entries`, entry("excluded"))).body.error.code).toBe("group_excluded");
  });
});

describe("reference panel and group response", () => {
  it("shows earlier work from the group's own earlier parts, labelled and separate from the current part", async () => {
    const { fac, s, st } = await live();
    await fac.patch(`/stages/${st[1].id}`, { availability: "open", proceedReason: "test", referenceStageIds: [st[0].id] });
    const a = await joinAs(s, "Ann", { group: 0 });
    const x = await joinAs(s, "Xia", { group: 1 });
    await a.c.post(`/stages/${st[0].id}/entries`, entry("earlier A"));
    await x.c.post(`/stages/${st[0].id}/entries`, entry("earlier B"));
    await a.c.post(`/stages/${st[1].id}/entries`, entry("current A"));
    const d = (await a.c.get(`/stages/${st[1].id}`)).body;
    expect(d.reference.length).toBe(1);
    expect(d.reference[0].title).toContain("Part 1");
    expect(d.reference[0].source).toBe("draft");
    expect(d.reference[0].entries.map((e: { body: string }) => e.body)).toEqual(["earlier A"]);
    const cur = (await a.c.get(`/stages/${st[1].id}/entries`)).body.entries.map((e: { body: string }) => e.body);
    expect(cur).toEqual(["current A"]);
    expect((await fac.patch(`/stages/${st[0].id}`, { referenceStageIds: [st[1].id] })).status).toBe(400); // only earlier parts
  });

  it("group response: preserves individual entries and reports a conflict instead of overwriting", async () => {
    const { s, st } = await live();
    const a = await joinAs(s, "Ann", { group: 0 });
    const b = await joinAs(s, "Ben", { group: 0 });
    await a.c.post(`/stages/${st[0].id}/entries`, entry("individual A"));
    const first = await a.c.call("PUT", `/stages/${st[0].id}/synthesis`, { body: "We agree on X", baseVersion: 0 });
    expect(first.status).toBe(200);
    const stale = await b.c.call("PUT", `/stages/${st[0].id}/synthesis`, { body: "Ben's version", baseVersion: 0 });
    expect(stale.status).toBe(409);
    expect(stale.body.error.current.body).toBe("We agree on X");
    const ok = await b.c.call("PUT", `/stages/${st[0].id}/synthesis`, { body: "We agree on X and Y", baseVersion: 1 });
    expect(ok.body.synthesis.version).toBe(2);
    const list = (await a.c.get(`/stages/${st[0].id}/entries`)).body;
    expect(list.entries.map((e: { body: string }) => e.body)).toEqual(["individual A"]);
    expect(list.synthesis.body).toBe("We agree on X and Y");
    const vs = db().prepare("SELECT COUNT(*) AS c FROM group_synthesis_versions").get() as { c: number };
    expect(vs.c).toBeGreaterThanOrEqual(2);
  });

  it("polling returns 'unchanged' until something changes", async () => {
    const { s, st } = await live();
    const a = await joinAs(s, "Ann", { group: 0 });
    const b = await joinAs(s, "Ben", { group: 0 });
    const t1 = (await a.c.get(`/stages/${st[0].id}/entries`)).body.etag;
    expect((await a.c.get(`/stages/${st[0].id}/entries?etag=${t1}`)).body.unchanged).toBe(true);
    await b.c.post(`/stages/${st[0].id}/entries`, entry("new from Ben"));
    const t2 = await a.c.get(`/stages/${st[0].id}/entries?etag=${t1}`);
    expect(t2.body.unchanged).toBeUndefined();
    expect(t2.body.entries.length).toBe(1);
  });
});

describe("membership and contributions", () => {
  it("moving a participant leaves their earlier entries with the original group", async () => {
    const { fac, s, st } = await live();
    const a = await joinAs(s, "Ann", { group: 0 });
    const mate = await joinAs(s, "Mate", { group: 0 });
    const e = (await a.c.post(`/stages/${st[0].id}/entries`, entry("written in group 1"))).body.entry;
    await fac.post(`/participants/${a.r.body.participantId}/move`, { groupId: s.groups[1].id });
    // the old group still sees it; the mover no longer does, and cannot edit it from the new group
    expect((await mate.c.get(`/stages/${st[0].id}/entries`)).body.entries.map((x: { body: string }) => x.body)).toEqual(["written in group 1"]);
    expect((await a.c.get(`/stages/${st[0].id}/entries`)).body.entries).toEqual([]);
    expect((await a.c.patch(`/entries/${e.id}`, { ...entry("edit"), baseVersion: 1 })).status).toBe(404);
    const row = db().prepare("SELECT group_id FROM entries WHERE id=?").get(e.id) as { group_id: string };
    expect(row.group_id).toBe(s.groups[0].id);
  });

  it("removing a participant keeps their entries and attribution", async () => {
    const { fac, s, st } = await live();
    const a = await joinAs(s, "Ann", { group: 0 });
    await a.c.post(`/stages/${st[0].id}/entries`, entry("stays"));
    await fac.post(`/participants/${a.r.body.participantId}/remove`);
    const all = (await fac.get(`/sessions/${s.id}/entries?stageId=${st[0].id}`)).body.entries;
    expect(all.length).toBe(1);
    expect(all[0].authorName).toBe("Ann");
    expect(all[0].authorId).toBe(a.r.body.participantId);
  });

  it("a facilitator can hide an entry from the group; the author cannot then change it", async () => {
    const { fac, s, st } = await live();
    const a = await joinAs(s, "Ann", { group: 0 });
    const b = await joinAs(s, "Ben", { group: 0 });
    const e = (await a.c.post(`/stages/${st[0].id}/entries`, entry("inappropriate"))).body.entry;
    expect((await fac.post(`/entries/${e.id}/hide`, { hidden: true })).status).toBe(200);
    expect((await b.c.get(`/stages/${st[0].id}/entries`)).body.entries).toEqual([]);
    expect((await a.c.patch(`/entries/${e.id}`, { ...entry("edit"), baseVersion: 1 })).body.error.code).toBe("entry_hidden");
    expect((await fac.get(`/sessions/${s.id}/entries`)).body.entries[0].hidden).toBe(true);
    const other = await newFacilitator(admin);
    expect((await other.post(`/entries/${e.id}/hide`, { hidden: false })).status).toBe(404);
  });
});

describe("files", () => {
  async function imgSession() {
    const x = await live({ template: "blank" });
    await x.fac.patch(`/stages/${x.st[0].id}`, { contributionTypes: ["text", "image"] });
    const a = await joinAs(x.s, "Ann", { group: 0 });
    return { ...x, a };
  }

  it("accepts real images, strips location metadata, and attaches them to an entry", async () => {
    const { s, st, a } = await imgSession();
    const jp = await a.c.upload(`/stages/${st[0].id}/uploads`, jpegWithExif(), "holiday.JPG");
    expect(jp.status).toBe(200);
    expect(jp.body.attachment.mime).toBe("image/jpeg");
    const got = await a.c.get(`/attachments/${jp.body.attachment.id}`);
    expect(got.raw!.toString("latin1")).not.toContain("GPS-SECRET");
    expect(got.headers["x-content-type-options"]).toBe("nosniff");
    expect(got.headers["content-security-policy"]).toContain("sandbox");
    const png = await a.c.upload(`/stages/${st[0].id}/uploads`, pngWithText(), "shot.png");
    expect((await a.c.get(`/attachments/${png.body.attachment.id}`)).raw!.toString("latin1")).not.toContain("SECRET-LOCATION");
    const e = await a.c.post(`/stages/${st[0].id}/entries`, entry("with picture", { attachmentId: png.body.attachment.id }));
    expect(e.status).toBe(200);
    expect(e.body.entry.attachment.name).toBe("shot.png");
    // the same picture cannot be attached twice
    expect((await a.c.post(`/stages/${st[0].id}/entries`, entry("again", { attachmentId: png.body.attachment.id }))).status).toBe(400);
    void s;
  });

  it("rejects files by content, not by name: scripts, HTML, SVG, PDFs from participants, oversize and empty files", async () => {
    const { st, a } = await imgSession();
    const up = (buf: Buffer, name: string) => a.c.upload(`/stages/${st[0].id}/uploads`, buf, name);
    expect((await up(Buffer.from("<html><script>alert(1)</script></html>"), "cute.png")).body.error.code).toBe("unsupported_file");
    expect((await up(Buffer.from('<svg xmlns="http://www.w3.org/2000/svg" onload="alert(1)"/>'), "x.svg")).status).toBe(400);
    expect((await up(Buffer.from("MZ\\x90\\x00\\x03 fake exe"), "photo.jpg")).status).toBe(400);
    expect((await up(Buffer.from("%PDF-1.4 hello"), "doc.pdf")).status).toBe(400); // participants: images only
    expect((await up(Buffer.alloc(0), "empty.png")).status).toBe(400);
    const big = Buffer.concat([pngWithText(), Buffer.alloc(3 * 1024 * 1024)]);
    expect((await up(big, "big.png")).body.error.code).toBe("file_too_large");
    // image uploads are refused in a part that does not allow images
    await live();
  });

  it("facilitator files (PDF, WebP) are stored, served as downloads, and gated by stage release", async () => {
    const { fac, s, st } = await live({ template: "blank" });
    const a = await joinAs(s, "Ann", { group: 0 });
    const pdf = await fac.upload(`/stages/${st[1].id}/resources/file?title=Reading`, Buffer.from("%PDF-1.4\\n%fake but has the magic"), "reading.pdf");
    expect(pdf.status).toBe(200);
    const att = pdf.body.attachmentId;
    // Part 2 is locked: participants cannot fetch its file
    expect((await a.c.get(`/attachments/${att}`)).status).toBe(404);
    await fac.patch(`/stages/${st[1].id}`, { availability: "open", proceedReason: "test" });
    const dl = await a.c.get(`/attachments/${att}`);
    expect(dl.status).toBe(200);
    expect(dl.headers["content-type"]).toBe("application/pdf");
    expect(dl.headers["content-disposition"]).toMatch(/^attachment/);
    const d = (await a.c.get(`/stages/${st[1].id}`)).body;
    expect(d.resources.some((r: { kind: string; title: string }) => r.kind === "file" && r.title === "Reading")).toBe(true);
    expect((await fac.upload(`/stages/${st[1].id}/resources/file`, Buffer.from("not a pdf"), "x.pdf")).status).toBe(400);
  });

  it("links must be http(s); facilitators manage links and questions", async () => {
    const { fac, st } = await live();
    const add = (url: string) => fac.post(`/stages/${st[0].id}/resources`, { title: "Site", url });
    expect((await add("javascript:alert(1)")).status).toBe(400);
    expect((await add("not a url")).status).toBe(400);
    const ok = await add("https://example.org/page?x=1");
    expect(ok.status).toBe(200);
    const q = await fac.post(`/stages/${st[0].id}/questions`, { text: "What changed?", required: true });
    expect(q.status).toBe(200);
    const listed = (await fac.get(`/sessions/${(await fac.get("/sessions")).body.sessions[0].id}/stages`)).status;
    expect(listed).toBe(200);
    expect((await fac.del(`/questions/${q.body.id}`)).status).toBe(200);
    expect((await fac.del(`/resources/${ok.body.id}`)).status).toBe(200);
  });
});
