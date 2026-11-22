/**
 * One process = one browser trying to join the same group. Run many at once against the same database file
 * to prove the seat cap holds across separate connections (see tests/race.test.ts).
 * usage: DATA_DIR=... tsx scripts/join-race.ts <joinCode> <groupId> <name>
 */
import { handle } from "../lib/handlers";

async function main() {
  const [code, groupId, name] = process.argv.slice(2);
  const res = await handle({
    method: "POST",
    path: "/join",
    query: {},
    headers: { "content-type": "application/json", host: "localhost", "x-forwarded-for": `10.200.0.${Math.floor(Math.random() * 250)}` },
    cookies: {},
    body: { joinCode: code, displayName: name, groupId },
  });
  console.log(JSON.stringify({ status: res.status, code: (res.body as { error?: { code: string } }).error?.code ?? null }));
}
main().catch((e) => {
  console.log(JSON.stringify({ status: 500, code: String(e.message) }));
});
