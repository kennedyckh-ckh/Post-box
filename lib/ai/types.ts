export type AiKind = "group_summary" | "cross_group" | "discussion_points";
export type PointKind = "theme" | "disagreement" | "minority" | "gap" | "misconception" | "question" | "insufficient";

export interface AiPoint {
  heading: string;
  text: string;
  kind: PointKind;
  /** aliases such as E3, mapped to real entry ids on the server. Never shown to participants. */
  cites: string[];
}
export interface AiContent {
  overview: string;
  points: AiPoint[];
}

export interface AiMessage {
  role: "system" | "user";
  content: string;
}

/** Everything a provider needs. Real providers use `messages`; the simulator uses `context` instead of a model. */
export interface AiRequest {
  kind: AiKind | "test";
  messages: AiMessage[];
  maxTokens: number;
  context?: SimContext;
}
export interface SimContext {
  kind: AiKind;
  language: string;
  entries: { alias: string; groupLabel: string; text: string; tags: string[]; questionText: string | null }[];
}

export interface AiResult {
  text: string;
  model: string;
  promptTokens: number | null;
  completionTokens: number | null;
  latencyMs: number;
}

export interface AiProvider {
  name: "simulated" | "hku";
  generate(req: AiRequest): Promise<AiResult>;
}

/** Errors carry a code the interface can show. Messages never contain keys, URLs with secrets, prompts or participant text. */
export class AiError extends Error {
  constructor(public code: string, message: string, public status = 502, public retryable = false, public httpStatus: number | null = null) {
    super(message);
  }
}

export const SIMULATED_LABEL = "Demo: simulated, not real AI.";
