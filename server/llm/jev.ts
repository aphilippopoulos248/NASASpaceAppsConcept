// Optional router: Jev, TypeSafe AI's typed decision model.
//
// Jev answers typed questions about a piece of content (yes/no, one of several choices, a
// score). It cannot call tools, so it does not replace the language model: here it decides
// how much effort the model should spend on a request. Every step still goes to the
// configured model with the FULL tool list from the action registry, untouched, so routing
// cannot remove a capability (decision D-1; `assertFullCapability` checks it on every step).
//
// Request and response shapes follow the published OpenAPI document
// (https://api.typesafe.ai/openapi.json, API version 0.2.0, read on 2026-11-14):
//   POST https://api.typesafe.ai/v1/systemone      Authorization: Bearer <key>
//   { model, state, questions: { <name>: { type: "choice", instructions, criteria: { <choice>: <when it applies> } } } }
//   -> { model, answers: { <name>: { type: "choice", choice, confidence, probabilities } }, usage }
//
// Enable with LUNYX_LLM_ROUTER=jev and TYPESAFE_API_KEY on the server. If Jev cannot be
// reached, or is unsure, the request runs at the configured effort: routing never blocks
// the assistant. The key stays on the server like the model's.
import type { WireMessage } from '../../src/assistant/protocol';
import { redact, type Effort } from './env';
import type { LlmRouter, ProviderRequest } from './types';

export const JEV_URL = 'https://api.typesafe.ai/v1/systemone';
export const JEV_DEFAULT_MODEL = 'jev-latest';

export type RequestKind = 'direct' | 'multi_step' | 'question';

const QUESTION = {
  type: 'choice',
  instructions: 'The content is the latest message a user sent to the assistant of a lunar landing site navigator, with the names of every action the assistant can run. What kind of request is the message?',
  criteria: {
    direct: 'A direct command that maps onto one or two of the listed actions with obvious parameters: going to a site or coordinates, setting the time, switching a view, an overlay or a setting.',
    multi_step: 'A request that needs several actions, or analysis, comparison, ranking of alternatives, or reasoning about results before answering.',
    question: 'A question that can be answered from what is on screen, without changing anything.',
  },
} as const;

export interface JevConfig {
  apiKey: string;
  model: string;
  /** Effort for requests Jev classifies as direct commands or simple questions. */
  simpleEffort: Effort;
  /** Below this confidence the configured effort is used. */
  minConfidence: number;
  timeoutMs: number;
}

export interface JevDecision {
  kind: RequestKind;
  confidence: number;
}

type FetchLike = (url: string, init: { method: string; headers: Record<string, string>; body: string; signal: AbortSignal }) => Promise<{ ok: boolean; status: number; json(): Promise<unknown> }>;

function lastUser(messages: readonly WireMessage[]): { index: number; text: string } | null {
  for (let i = messages.length - 1; i >= 0; i--) {
    const m = messages[i];
    if (m.role === 'user') return { index: i, text: m.text };
  }
  return null;
}

/** One Jev call. Returns null when the service fails or the answer is not the documented shape. */
export async function askJev(cfg: JevConfig, req: ProviderRequest, userText: string, fetchFn: FetchLike, log: (line: string) => void): Promise<JevDecision | null> {
  const timeout = AbortSignal.timeout(cfg.timeoutMs);
  const signal = AbortSignal.any([timeout, req.signal]);
  try {
    const res = await fetchFn(JEV_URL, {
      method: 'POST',
      headers: { authorization: `Bearer ${cfg.apiKey}`, 'content-type': 'application/json' },
      // Jev sees the complete list of what the assistant can do, by name.
      body: JSON.stringify({ model: cfg.model, state: { message: userText, actions: req.tools.map((t) => t.name) }, questions: { kind: QUESTION } }),
      signal,
    });
    if (!res.ok) {
      log(`[assistant] Jev router: HTTP ${res.status}; using the configured effort.`);
      return null;
    }
    const body = (await res.json()) as { answers?: { kind?: { type?: unknown; choice?: unknown; confidence?: unknown } } } | null;
    const a = body?.answers?.kind;
    if (a?.type !== 'choice' || typeof a.choice !== 'string' || typeof a.confidence !== 'number' || !(a.choice in QUESTION.criteria)) {
      log('[assistant] Jev router: unexpected answer; using the configured effort.');
      return null;
    }
    return { kind: a.choice as RequestKind, confidence: a.confidence };
  } catch (err) {
    if (!req.signal.aborted) log(`[assistant] Jev router: ${redact(err instanceof Error ? err.message : String(err), [cfg.apiKey]).slice(0, 200)}; using the configured effort.`);
    return null;
  }
}

/**
 * The router: on the first step of a user turn it asks Jev what kind of request this is
 * and sets the effort for the whole turn; later steps of the same turn reuse the decision.
 * Tools and messages pass through unchanged.
 */
export function createJevRouter(cfg: JevConfig, fetchFn: FetchLike = (url, init) => fetch(url, init), log: (line: string) => void = (l) => console.warn(l)): LlmRouter {
  // Decisions of recent turns, so the steps of one turn run at one effort. In memory only.
  const decided = new Map<string, Effort | null>();
  const remember = (key: string, effort: Effort | null) => {
    decided.set(key, effort);
    if (decided.size > 500) decided.delete(decided.keys().next().value!);
  };
  return {
    id: 'jev',
    async route(req, providers) {
      if (!providers.primary) throw new Error('No model provider is configured.');
      const user = lastUser(req.messages);
      if (!user) return { provider: providers.primary, request: req };
      const key = `${user.index}\n${user.text}`;
      let effort = decided.get(key);
      const firstStep = user.index === req.messages.length - 1;
      if (effort === undefined && firstStep) {
        const d = await askJev(cfg, req, user.text, fetchFn, log);
        effort = d && d.confidence >= cfg.minConfidence && d.kind !== 'multi_step' ? cfg.simpleEffort : null;
        remember(key, effort);
      }
      return { provider: providers.primary, request: effort ? { ...req, effort } : req };
    },
  };
}
