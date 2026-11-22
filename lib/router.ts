export class HttpError extends Error {
  constructor(public status: number, public code: string, message: string, public extra?: Record<string, unknown>) {
    super(message);
  }
}
export const badRequest = (m: string, code = "bad_request") => new HttpError(400, code, m);
export const unauthenticated = (m = "Please sign in.") => new HttpError(401, "unauthenticated", m);
export const forbidden = (m = "You do not have access to this.", code = "forbidden") => new HttpError(403, code, m);
export const notFound = (m = "Not found") => new HttpError(404, "not_found", m);
export const conflict = (m: string, code = "conflict") => new HttpError(409, code, m);
export const tooMany = (m: string, retryAfterSec: number) => new HttpError(429, "rate_limited", m, { retryAfterSec });

export interface Req {
  method: string;
  path: string; // without the /api prefix, no query
  query: Record<string, string>;
  headers: Record<string, string>;
  cookies: Record<string, string>;
  body: unknown;
  raw?: Buffer; // set for upload routes
}
export interface Res {
  status: number;
  body: unknown;
  headers?: Record<string, string>;
  cookies: string[];
  rawBody?: Buffer;
}
export interface Ctx {
  req: Req;
  params: Record<string, string>;
  ip: string;
  cookiesOut: string[];
  /** per-request cache for resolved identities */
  cache: Record<string, unknown>;
  headersOut: Record<string, string>;
  rawOut?: Buffer;
}
export type Handler = (ctx: Ctx) => unknown | Promise<unknown>;

interface Route {
  method: string;
  parts: string[];
  handler: Handler;
  raw: boolean;
}
const routes: Route[] = [];

export function route(method: string, pattern: string, handler: Handler, opts: { raw?: boolean } = {}) {
  routes.push({ method, parts: pattern.split("/").filter(Boolean), handler, raw: !!opts.raw });
}

function match(r: Route, parts: string[]): Record<string, string> | null {
  if (r.parts.length !== parts.length) return null;
  const params: Record<string, string> = {};
  for (let i = 0; i < parts.length; i++) {
    if (r.parts[i].startsWith(":")) params[r.parts[i].slice(1)] = decodeURIComponent(parts[i]);
    else if (r.parts[i] !== parts[i]) return null;
  }
  return params;
}

export function listRoutes(): { method: string; path: string; raw: boolean }[] {
  return routes.map((r) => ({ method: r.method, path: "/" + r.parts.join("/"), raw: r.raw }));
}

export function clientIp(headers: Record<string, string>): string {
  if (process.env.TRUST_PROXY === "1") {
    const xf = headers["x-forwarded-for"];
    if (xf) return xf.split(",")[0].trim() || "unknown";
  }
  return "direct";
}

export function isRawRoute(method: string, path: string): boolean {
  const parts = path.split("/").filter(Boolean);
  return routes.some((r) => r.method === method && r.raw && match(r, parts));
}

export function cookie(name: string, value: string, maxAgeSec: number): string {
  const secure = process.env.COOKIE_SECURE === "1" ? "; Secure" : "";
  return `${name}=${value}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${maxAgeSec}${secure}`;
}

function sameOrigin(headers: Record<string, string>): boolean {
  const origin = headers["origin"];
  if (!origin) return true; // same-origin fetches from older browsers, curl, tests
  const host = process.env.PUBLIC_HOST || headers["x-forwarded-host"] || headers["host"];
  try {
    return new URL(origin).host === host;
  } catch {
    return false;
  }
}

export async function handle(req: Req): Promise<Res> {
  const ctx: Ctx = { req, params: {}, ip: clientIp(req.headers), cookiesOut: [], cache: {}, headersOut: {} };
  try {
    const parts = req.path.split("/").filter(Boolean);
    let found: Route | undefined;
    let pathMatched = false;
    for (const r of routes) {
      const p = match(r, parts);
      if (!p) continue;
      pathMatched = true;
      if (r.method !== req.method) continue;
      found = r;
      ctx.params = p;
      break;
    }
    if (!found) {
      if (pathMatched) throw new HttpError(405, "method_not_allowed", "Method not allowed");
      throw notFound("No such endpoint");
    }
    if (req.method !== "GET") {
      if (!sameOrigin(req.headers)) throw forbidden("Cross-site request blocked.", "cross_site");
      if (!found.raw && req.body !== undefined && req.body !== null) {
        const ct = (req.headers["content-type"] || "").toLowerCase();
        if (!ct.startsWith("application/json")) throw new HttpError(415, "unsupported_media_type", "JSON required.");
      }
    }
    const out = await found.handler(ctx);
    return { status: 200, body: out === undefined ? { ok: true } : out, cookies: ctx.cookiesOut, headers: ctx.headersOut, rawBody: ctx.rawOut };
  } catch (e) {
    if (e instanceof HttpError) {
      const headers: Record<string, string> = { ...ctx.headersOut };
      if (e.status === 429 && typeof e.extra?.retryAfterSec === "number") headers["retry-after"] = String(e.extra.retryAfterSec);
      return { status: e.status, body: { error: { code: e.code, message: e.message, ...(e.extra || {}) } }, cookies: ctx.cookiesOut, headers };
    }
    console.error("Unhandled error:", (e as Error)?.message);
    return { status: 500, body: { error: { code: "server_error", message: "Something went wrong on the server." } }, cookies: [] };
  }
}
