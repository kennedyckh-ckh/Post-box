import { handle } from "@/lib/handlers";
import type { Req } from "@/lib/router";

export interface Resp {
  status: number;
  body: any; // eslint-disable-line @typescript-eslint/no-explicit-any
  headers: Record<string, string>;
  raw?: Buffer;
}

/** A tiny browser: keeps cookies between calls and talks to the same handler the web server uses. */
export class Client {
  jar = new Map<string, string>();
  constructor(public ip = "10.0.0.1") {}

  clone(ip?: string): Client {
    const c = new Client(ip ?? this.ip);
    this.jar.forEach((v, k) => c.jar.set(k, v));
    return c;
  }

  async upload(path: string, data: Buffer, filename = "file"): Promise<Resp> {
    return this.call("POST", path, undefined, { "content-type": "application/octet-stream", "x-filename": filename }, data);
  }

  async call(method: string, path: string, body?: unknown, extraHeaders: Record<string, string> = {}, raw?: Buffer): Promise<Resp> {
    const [p, q] = path.split("?");
    const query: Record<string, string> = {};
    if (q) new URLSearchParams(q).forEach((v, k) => (query[k] = v));
    const headers: Record<string, string> = { "x-forwarded-for": this.ip, host: "localhost:3000", ...extraHeaders };
    if (body !== undefined) headers["content-type"] = "application/json";
    const req: Req = {
      method,
      path: p,
      query,
      headers,
      cookies: Object.fromEntries(this.jar),
      body,
      raw,
    };
    const res = await handle(req);
    for (const c of res.cookies) {
      const [pair] = c.split(";");
      const i = pair.indexOf("=");
      const name = pair.slice(0, i);
      const value = pair.slice(i + 1);
      if (!value || /Max-Age=0/.test(c)) this.jar.delete(name);
      else this.jar.set(name, value);
    }
    return { status: res.status, body: JSON.parse(JSON.stringify(res.body)), headers: res.headers || {}, raw: res.rawBody };
  }
  get = (p: string) => this.call("GET", p);
  post = (p: string, b: unknown = {}) => this.call("POST", p, b);
  patch = (p: string, b: unknown) => this.call("PATCH", p, b);
  del = (p: string, b?: unknown) => this.call("DELETE", p, b);
  put = (p: string, b: unknown) => this.call("PUT", p, b);
}

export const ADMIN = { email: "admin@example.org", first: "first-password-123", next: "a-much-better-password" };

/** Admin signed in with a fresh password (first sign-in forces a change). */
export async function adminClient(ip = "10.0.0.2"): Promise<Client> {
  const c = new Client(ip);
  let r = await c.post("/auth/login", { email: ADMIN.email, password: ADMIN.next });
  if (r.status !== 200) {
    r = await c.post("/auth/login", { email: ADMIN.email, password: ADMIN.first });
    if (r.status !== 200) throw new Error("admin login failed: " + JSON.stringify(r.body));
    const ch = await c.post("/auth/change-password", { currentPassword: ADMIN.first, newPassword: ADMIN.next });
    if (ch.status !== 200) throw new Error("admin change failed: " + JSON.stringify(ch.body));
  }
  return c;
}

let counter = 0;
/** A new facilitator account, signed in and ready. */
export async function newFacilitator(admin: Client, name = "Fac"): Promise<Client> {
  const email = `fac${++counter}-${Date.now()}@example.org`;
  const r = await admin.post("/admin/users", { email, name: `${name} ${counter}` });
  if (r.status !== 200) throw new Error("create facilitator failed: " + JSON.stringify(r.body));
  const c = new Client(`10.1.0.${counter}`);
  const l = await c.post("/auth/login", { email, password: r.body.temporaryPassword });
  if (l.status !== 200) throw new Error("fac login failed");
  const ch = await c.post("/auth/change-password", { currentPassword: r.body.temporaryPassword, newPassword: "facilitator-pass-1" });
  if (ch.status !== 200) throw new Error("fac change failed");
  (c as unknown as { email: string }).email = email;
  return c;
}

export async function newSession(fac: Client, extra: Record<string, unknown> = {}) {
  const r = await fac.post("/sessions", { title: "Test session", groupCount: 3, ...extra });
  if (r.status !== 200) throw new Error("create session failed: " + JSON.stringify(r.body));
  const d = await fac.get(`/sessions/${r.body.id}`);
  return { id: r.body.id as string, code: d.body.session.joinCode as string, groups: d.body.groups as { id: string; name: string }[], stages: d.body.stages as { id: string }[] };
}

let pcount = 0;
export async function joinAs(session: { code: string; groups: { id: string }[] }, name: string, opts: { group?: number; pin?: string; extra?: Record<string, string> } = {}) {
  const c = new Client(`10.2.${Math.floor(++pcount / 250)}.${pcount % 250}`);
  const r = await c.post("/join", { joinCode: session.code, displayName: name, groupId: session.groups[opts.group ?? 0].id, pin: opts.pin, extra: opts.extra });
  // Joining no longer returns the recovery code; the participant looks it up afterwards. Older tests read it from r.body.
  if (r.status === 200) {
    if ("recoveryCode" in r.body) throw new Error("join must not return the recovery code");
    r.body.recoveryCode = (await c.get("/me/recovery-code")).body.recoveryCode;
  }
  return { c, r };
}
