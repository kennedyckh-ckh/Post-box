/**
 * Server-side settings, read from environment variables only. Nothing here is ever sent to a browser or written to a log.
 *
 *   AI_PROVIDER                 simulated (default) or hku
 *   HKU_API_KEY                 secret. Set it privately in the host (Render). Sent in the `api-key` header.
 *   HKU_API_ENDPOINT            the COMPLETE request URL exactly as the HKU developer portal shows it
 *                               (including the deployment path and ?api-version=... if the portal's URL has it). Used as given.
 *   HKU_API_VERSION             optional. Added as ?api-version=... ONLY if set and the endpoint does not already contain api-version,
 *                               so the version is never added twice.
 *   AI_MODEL                    model label, default gpt-4.1-nano (informational, and sent in the body only if AI_SEND_MODEL=1)
 *   AI_SEND_MODEL               1 to also send {"model": AI_MODEL} in the request body (some gateways need it; Azure deployment URLs do not)
 *   AI_TIMEOUT_MS               per-request timeout, default 45000
 *   AI_MAX_RETRIES              retries for temporary failures (429, 5xx, network, timeout), default 2, never more than 3
 *   AI_RETRY_DELAY_MS           base delay between retries, default 800
 *   AI_MAX_INPUT_CHARS          largest amount of participant text sent in one request, default 60000 (never silently cut)
 *   AI_LIMIT_REQUESTS_PER_DAY   default per-facilitator limit of live requests per UTC day, default 100
 *   AI_LIMIT_TOKENS_PER_MONTH   default per-facilitator limit of live tokens per UTC month, default 500000
 */
export type ProviderName = "simulated" | "hku";

export interface AiSettings {
  provider: ProviderName;
  model: string;
  endpoint: string;
  apiVersion: string;
  apiKeyPresent: boolean;
  sendModel: boolean;
  timeoutMs: number;
  maxRetries: number;
  retryDelayMs: number;
  maxInputChars: number;
  defaultRequestsPerDay: number;
  defaultTokensPerMonth: number;
}

const intEnv = (name: string, d: number, min = 0, max = Number.MAX_SAFE_INTEGER) => {
  const n = Number(process.env[name]);
  return Number.isFinite(n) && n >= min && n <= max && process.env[name] !== "" && process.env[name] !== undefined ? Math.floor(n) : d;
};

export function aiSettings(): AiSettings {
  const p = (process.env.AI_PROVIDER || "simulated").toLowerCase();
  return {
    provider: p === "hku" ? "hku" : "simulated",
    model: process.env.AI_MODEL || "gpt-4.1-nano",
    endpoint: (process.env.HKU_API_ENDPOINT || "").trim(),
    apiVersion: (process.env.HKU_API_VERSION || "").trim(),
    apiKeyPresent: !!(process.env.HKU_API_KEY || "").trim(),
    sendModel: process.env.AI_SEND_MODEL === "1",
    timeoutMs: intEnv("AI_TIMEOUT_MS", 45000, 1000, 300000),
    maxRetries: intEnv("AI_MAX_RETRIES", 2, 0, 3),
    retryDelayMs: intEnv("AI_RETRY_DELAY_MS", 800, 0, 10000),
    maxInputChars: intEnv("AI_MAX_INPUT_CHARS", 60000, 1000, 400000),
    defaultRequestsPerDay: intEnv("AI_LIMIT_REQUESTS_PER_DAY", 100, 0, 100000),
    defaultTokensPerMonth: intEnv("AI_LIMIT_TOKENS_PER_MONTH", 500000, 0, 100000000),
  };
}

export interface AiStatus {
  provider: ProviderName;
  model: string;
  /** true when the settings needed for this provider are all present and valid */
  configured: boolean;
  /** names of the missing or invalid variables (never their values) */
  problems: string[];
  simulated: boolean;
}

export function aiStatus(): AiStatus {
  const s = aiSettings();
  if (s.provider === "simulated") return { provider: "simulated", model: "simulated", configured: true, problems: [], simulated: true };
  const problems: string[] = [];
  if (!s.apiKeyPresent) problems.push("HKU_API_KEY");
  if (!s.endpoint) problems.push("HKU_API_ENDPOINT");
  else {
    try {
      const u = new URL(s.endpoint);
      if (u.protocol !== "https:") problems.push("HKU_API_ENDPOINT (must start with https://)");
    } catch {
      problems.push("HKU_API_ENDPOINT (not a valid URL)");
    }
  }
  return { provider: "hku", model: s.model, configured: problems.length === 0, problems, simulated: false };
}
