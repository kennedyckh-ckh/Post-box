import { describe, it, expect, beforeAll } from "vitest";
import { Client, adminClient, newFacilitator, newSession, joinAs } from "./helpers";
import { db } from "@/lib/db";

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
const publish = (fac: Client, sid: string, sourceId: string, labelMode = "anonymous", sourceType = "entry") => fac.post(`/sessions/${sid}/publications`, { sourceType, sourceId, labelMode });

const chunk = (t: string, d: Buffer) => { const l = Buffer.alloc(4); l.writeUInt32BE(d.length); return Buffer.concat([l, Buffer.from(t, "latin1"), d, Buffer.alloc(4)]); };
const PNG = Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), chunk("IHDR", Buffer.alloc(13)), chunk("IDAT", Buffer.from([1])), chunk("IEND", Buffer.alloc(0))]);

/** Two groups with named people and one private entry each. */
async function world() {
  const x = await live();
  const ann = await joinAs(x.s, "Annabel Wong", { group: 0 });
  const xia = await joinAs(x.s, "Xavier Chan", { group: 1 });
  const e1 = (await ann.c.post(`/stages/${x.st[0].id}/entries`, entry("The published idea", { tags: ["Claim"] }))).body.entry;
  const e2 = (await xia.c.post(`/stages/${x.st[0].id}/entries`, entry("Xavier's private idea"))).body.entry;
  return { ...x, ann, xia, e1, e2 };
}
const FORBIDDEN = (w: { s: { groups: { id: string; name: string }[] }; e1: { id: string }; ann: { r: { body: { participantId: string } } } }) => ["Annabel", "Wong", w.s.groups[0].name, w.s.groups[0].id, w.e1.id, w.ann.r.body.participantId];

describe("publishing and snapshots", () => {
  it("nothing is visible to other groups before the facilitator publishes it, and releasing a stage publishes nothing", async () => {
    const w = await world();
    expect((await w.xia.c.get("/board")).body.items).toEqual([]);
    await w.fac.patch(`/stages/${w.st[1].id}`, { availability: "open", proceedReason: "test" });
    expect((await w.xia.c.get("/board")).body.items).toEqual([]);
    expect(JSON.stringify((await w.xia.c.get(`/stages/${w.st[0].id}/entries`)).body)).not.toContain("The published idea");
  });

  it("publishes a frozen snapshot: later edits stay private until republished, and the facilitator is told it differs", async () => {
    const w = await world();
    const pub = (await publish(w.fac, w.s.id, w.e1.id)).body.id;
    expect((await w.xia.c.get("/board")).body.items[0].entries[0].body).toBe("The published idea");
    await w.ann.c.patch(`/entries/${w.e1.id}`, { ...entry("The REVISED idea"), baseVersion: 1 });
    // class still sees the published version
    expect((await w.xia.c.get("/board")).body.items[0].entries[0].body).toBe("The published idea");
    let list = (await w.fac.get(`/sessions/${w.s.id}/publications`)).body.items;
    expect(list[0].differsFromSource).toBe(true);
    // republish updates the frozen copy and keeps the same label
    const again = await publish(w.fac, w.s.id, w.e1.id);
    expect(again.body.id).toBe(pub);
    expect((await w.xia.c.get("/board")).body.items[0].entries[0].body).toBe("The REVISED idea");
    list = (await w.fac.get(`/sessions/${w.s.id}/publications`)).body.items;
    expect(list[0].differsFromSource).toBe(false);
    expect(list[0].labelNo).toBe(1);
  });

  it("unpublishing removes access through the application", async () => {
    const w = await world();
    await w.ann.c.post(`/stages/${w.st[0].id}/uploads`, PNG).catch(() => null);
    const pub = (await publish(w.fac, w.s.id, w.e1.id)).body.id;
    expect((await w.xia.c.get("/board")).body.items.length).toBe(1);
    await w.fac.post(`/publications/${pub}/present`, { present: true });
    const link = (await w.fac.post(`/sessions/${w.s.id}/presentation/link`)).body.token;
    expect((await new Client().get(`/present/${link}`)).body.items.length).toBe(1);
    expect((await w.fac.post(`/publications/${pub}/unpublish`)).status).toBe(200);
    expect((await w.xia.c.get("/board")).body.items).toEqual([]);
    expect((await new Client().get(`/present/${link}`)).body.items).toEqual([]);
    expect((await w.xia.c.post("/reactions", { targetType: "publication", targetId: pub, type: "like", on: true })).status).toBe(404);
    expect((await w.fac.post(`/publications/${pub}/present`, { present: true })).status).toBe(409);
    const status = (await w.fac.get(`/sessions/${w.s.id}/publications`)).body.items[0].status;
    expect(status).toBe("unpublished");
    // other facilitators cannot publish or unpublish
    const other = await newFacilitator(admin);
    expect((await other.post(`/publications/${pub}/unpublish`)).status).toBe(404);
    expect((await publish(other, w.s.id, w.e1.id)).status).toBe(404);
  });

  it("a participant cannot publish, and cannot publish an item of another session", async () => {
    const w = await world();
    expect((await w.ann.c.post(`/sessions/${w.s.id}/publications`, { sourceType: "entry", sourceId: w.e1.id })).status).toBe(401);
    const w2 = await world();
    expect((await publish(w.fac, w.s.id, w2.e1.id)).status).toBe(404);
  });

  it("can publish a group submission", async () => {
    const w = await world();
    const q = w.st[0].questions[0].id;
    await w.ann.c.post(`/stages/${w.st[0].id}/entries`, entry("answer", { questionId: q }));
    expect((await w.ann.c.post(`/stages/${w.st[0].id}/submit`, { confirm: true })).status).toBe(200);
    const sub = (await w.fac.get(`/sessions/${w.s.id}/submissions`)).body.submissions[0];
    const r = await publish(w.fac, w.s.id, sub.id, "group", "submission");
    expect(r.status).toBe(200);
    const item = (await w.xia.c.get("/board")).body.items[0];
    expect(item.kind).toBe("submission");
    expect(item.label).toBe(w.s.groups[0].name);
    expect(JSON.stringify(item)).not.toContain("Annabel");
  });
});

describe("anonymity", () => {
  it("anonymous items carry no names, groups or ids of people or sources, on the board or the projector", async () => {
    const w = await world();
    const pub = (await publish(w.fac, w.s.id, w.e1.id, "anonymous")).body.id;
    await w.fac.post(`/publications/${pub}/present`, { present: true });
    const token = (await w.fac.post(`/sessions/${w.s.id}/presentation/link`)).body.token;
    const board = (await w.xia.c.get("/board")).body;
    const proj = (await new Client().get(`/present/${token}`)).body;
    expect(board.items[0].label).toBe("Sample Response 1");
    expect(proj.items[0].label).toBe("Sample Response 1");
    for (const dump of [JSON.stringify(board), JSON.stringify(proj)]) for (const bad of FORBIDDEN(w)) expect(dump).not.toContain(bad);
    // the facilitator still sees who wrote it
    const fac = (await w.fac.get(`/sessions/${w.s.id}/publications`)).body.items[0];
    expect(fac.internal.authors[0].name).toBe("Annabel Wong");
    expect(fac.internal.groupName).toBe(w.s.groups[0].name);
  });

  it("group labels show only the group, never the author; the toggle changes everything already shared", async () => {
    const w = await world();
    await publish(w.fac, w.s.id, w.e1.id, "group");
    let item = (await w.xia.c.get("/board")).body.items[0];
    expect(item.label).toBe(w.s.groups[0].name);
    expect(JSON.stringify(item)).not.toContain("Annabel");
    expect((await w.fac.post(`/sessions/${w.s.id}/label-mode`, { mode: "anonymous" })).status).toBe(200);
    item = (await w.xia.c.get("/board")).body.items[0];
    expect(item.label).toBe("Sample Response 1");
    expect(JSON.stringify(item)).not.toContain(w.s.groups[0].name);
  });

  it("anonymous labels are consistent: a republished item keeps its number and new items continue the count", async () => {
    const w = await world();
    const e3 = (await w.ann.c.post(`/stages/${w.st[0].id}/entries`, entry("second"))).body.entry;
    await publish(w.fac, w.s.id, w.e1.id);
    await publish(w.fac, w.s.id, e3.id);
    await publish(w.fac, w.s.id, w.e1.id); // republish
    const labels = (await w.xia.c.get("/board")).body.items.map((i: { label: string }) => i.label);
    expect(labels).toEqual(["Sample Response 1", "Sample Response 2"]);
  });

  it("pictures in shared items are visible to the class under a generic file name, and only while shared", async () => {
    const x = await live({ template: "blank" });
    await x.fac.patch(`/stages/${x.st[0].id}`, { contributionTypes: ["text", "image"] });
    const ann = await joinAs(x.s, "Annabel Wong", { group: 0 });
    const xia = await joinAs(x.s, "Xavier Chan", { group: 1 });
    const up = (await ann.c.upload(`/stages/${x.st[0].id}/uploads`, PNG, "Annabel-selfie-at-home.png")).body.attachment;
    const e = (await ann.c.post(`/stages/${x.st[0].id}/entries`, entry("see picture", { attachmentId: up.id }))).body.entry;
    expect((await xia.c.get(`/attachments/${up.id}`)).status).toBe(404);
    const pub = (await publish(x.fac, x.s.id, e.id)).body.id;
    const dl = await xia.c.get(`/attachments/${up.id}`);
    expect(dl.status).toBe(200);
    expect(dl.headers["content-disposition"]).toBe('inline; filename="image.png"');
    expect(JSON.stringify((await xia.c.get("/board")).body)).not.toContain("Annabel");
    // projector gets the picture only for items approved for it
    const token = (await x.fac.post(`/sessions/${x.s.id}/presentation/link`)).body.token;
    expect((await new Client().get(`/present/${token}/attachments/${up.id}`)).status).toBe(404);
    await x.fac.post(`/publications/${pub}/present`, { present: true });
    expect((await new Client().get(`/present/${token}/attachments/${up.id}`)).status).toBe(200);
    await x.fac.post(`/publications/${pub}/unpublish`);
    expect((await xia.c.get(`/attachments/${up.id}`)).status).toBe(404);
    expect((await new Client().get(`/present/${token}/attachments/${up.id}`)).status).toBe(404);
  });
});

describe("projector view", () => {
  it("needs the secret link, shows only items approved for it, and the link can be replaced or revoked", async () => {
    const w = await world();
    const e3 = (await w.ann.c.post(`/stages/${w.st[0].id}/entries`, entry("published but not for the projector"))).body.entry;
    const p1 = (await publish(w.fac, w.s.id, w.e1.id)).body.id;
    await publish(w.fac, w.s.id, e3.id);
    await w.fac.post(`/publications/${p1}/present`, { present: true });
    const t1 = (await w.fac.post(`/sessions/${w.s.id}/presentation/link`)).body.token;
    const proj = (await new Client().get(`/present/${t1}`)).body;
    expect(proj.items.length).toBe(1);
    expect(JSON.stringify(proj)).not.toContain("not for the projector");
    expect(JSON.stringify(proj)).not.toContain("Xavier's private idea"); // unshared work never appears
    expect(JSON.stringify(proj)).not.toMatch(/joinCode|pin|recovery|email|scrypt/i);
    expect((await new Client().get("/present/not-a-real-token")).status).toBe(404);
    const t2 = (await w.fac.post(`/sessions/${w.s.id}/presentation/link`)).body.token;
    expect((await new Client().get(`/present/${t1}`)).status).toBe(404);
    expect((await new Client().get(`/present/${t2}`)).status).toBe(200);
    await w.fac.post(`/sessions/${w.s.id}/presentation/revoke`);
    expect((await new Client().get(`/present/${t2}`)).status).toBe(404);
    // only the owning facilitators control it
    const other = await newFacilitator(admin);
    expect((await other.post(`/sessions/${w.s.id}/presentation/link`)).status).toBe(404);
  });

  it("summaries and discussion questions stay hidden until separately switched on", async () => {
    const w = await world();
    const token = (await w.fac.post(`/sessions/${w.s.id}/presentation/link`)).body.token;
    const p = (await new Client().get(`/present/${token}`)).body;
    expect(p.summaries).toEqual([]);
    expect(p.questions).toEqual([]);
    expect((await w.fac.post(`/sessions/${w.s.id}/presentation`, { showSummaries: true })).status).toBe(200);
    // a question that does not exist cannot be revealed
    expect((await w.fac.post(`/sessions/${w.s.id}/presentation`, { revealQuestion: { id: "q1", revealed: true } })).status).toBe(400);
    expect((await w.fac.get(`/sessions/${w.s.id}/presentation`)).body.revealedQuestions).toEqual([]);
  });
});

describe("reactions", () => {
  it("one reaction of each type per person, harmless repeats, removable, and only on allowed targets", async () => {
    const w = await world();
    const pub = (await publish(w.fac, w.s.id, w.e1.id)).body.id;
    const react = (c: Client, id: string, on = true, type = "like", targetType = "publication") => c.post("/reactions", { targetType, targetId: id, type, on });
    await Promise.all([1, 2, 3, 4].map(() => react(w.xia.c, pub)));
    let s = (await react(w.xia.c, pub)).body.summary;
    expect(s.counts).toEqual({ like: 1 });
    expect(s.mine).toEqual(["like"]);
    await react(w.xia.c, pub, true, "heart");
    expect((await react(w.ann.c, pub)).body.summary.counts.like).toBe(2);
    s = (await react(w.xia.c, pub, false)).body.summary;
    expect(s.counts).toEqual({ like: 1, heart: 1 });
    expect((await react(w.xia.c, pub, true, "party")).status).toBe(400);
    // across groups: published only. Another group's private entry cannot be reacted to.
    expect((await react(w.xia.c, w.e1.id, true, "like", "entry")).status).toBe(404);
    // inside the group: allowed
    const mate = await joinAs(w.s, "Mate", { group: 0 });
    expect((await react(mate.c, w.e1.id, true, "like", "entry")).status).toBe(200);
    expect((await react(mate.c, w.e1.id, true, "like", "entry")).body.summary.counts).toEqual({ like: 1 });
    // switched off
    const cfg = (await w.fac.get(`/sessions/${w.s.id}`)).body.session.reactionConfig;
    await w.fac.patch(`/sessions/${w.s.id}`, { reactionConfig: { ...cfg, enabled: false } });
    expect((await react(w.xia.c, pub)).body.error.code).toBe("reactions_off");
  });

  it("scope can limit reactions to the group or to shared items, and reaction types are configurable", async () => {
    const w = await world();
    const pub = (await publish(w.fac, w.s.id, w.e1.id)).body.id;
    const cfg = (await w.fac.get(`/sessions/${w.s.id}`)).body.session.reactionConfig;
    await w.fac.patch(`/sessions/${w.s.id}`, { reactionConfig: { enabled: true, scope: "group", types: [{ key: "like", label: "Like" }, { label: "Curious" }] } });
    expect((await w.xia.c.post("/reactions", { targetType: "publication", targetId: pub, type: "like", on: true })).body.error.code).toBe("reactions_scope");
    await w.fac.patch(`/sessions/${w.s.id}`, { reactionConfig: { ...cfg, scope: "published" } });
    expect((await w.xia.c.post("/reactions", { targetType: "publication", targetId: pub, type: "like", on: true })).status).toBe(200);
    expect((await w.fac.patch(`/sessions/${w.s.id}`, { reactionConfig: { enabled: true, scope: "both", types: Array.from({ length: 7 }, (_, i) => ({ label: `T${i}` })) } })).status).toBe(400);
  });

  it("sorts by total or by one type, with a stable order for ties", async () => {
    const w = await world();
    const mk = async (t: string) => (await w.ann.c.post(`/stages/${w.st[0].id}/entries`, entry(t))).body.entry.id as string;
    const [a, b, c] = [await mk("A"), await mk("B"), await mk("C")];
    const pa = (await publish(w.fac, w.s.id, a)).body.id;
    const pb = (await publish(w.fac, w.s.id, b)).body.id;
    const pc = (await publish(w.fac, w.s.id, c)).body.id;
    const r = (id: string, type: string, c: Client = w.xia.c) => c.post("/reactions", { targetType: "publication", targetId: id, type, on: true });
    await r(pb, "like"); await r(pb, "heart"); await r(pc, "heart"); await r(pc, "thumbs", w.ann.c); await r(pa, "like", w.ann.c);
    const order = async (sort: string) => (await w.fac.get(`/sessions/${w.s.id}/publications?sort=${sort}`)).body.items.map((i: { id: string }) => i.id);
    expect(await order("reactions")).toEqual([pb, pc, pa]); // 2, 2, 1: tie between B and C keeps publication order
    expect(await order("type:heart")).toEqual([pb, pc, pa]);
    expect(await order("type:like")).toEqual([pa, pb, pc].sort((x, y) => ({ [pa]: 1, [pb]: 1, [pc]: 0 }[y] ?? 0) - ({ [pa]: 1, [pb]: 1, [pc]: 0 }[x] ?? 0) || [pa, pb, pc].indexOf(x) - [pa, pb, pc].indexOf(y)));
    expect(await order("reactions")).toEqual(await order("reactions")); // repeatable
    const note = (await w.fac.get(`/sessions/${w.s.id}/publications`)).body.note;
    expect(note).toMatch(/engagement, not whether an answer is correct/);
  });
});

describe("structured peer responses", () => {
  const say = (c: Client, targetType: string, targetId: string, body: string, promptKey = "clarify") => c.post("/comments", { targetType, targetId, promptKey, body });

  it("inside a group: shown with the author's name, kept apart from the entry, and not allowed on your own entry", async () => {
    const w = await world();
    const mate = await joinAs(w.s, "Mate Lee", { group: 0 });
    expect((await say(w.ann.c, "entry", w.e1.id, "self")).status).toBe(400);
    expect((await say(mate.c, "entry", w.e1.id, "What do you mean by that?", "bogus")).status).toBe(400);
    const r = await say(mate.c, "entry", w.e1.id, "What do you mean by that?", "clarify");
    expect(r.body.status).toBe("approved");
    const list = (await w.ann.c.get(`/stages/${w.st[0].id}/entries`)).body;
    expect(list.entries[0].body).toBe("The published idea"); // original untouched
    expect(list.engagement.byEntry[w.e1.id].comments[0]).toMatchObject({ author: "Mate Lee", body: "What do you mean by that?", promptKey: "clarify" });
    // another group's member cannot comment on or see it
    expect((await say(w.xia.c, "entry", w.e1.id, "peek")).status).toBe(404);
    const row = db().prepare("SELECT author_id FROM peer_comments WHERE id=?").get(r.body.id) as { author_id: string };
    expect(row.author_id).toBe(mate.r.body.participantId); // internal authorship kept
  });

  it("on shared items: anonymous follows the item's setting, and approval can be required", async () => {
    const w = await world();
    const pub = (await publish(w.fac, w.s.id, w.e1.id, "anonymous")).body.id;
    const cfg = (await w.fac.get(`/sessions/${w.s.id}`)).body.session.critiqueConfig;
    await w.fac.patch(`/sessions/${w.s.id}`, { critiqueConfig: { ...cfg, requireApproval: true } });
    const r = await say(w.xia.c, "publication", pub, "Is there evidence for this?", "evidence");
    expect(r.body.status).toBe("pending");
    // author sees it (waiting); the class and the original group do not
    const mine = (await w.xia.c.get("/board")).body.items[0].comments;
    expect(mine.length).toBe(1);
    expect(mine[0].status).toBe("pending");
    expect((await w.ann.c.get("/board")).body.items[0].comments).toEqual([]);
    // facilitator approves
    const pending = (await w.fac.get(`/sessions/${w.s.id}/comments?status=pending`)).body.comments;
    expect(pending[0].authorName).toBe("Xavier Chan"); // internal authorship visible to the facilitator only
    expect((await w.fac.post(`/comments/${r.body.id}/moderate`, { status: "approved" })).status).toBe(200);
    const seen = (await w.ann.c.get("/board")).body.items[0].comments[0];
    expect(seen.author).toBe("A peer");
    expect(JSON.stringify(seen)).not.toContain("Xavier");
    // group labels show the commenter's group instead
    await w.fac.post(`/sessions/${w.s.id}/label-mode`, { mode: "group" });
    expect((await w.ann.c.get("/board")).body.items[0].comments[0].author).toBe(w.s.groups[1].name);
    // hide
    expect((await w.fac.post(`/comments/${r.body.id}/moderate`, { status: "hidden" })).status).toBe(200);
    expect((await w.ann.c.get("/board")).body.items[0].comments).toEqual([]);
    // other facilitators cannot moderate
    const other = await newFacilitator(admin);
    expect((await other.post(`/comments/${r.body.id}/moderate`, { status: "approved" })).status).toBe(404);
    // a participant can withdraw their own, not someone else's
    expect((await w.ann.c.del(`/comments/${r.body.id}`)).status).toBe(404);
    expect((await w.xia.c.del(`/comments/${r.body.id}`)).status).toBe(200);
  });

  it("custom prompts and an off switch are respected", async () => {
    const w = await world();
    const pub = (await publish(w.fac, w.s.id, w.e1.id)).body.id;
    await w.fac.patch(`/sessions/${w.s.id}`, { critiqueConfig: { enabled: true, scope: "published", requireApproval: false, prompts: [{ key: "next", label: "What would you try next?", enabled: true }] } });
    expect((await say(w.xia.c, "publication", pub, "hi", "clarify")).status).toBe(400);
    expect((await say(w.xia.c, "publication", pub, "Try a bigger sample", "next")).status).toBe(200);
    const mate = await joinAs(w.s, "Mate", { group: 0 });
    expect((await say(mate.c, "entry", w.e1.id, "x", "next")).body.error.code).toBe("critique_scope");
    await w.fac.patch(`/sessions/${w.s.id}`, { critiqueConfig: { enabled: false, scope: "both", requireApproval: false, prompts: [] } });
    expect((await say(w.xia.c, "publication", pub, "x", "next")).body.error.code).toBe("critique_off");
  });
});

describe("export", () => {
  async function exportWorld() {
    const w = await world();
    await w.ann.c.post(`/stages/${w.st[0].id}/entries`, { kind: "table", body: "=SUM(A1)", table: { columns: ["Trial", "Value"], rows: [["1", "4.2"], ["2", "+evil"]] }, tags: ["Example"] });
    await w.ann.c.post(`/stages/${w.st[0].id}/entries`, entry("陳大文的答案"));
    await w.fac.patch(`/groups/${w.s.groups[0].id}`, { pin: "9999", name: "Quokkas" });
    return w;
  }

  it("identified exports carry names; de-identified ones carry pseudonyms; neither carries secrets", async () => {
    const w = await exportWorld();
    const ident = (await w.fac.get(`/sessions/${w.s.id}/export?format=json&identified=true`)).raw!.toString("utf8");
    const anon = (await w.fac.get(`/sessions/${w.s.id}/export?format=json&identified=false`)).raw!.toString("utf8");
    expect(ident).toContain("Annabel Wong");
    expect(anon).not.toContain("Annabel");
    expect(anon).not.toContain("Wong");
    expect(anon).not.toContain("Quokkas");
    expect(ident).toContain("Quokkas");
    expect(anon).toMatch(/P001/);
    expect(anon).toMatch(/"G1"/);
    for (const dump of [ident, anon]) {
      expect(dump).not.toContain("scrypt$");
      expect(dump).not.toContain("9999");
      expect(dump).not.toContain(w.s.code);
      expect(dump).not.toContain(w.ann.r.body.recoveryCode);
      expect(dump).not.toMatch(/recovery_lookup|password_hash|pin_hash|token_hash/);
    }
    // the three sections are separate, structured tables are preserved, and Chinese is intact
    const j = JSON.parse(ident);
    expect(Object.keys(j)).toEqual(expect.arrayContaining(["participantContent", "facilitatorContent", "aiContent"]));
    const tbl = j.participantContent.entries.find((e: { kind: string }) => e.kind === "table");
    expect(tbl.table).toEqual({ columns: ["Trial", "Value"], rows: [["1", "4.2"], ["2", "+evil"]] });
    expect(j.participantContent.entries.some((e: { body: string }) => e.body === "陳大文的答案")).toBe(true);
    expect(j.participantContent.entries[0]).toHaveProperty("entryId");
    expect(j.participantContent.entries[0]).toHaveProperty("createdAt");
    expect(j.facilitatorContent.stages.length).toBe(3);
    expect(j.aiContent.drafts).toEqual([]);
  });

  it("CSV is UTF-8 with a byte-order mark, quotes properly and neutralises spreadsheet formulas", async () => {
    const w = await exportWorld();
    const r = await w.fac.get(`/sessions/${w.s.id}/export?format=csv&identified=true&table=entries`);
    const csv = r.raw!.toString("utf8");
    expect(csv.charCodeAt(0)).toBe(0xfeff);
    expect(r.headers["content-type"]).toContain("text/csv");
    expect(csv).toContain("陳大文的答案");
    expect(csv).toContain("'=SUM(A1)"); // would otherwise run as a formula in Excel
    expect(csv).not.toMatch(/(^|,)=SUM/m);
    expect(csv.split("\r\n")[0]).toContain("entryId");
    expect((await w.fac.get(`/sessions/${w.s.id}/export?format=csv&table=nonsense`)).status).toBe(400);
  });

  it("only facilitators of the session can export, and every export is recorded", async () => {
    const w = await exportWorld();
    const other = await newFacilitator(admin);
    expect((await other.get(`/sessions/${w.s.id}/export?format=json&identified=true`)).status).toBe(404);
    expect((await w.ann.c.get(`/sessions/${w.s.id}/export?format=json&identified=true`)).status).toBe(401);
    expect((await new Client().get(`/sessions/${w.s.id}/export?format=json`)).status).toBe(401);
    await w.fac.get(`/sessions/${w.s.id}/export?format=json&identified=true`);
    const n = db().prepare("SELECT COUNT(*) AS c FROM audit_log WHERE session_id=? AND action='export_downloaded'").get(w.s.id) as { c: number };
    expect(n.c).toBeGreaterThanOrEqual(1);
  });
});
