// Wire protocol between the browser and POST /api/assistant. Pure types and constants,
// imported by both sides (src/assistant/** and server/llm/**): no DOM, no Node APIs.
//
// One request = one model step. The browser owns the conversation and the tools:
//   1. it sends the whole conversation so far plus the tool list generated from the action
//      registry (`toolDefinitions()`), never a hand-written list;
//   2. the server relays that to the configured model and streams back text and, at the
//      end, the assistant message with any tool calls;
//   3. the browser runs each call with `runAction(name, input, 'assistant')`, appends the
//      results and asks for the next step, until the model answers without tool calls.
//
// The conversation is append-only: earlier messages are sent back exactly as they were
// received (including the opaque `provider` blocks), which is what model providers need
// to keep their reasoning and their prompt cache valid across steps.

/** A tool as produced by `toolDefinitions()` in src/core/actions.ts. */
export interface WireTool {
  name: string;
  description: string;
  input_schema: { type: 'object'; properties: Record<string, unknown>; required?: readonly string[]; description?: string };
}

export interface WireToolCall {
  /** Provider-assigned id; the matching result carries the same id. */
  id: string;
  name: string;
  input: unknown;
}

export interface WireToolResult {
  id: string;
  name: string;
  ok: boolean;
  /** The action result as JSON text, or the error sentence when `ok` is false. */
  content: string;
}

export interface UserWireMessage {
  role: 'user';
  text: string;
  /** What was on screen when the message was sent (the `getState` action's result). */
  state?: unknown;
}

export interface AssistantWireMessage {
  role: 'assistant';
  /** Text shown to the user. */
  text: string;
  toolCalls: WireToolCall[];
  /**
   * The provider's own representation of this turn. Opaque to the browser: stored and
   * sent back unchanged so the same provider can continue the conversation.
   */
  provider?: { id: string; blocks: unknown };
}

export interface ToolWireMessage {
  role: 'tool';
  results: WireToolResult[];
}

export type WireMessage = UserWireMessage | AssistantWireMessage | ToolWireMessage;

export interface StepRequest {
  messages: WireMessage[];
  tools: WireTool[];
}

/** Why the model stopped. Tools are run only after 'tool_calls'. */
export type StopKind = 'end' | 'tool_calls' | 'max_tokens' | 'refusal';

export type WireErrorKind =
  /** No language model is configured on the server: the browser uses deterministic mode. */
  | 'no_model'
  | 'invalid_request'
  | 'auth'
  | 'rate_limit'
  | 'overloaded'
  | 'model_request'
  | 'network'
  | 'aborted'
  | 'server';

export interface WireError {
  kind: WireErrorKind;
  /** A sentence for the user. Never contains credentials. */
  message: string;
  status?: number;
}

export interface ModelInfo {
  /** 'anthropic', 'scripted', ... */
  provider: string;
  model: string;
  /** Shown next to every reply, e.g. "Claude Opus 5.5" or "Scripted test model (not a language model)". */
  label: string;
}

export interface StepUsage {
  inputTokens: number;
  outputTokens: number;
  cacheReadTokens: number;
  cacheWriteTokens: number;
}

/** Events of one step, sent as newline-delimited JSON. Exactly one 'done' or 'error' ends the stream. */
export type StepEvent =
  | ({ type: 'meta' } & ModelInfo)
  | { type: 'text'; delta: string }
  /** A hosted web lookup actually executed by the server-side model. */
  | { type: 'web_search'; query: string }
  /** Discard the text streamed so far in this step: the step is being issued again. */
  | { type: 'reset' }
  | { type: 'done'; message: AssistantWireMessage; stop: StopKind; servedBy: ModelInfo; notice?: string; usage?: StepUsage }
  | { type: 'error'; error: WireError };

/** GET /api/assistant */
export interface AssistantStatus {
  /** True when the server can reach a model (or the scripted test model). */
  available: boolean;
  model: ModelInfo | null;
  /** Which router decides the provider ('direct' unless configured otherwise). */
  router: string;
  /** Why no model is available, as a sentence. */
  reason?: string;
}

export const NDJSON_CONTENT_TYPE = 'application/x-ndjson; charset=utf-8';

/** Limits enforced on both sides, so the browser can stay inside what the server accepts. */
export const LIMITS = {
  /** The API plugin rejects bodies above 1 MB; the browser starts a fresh model context before this. */
  maxRequestBytes: 900_000,
  maxMessages: 400,
  maxTools: 256,
  maxUserTextChars: 8_000,
  /**
   * One tool result (JSON text). Longer results are cut with an explicit marker. The largest
   * result in the app is listSites (28 landings with ownership and explored area, about 35 kB);
   * it must reach the model whole.
   */
  maxToolResultChars: 64_000,
  /** Model steps per user message (each step may hold several tool calls). */
  maxStepsPerTurn: 24,
} as const;

export const TOOL_NAME_PATTERN = /^[a-zA-Z][a-zA-Z0-9_]{0,63}$/;

/** Text of every deterministic reply's label. */
export const DETERMINISTIC_LABEL = 'Deterministic mode: no language model';
