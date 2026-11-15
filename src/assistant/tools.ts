// The assistant's hands: the action registry, and nothing else.
//
// Tools are `toolDefinitions()` (generated from the registry), a tool call is
// `runAction(name, input, 'assistant')` (the same function the UI controls call), and
// the result the model reads is the action's own result. There is no second list.
import { getAction, runAction, toolDefinitions, type ActionOutcome } from '../core/actions';
import { LIMITS, type WireTool, type WireToolCall, type WireToolResult } from './protocol';

/** The tool list for the model: every registered action, as the registry describes it. */
export function currentTools(): WireTool[] {
  return toolDefinitions() as WireTool[];
}

function toJson(value: unknown): string {
  if (value === undefined) return '{"done":true}';
  try {
    return JSON.stringify(value, (_k, v) => (typeof v === 'bigint' ? Number(v) : ArrayBuffer.isView(v) ? Array.from(v as unknown as ArrayLike<number>) : v)) ?? 'null';
  } catch {
    return JSON.stringify({ note: 'The action result could not be serialised.' });
  }
}

/** The text the model reads for an action outcome. Long results are cut, and say so. */
export function resultContent(outcome: ActionOutcome): string {
  if (!outcome.ok) return outcome.error;
  const json = toJson(outcome.result);
  if (json.length <= LIMITS.maxToolResultChars) return json;
  return `${json.slice(0, LIMITS.maxToolResultChars)}\n[cut: the full result is ${json.length} characters; only the first ${LIMITS.maxToolResultChars} are shown]`;
}

export const CANCELLED_TEXT = 'Not run: the user stopped the assistant before this action started.';

/**
 * Runs the model's tool calls through the registry, one after the other in the order
 * given (they act on shared on-screen state, so order matters). Unknown tools, malformed
 * arguments and failing actions all come back as error results the model can read:
 * `runAction` never throws.
 */
export async function runToolCalls(calls: readonly WireToolCall[], signal?: AbortSignal): Promise<WireToolResult[]> {
  const results: WireToolResult[] = [];
  for (const call of calls) {
    if (signal?.aborted) {
      results.push({ id: call.id, name: call.name, ok: false, content: CANCELLED_TEXT });
      continue;
    }
    const outcome = await runAction(call.name, call.input ?? {}, 'assistant');
    results.push({ id: call.id, name: call.name, ok: outcome.ok, content: resultContent(outcome) });
  }
  return results;
}

/**
 * What is on screen now, for the model's context: the result of the registered `getState`
 * query. Read directly (not through runAction) so that this automatic snapshot does not
 * show up in the action log as something the assistant did.
 */
export async function stateSnapshot(): Promise<unknown> {
  const def = getAction('getState');
  if (!def) return undefined;
  try {
    return await def.run({});
  } catch {
    return undefined;
  }
}
