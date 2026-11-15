// A scripted stand-in for the language model: NOT a language model. It exists so that the
// whole assistant path (browser -> /api/assistant -> streamed step -> tool calls run by the
// browser -> results back -> next step) can be exercised and tested on a machine without
// an API key. Selected with LUNYX_LLM_PROVIDER=scripted; the UI labels every reply with it.
//
// A script is a pure function from "what has happened in this turn" to the next step.
import type { ModelInfo, StepEvent, StopKind, WireError, WireMessage, WireTool } from '../../src/assistant/protocol';
import { scenarioScript } from './scenarioScript';
import type { LlmProvider, ProviderRequest } from './types';

export const SCRIPTED_PROVIDER_ID = 'scripted';

export interface ScriptResult {
  name: string;
  ok: boolean;
  /** The parsed action result (when `ok`), otherwise undefined. */
  value: unknown;
  /** The error sentence (when not `ok`). */
  error?: string;
}

export interface ScriptContext {
  /** The latest user message. */
  userText: string;
  /** The state snapshot sent with it. */
  state: unknown;
  /** Results of every tool call made since that message, in order. */
  results: ScriptResult[];
  /** How many model steps this turn has already taken (0 on the first). */
  step: number;
  tools: readonly WireTool[];
  messages: readonly WireMessage[];
}

export interface ScriptStep {
  text?: string;
  calls?: { name: string; input?: unknown }[];
  /** Overrides the stop reason (default: 'tool_calls' when there are calls, else 'end'). */
  stop?: StopKind;
  /** Fail the step instead of answering. */
  error?: WireError;
}

export type Script = (ctx: ScriptContext) => ScriptStep | Promise<ScriptStep>;

function parse(content: string): unknown {
  try {
    return JSON.parse(content);
  } catch {
    return content;
  }
}

export function scriptContext(req: Pick<ProviderRequest, 'messages' | 'tools'>): ScriptContext {
  const messages = req.messages;
  let lastUser = -1;
  for (let i = messages.length - 1; i >= 0; i--) {
    if (messages[i].role === 'user') {
      lastUser = i;
      break;
    }
  }
  const user = lastUser >= 0 ? messages[lastUser] : undefined;
  const results: ScriptResult[] = [];
  let step = 0;
  for (const m of messages.slice(lastUser + 1)) {
    if (m.role === 'assistant') step++;
    if (m.role === 'tool') for (const r of m.results) results.push(r.ok ? { name: r.name, ok: true, value: parse(r.content) } : { name: r.name, ok: false, value: undefined, error: r.content });
  }
  return {
    userText: user?.role === 'user' ? user.text : '',
    state: user?.role === 'user' ? user.state : undefined,
    results,
    step,
    tools: req.tools,
    messages,
  };
}

/**
 * The default script: a test harness, not an attempt at understanding language.
 *   `call <tool> <json>` (several separated by `;` or new lines) runs those tools one step
 *   at a time and then reports each result verbatim;
 *   anything else reads the current state with getState and reports it.
 */
export const defaultScript: Script = (ctx) => {
  const commands = [...ctx.userText.matchAll(/\bcall\s+([A-Za-z][A-Za-z0-9_]*)\s*(\{[^;\n]*\})?/g)].map((m) => ({ name: m[1], json: m[2] }));
  if (commands.length) {
    const next = commands[ctx.results.length];
    if (next) {
      let input: unknown = {};
      if (next.json) input = parse(next.json);
      return { text: ctx.results.length === 0 ? `Scripted test model: running ${commands.length} tool call(s).` : '', calls: [{ name: next.name, input }] };
    }
    const lines = ctx.results.map((r, i) => `${i + 1}. ${r.name}: ${r.ok ? JSON.stringify(r.value) : `failed: ${r.error}`}`);
    return { text: `Scripted test model: done.\n${lines.join('\n')}` };
  }
  if (ctx.results.length === 0) {
    if (!ctx.tools.some((t) => t.name === 'getState')) return { text: 'Scripted test model: no getState tool was sent, so there is nothing to report.' };
    return { calls: [{ name: 'getState', input: {} }] };
  }
  const r = ctx.results[ctx.results.length - 1];
  return { text: r.ok ? `Scripted test model: current state is ${JSON.stringify(r.value)}` : `Scripted test model: getState failed: ${r.error}` };
};

const scripts = new Map<string, Script>([
  ['default', defaultScript],
  // The three-step scenario of the brief, played from tool results (server/llm/scenarioScript.ts).
  ['scenario', scenarioScript],
]);

export function registerScript(name: string, script: Script): void {
  scripts.set(name, script);
}

export function getScript(name: string): Script | undefined {
  return scripts.get(name);
}

export function scriptNames(): string[] {
  return [...scripts.keys()];
}

export class ScriptedProvider implements LlmProvider {
  readonly info: ModelInfo;

  constructor(
    private readonly script: Script,
    name = 'default',
  ) {
    this.info = { provider: SCRIPTED_PROVIDER_ID, model: `script:${name}`, label: 'Scripted test model (not a language model)' };
  }

  async *step(req: ProviderRequest): AsyncIterable<StepEvent> {
    yield { type: 'meta', ...this.info };
    let out: ScriptStep;
    try {
      out = await this.script(scriptContext(req));
    } catch (err) {
      yield { type: 'error', error: { kind: 'server', message: `The scripted test model failed: ${err instanceof Error ? err.message : String(err)}` } };
      return;
    }
    if (req.signal.aborted) {
      yield { type: 'error', error: { kind: 'aborted', message: 'The request was cancelled.' } };
      return;
    }
    if (out.error) {
      yield { type: 'error', error: out.error };
      return;
    }
    const text = out.text ?? '';
    // Stream the text in a few pieces, as a model would.
    const size = Math.max(1, Math.ceil(text.length / 4));
    for (let i = 0; i < text.length; i += size) yield { type: 'text', delta: text.slice(i, i + size) };
    // Ids are unique within the conversation and stable for a given history.
    const base = req.messages.length;
    const toolCalls = (out.calls ?? []).map((c, i) => ({ id: `call_${base}_${i}`, name: c.name, input: c.input ?? {} }));
    yield {
      type: 'done',
      stop: out.stop ?? (toolCalls.length ? 'tool_calls' : 'end'),
      servedBy: this.info,
      message: { role: 'assistant', text, toolCalls, provider: { id: SCRIPTED_PROVIDER_ID, blocks: null } },
    };
  }
}
