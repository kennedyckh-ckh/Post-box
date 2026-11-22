import { describe, it, expect } from "vitest";
import { execFile } from "node:child_process";
import path from "node:path";
import { adminClient, newFacilitator, newSession } from "./helpers";
import { db } from "@/lib/db";

function attempt(code: string, groupId: string, name: string): Promise<{ status: number; code: string | null }> {
  return new Promise((resolve) => {
    execFile(
      path.join(process.cwd(), "node_modules/.bin/tsx"),
      ["scripts/join-race.ts", code, groupId, name],
      { env: { ...process.env }, cwd: process.cwd() },
      (_err, stdout) => {
        const line = stdout.trim().split("\n").pop() || "{}";
        try {
          resolve(JSON.parse(line));
        } catch {
          resolve({ status: 0, code: line });
        }
      }
    );
  });
}

describe("seat caps under simultaneous joins", () => {
  it("12 separate processes race for 5 seats: exactly 5 get in, the rest are told the group is full", async () => {
    const admin = await adminClient();
    const fac = await newFacilitator(admin);
    const s = await newSession(fac, { groupCount: 2 });
    await fac.patch(`/groups/${s.groups[0].id}`, { seatCap: 5 });
    await fac.post(`/sessions/${s.id}/start`);
    db().pragma("wal_checkpoint(TRUNCATE)");
    const results = await Promise.all(Array.from({ length: 12 }, (_, i) => attempt(s.code, s.groups[0].id, `Racer ${i}`)));
    const ok = results.filter((r) => r.status === 200).length;
    const full = results.filter((r) => r.status === 409 && r.code === "group_full").length;
    const other = results.filter((r) => ![200, 409].includes(r.status));
    expect(other).toEqual([]);
    expect(ok).toBe(5);
    expect(full).toBe(7);
    const n = db().prepare("SELECT COUNT(*) AS c FROM participants WHERE group_id=? AND status='active'").get(s.groups[0].id) as { c: number };
    expect(n.c).toBe(5);
  }, 120000);
});
