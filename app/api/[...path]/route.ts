import { handle } from "@/lib/handlers";
import { isRawRoute, type Req } from "@/lib/router";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function parseCookies(h: string | null): Record<string, string> {
  const out: Record<string, string> = {};
  for (const part of (h || "").split(";")) {
    const i = part.indexOf("=");
    if (i > 0) out[part.slice(0, i).trim()] = part.slice(i + 1).trim();
  }
  return out;
}

async function run(request: Request, ctx: { params: Promise<{ path: string[] }> }): Promise<Response> {
  const { path } = await ctx.params;
  const url = new URL(request.url);
  const headers: Record<string, string> = {};
  request.headers.forEach((v, k) => (headers[k.toLowerCase()] = v));
  const route = "/" + path.join("/");
  let body: unknown;
  let raw: Buffer | undefined;
  if (request.method !== "GET" && request.method !== "HEAD") {
    if (isRawRoute(request.method, route)) {
      const declared = Number(request.headers.get("content-length") || 0);
      if (declared > 11 * 1024 * 1024) return Response.json({ error: { code: "file_too_large", message: "That file is too large." } }, { status: 413 });
      raw = Buffer.from(await request.arrayBuffer());
      if (raw.length > 11 * 1024 * 1024) return Response.json({ error: { code: "file_too_large", message: "That file is too large." } }, { status: 413 });
    } else {
      const txt = await request.text();
      if (txt.length > 1_000_000) return Response.json({ error: { code: "too_large", message: "Request too large." } }, { status: 413 });
      if (txt) {
        try {
          body = JSON.parse(txt);
        } catch {
          return Response.json({ error: { code: "bad_json", message: "The request was not valid JSON." } }, { status: 400 });
        }
      }
    }
  }
  const req: Req = { method: request.method, path: route, query: Object.fromEntries(url.searchParams), headers, cookies: parseCookies(request.headers.get("cookie")), body, raw };
  const res = await handle(req);
  const out = new Headers(res.headers || {});
  out.set("cache-control", "no-store");
  for (const c of res.cookies) out.append("set-cookie", c);
  if (res.rawBody) return new Response(new Uint8Array(res.rawBody), { status: res.status, headers: out });
  out.set("content-type", "application/json; charset=utf-8");
  return new Response(JSON.stringify(res.body), { status: res.status, headers: out });
}

export const GET = run;
export const POST = run;
export const PATCH = run;
export const PUT = run;
export const DELETE = run;
