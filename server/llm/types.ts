// The one interface every model backend implements, and the router slot in front of it.
// Server-side only. The wire types are shared with the browser (src/assistant/protocol.ts).
import type { ModelInfo, StepEvent, WireMessage, WireTool } from '../../src/assistant/protocol';
import type { Effort } from './env';

/** One model step: the whole conversation so far and the FULL tool list from the action registry. */
export interface ProviderRequest {
  /** Operator instructions. Identical for every step of a conversation. */
  system: string;
  tools: readonly WireTool[];
  messages: readonly WireMessage[];
  /** Aborted when the browser disconnects or the user presses stop. */
  signal: AbortSignal;
  /** Set by a router: how much effort the model should spend on this step (default: the configured effort). */
  effort?: Effort;
}

/**
 * A model backend. `step` yields text deltas while the model writes and ends with exactly
 * one 'done' (the assistant message, with any tool calls) or one 'error' event. It must
 * not throw for expected failures (bad key, rate limit, refusal): those are events too.
 */
export interface LlmProvider {
  readonly info: ModelInfo;
  step(req: ProviderRequest): AsyncIterable<StepEvent>;
}

/**
 * The routing slot (decision D-1: "Jev may route intents; the choice of router must
 * preserve full capability"). A router sees the complete request, including every tool,
 * and picks the provider that handles it. It may not shrink the tool list: the handler
 * rejects a routed request that lost a tool.
 */
export interface LlmRouter {
  readonly id: string;
  route(req: ProviderRequest, providers: ProviderSet): Promise<RouteDecision> | RouteDecision;
}

export interface ProviderSet {
  /** The provider configured as default, or null when no model is available. */
  readonly primary: LlmProvider | null;
  get(id: string): LlmProvider | null;
}

export interface RouteDecision {
  provider: LlmProvider;
  /** The request to send. Must carry every tool of the original request. */
  request: ProviderRequest;
}
