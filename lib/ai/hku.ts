import { AiError, type AiProvider, type AiRequest, type AiResult } from "./types";
import { aiSettings } from "./config";

type FetchFn = (url: string, init: RequestInit) => Promise<Response>;
let fetchImpl: FetchFn = (url, init) => fetch(url, init);
/** Tests replace the network call with a fake. Production never calls this. */
export function __setFetchForTests(fn: FetchFn | null) {
  fetchImpl = fn ?? ((url, init) => fetch(url, init));
}
export const __sleep = { fn: (ms: number) => new Promise<void>((r) => setTimeout(r, ms)) };

/** The request URL: the endpoint exactly as configured. api-version is added only if it is configured separately AND not already there. */
export function buildUrl(endpoint: string, apiVersion: string): string {
  const u = new URL(endpoint);
  if (apiVersion && !u.searchParams.has("api-version")) u.searchParams.set("api-version", apiVersion);
  return u.toString();
}

export function buildBody(req: AiRequest, model: string, sendModel: boolean): Record<string, unknown> {
  // chat-completions format. Only options the project owner confirmed are used; no response_format / structured-output option is sent.
  const body: Record<string, unknown> = { messages: req.messages, temperature: 0.2, max_tokens: req.maxTokens };
  if (sendModel) body.model = model;
  return body;
}

const AUTH_MESSAGE = "The AI service did not accept the credentials. Ask the administrator to check HKU_API_KEY in the host settings.";

/** Turns a failed HTTP answer into a typed error. The response body is never copied into the message. */
function httpError(status: number): AiError {
  if (status === 401 || status === 403) return new AiError("ai_auth_error", AUTH_MESSAGE, 502, false, status);
  if (status === 404) return new AiError("ai_endpoint_not_found", "The AI endpoint was not found. Ask the administrator to check HKU_API_ENDPOINT (it must be the complete request URL from the HKU portal).", 502, false, status);
  if (status === 429) return new AiError("ai_rate_limited", "The AI service is busy (rate limit). Try again in a minute.", 503, true, status);
  if (status === 400) return new AiError("ai_bad_request", "The AI service rejected the request. If this keeps happening, ask the administrator to check the AI settings.", 502, false, status);
  if (status >= 500) return new AiError("ai_service_error", "The AI service had a temporary problem. Try again shortly.", 503, true, status);
  return new AiError("ai_unexpected_status", `The AI service answered with an unexpected status (${status}).`, 502, false, status);
}

export const hkuProvider: AiProvider = {
  name: "hku",
  async generate(req: AiRequest): Promise<AiResult> {
    const s = aiSettings();
    const key = (process.env.HKU_API_KEY || "").trim();
    if (!key || !s.endpoint) throw new AiError("ai_not_configured", "Live AI is not set up yet. The administrator needs to set HKU_API_KEY and HKU_API_ENDPOINT on the host.", 503);
    let url: string;
    try {
      url = buildUrl(s.endpoint, s.apiVersion);
    } catch {
      throw new AiError("ai_not_configured", "HKU_API_ENDPOINT is not a valid web address.", 503);
    }
    const body = JSON.stringify(buildBody(req, s.model, s.sendModel));
    const started = Date.now();
    let lastErr: AiError | null = null;
    for (let attempt = 0; attempt <= s.maxRetries; attempt++) {
      if (attempt > 0) await __sleep.fn(s.retryDelayMs * attempt);
      const ctl = new AbortController();
      const timer = setTimeout(() => ctl.abort(), s.timeoutMs);
      try {
        const res = await fetchImpl(url, { method: "POST", headers: { "api-key": key, "content-type": "application/json" }, body, signal: ctl.signal });
        if (!res.ok) {
          const e = httpError(res.status);
          if (e.retryable && attempt < s.maxRetries) {
            const ra = Number(res.headers.get("retry-after"));
            if (Number.isFinite(ra) && ra > 0 && ra <= 10) await __sleep.fn(ra * 1000);
            lastErr = e;
            continue;
          }
          throw e;
        }
        let data: unknown;
        try {
          data = await res.json();
        } catch {
          throw new AiError("ai_bad_response", "The AI service sent a reply that could not be read.", 502, false);
        }
        const d = data as { choices?: { message?: { content?: unknown } }[]; usage?: { prompt_tokens?: number; completion_tokens?: number }; model?: string };
        const content = d?.choices?.[0]?.message?.content;
        if (typeof content !== "string" || !content.trim()) throw new AiError("ai_bad_response", "The AI service sent an empty or unexpected reply.", 502, false);
        return {
          text: content,
          model: typeof d.model === "string" ? d.model : s.model,
          promptTokens: Number.isFinite(d.usage?.prompt_tokens) ? Number(d.usage!.prompt_tokens) : null,
          completionTokens: Number.isFinite(d.usage?.completion_tokens) ? Number(d.usage!.completion_tokens) : null,
          latencyMs: Date.now() - started,
        };
      } catch (e) {
        if (e instanceof AiError) {
          if (e.retryable && attempt < s.maxRetries) { lastErr = e; continue; }
          throw e;
        }
        // network failure or our own timeout
        const aborted = (e as Error)?.name === "AbortError";
        const err = aborted
          ? new AiError("ai_timeout", "The AI service took too long to answer. Try again.", 504, true)
          : new AiError("ai_network_error", "Could not reach the AI service. Try again shortly.", 503, true);
        if (attempt < s.maxRetries) { lastErr = err; continue; }
        throw err;
      } finally {
        clearTimeout(timer);
      }
    }
    throw lastErr ?? new AiError("ai_service_error", "The AI service could not be reached.", 503, true);
  },
};
