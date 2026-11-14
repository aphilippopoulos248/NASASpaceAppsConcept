// Checks the body of POST /api/assistant before anything is sent to a model, so that a
// malformed request gets a clear answer here instead of an opaque provider error.
import { LIMITS, TOOL_NAME_PATTERN, type StepRequest, type WireMessage, type WireTool } from '../../src/assistant/protocol';

type Json = Record<string, unknown>;
const isObject = (v: unknown): v is Json => typeof v === 'object' && v !== null && !Array.isArray(v);

export type Validation = { ok: true; value: StepRequest } | { ok: false; error: string };

function checkTool(t: unknown, i: number): string | WireTool {
  if (!isObject(t)) return `tools[${i}] must be an object`;
  if (typeof t.name !== 'string' || !TOOL_NAME_PATTERN.test(t.name)) return `tools[${i}].name is not a valid tool name`;
  if (typeof t.description !== 'string' || t.description.length > 8000) return `tools[${i}].description must be text (at most 8000 characters)`;
  const schema = t.input_schema;
  if (!isObject(schema) || schema.type !== 'object' || !isObject(schema.properties)) return `tools[${i}].input_schema must be an object schema`;
  if (schema.required !== undefined && !(Array.isArray(schema.required) && schema.required.every((r) => typeof r === 'string'))) return `tools[${i}].input_schema.required must be a list of names`;
  return { name: t.name, description: t.description, input_schema: schema as WireTool['input_schema'] };
}

function checkMessage(m: unknown, i: number): string | WireMessage {
  if (!isObject(m)) return `messages[${i}] must be an object`;
  switch (m.role) {
    case 'user': {
      if (typeof m.text !== 'string' || !m.text.trim()) return `messages[${i}].text must not be empty`;
      if (m.text.length > LIMITS.maxUserTextChars) return `messages[${i}].text is longer than ${LIMITS.maxUserTextChars} characters`;
      return { role: 'user', text: m.text, ...(m.state !== undefined ? { state: m.state } : {}) };
    }
    case 'assistant': {
      if (typeof m.text !== 'string') return `messages[${i}].text must be text`;
      if (!Array.isArray(m.toolCalls)) return `messages[${i}].toolCalls must be a list`;
      const toolCalls = [];
      for (const [j, c] of m.toolCalls.entries()) {
        if (!isObject(c) || typeof c.id !== 'string' || !c.id || typeof c.name !== 'string' || !c.name) return `messages[${i}].toolCalls[${j}] needs an id and a name`;
        toolCalls.push({ id: c.id, name: c.name, input: c.input });
      }
      let provider: { id: string; blocks: unknown } | undefined;
      if (m.provider !== undefined) {
        if (!isObject(m.provider) || typeof m.provider.id !== 'string') return `messages[${i}].provider must name its provider`;
        provider = { id: m.provider.id, blocks: m.provider.blocks };
      }
      return { role: 'assistant', text: m.text, toolCalls, ...(provider ? { provider } : {}) };
    }
    case 'tool': {
      if (!Array.isArray(m.results) || !m.results.length) return `messages[${i}].results must be a non-empty list`;
      const results = [];
      for (const [j, r] of m.results.entries()) {
        if (!isObject(r) || typeof r.id !== 'string' || typeof r.name !== 'string' || typeof r.ok !== 'boolean' || typeof r.content !== 'string') {
          return `messages[${i}].results[${j}] needs id, name, ok and content`;
        }
        // A little slack over the browser's own limit for the truncation marker.
        if (r.content.length > LIMITS.maxToolResultChars + 500) return `messages[${i}].results[${j}].content is too long`;
        results.push({ id: r.id, name: r.name, ok: r.ok, content: r.content });
      }
      return { role: 'tool', results };
    }
    default:
      return `messages[${i}].role must be user, assistant or tool`;
  }
}

/** The conversation must be something a model can continue: user first, every tool call answered, the last message waiting for the model. */
function checkShape(messages: WireMessage[]): string | null {
  if (messages[0].role !== 'user') return 'the conversation must start with a user message';
  for (let i = 0; i < messages.length; i++) {
    const m = messages[i];
    const prev = messages[i - 1];
    if (m.role === 'tool') {
      if (prev?.role !== 'assistant' || !prev.toolCalls.length) return `messages[${i}]: tool results must follow an assistant message that called tools`;
      const want = prev.toolCalls.map((c) => c.id).sort().join('\n');
      const got = m.results.map((r) => r.id).sort().join('\n');
      if (want !== got) return `messages[${i}]: tool results must answer exactly the calls of the previous message`;
    } else if (prev?.role === 'assistant' && prev.toolCalls.length) {
      return `messages[${i}]: the tool calls of the previous message have no results`;
    } else if (m.role === 'assistant' && prev?.role === 'assistant') {
      return `messages[${i}]: two assistant messages in a row`;
    }
  }
  const last = messages[messages.length - 1];
  if (last.role === 'assistant') return 'the conversation must end with a user message or tool results';
  return null;
}

export function validateStepRequest(body: unknown): Validation {
  if (!isObject(body)) return { ok: false, error: 'The request body must be a JSON object with "messages" and "tools".' };
  if (!Array.isArray(body.messages) || !body.messages.length) return { ok: false, error: '"messages" must be a non-empty list.' };
  if (body.messages.length > LIMITS.maxMessages) return { ok: false, error: `The conversation is longer than ${LIMITS.maxMessages} messages. Start a new conversation.` };
  if (!Array.isArray(body.tools)) return { ok: false, error: '"tools" must be a list.' };
  if (body.tools.length > LIMITS.maxTools) return { ok: false, error: `More than ${LIMITS.maxTools} tools.` };

  const tools: WireTool[] = [];
  const names = new Set<string>();
  for (const [i, t] of body.tools.entries()) {
    const r = checkTool(t, i);
    if (typeof r === 'string') return { ok: false, error: `Invalid request: ${r}.` };
    if (names.has(r.name)) return { ok: false, error: `Invalid request: tool "${r.name}" is listed twice.` };
    names.add(r.name);
    tools.push(r);
  }
  const messages: WireMessage[] = [];
  for (const [i, m] of body.messages.entries()) {
    const r = checkMessage(m, i);
    if (typeof r === 'string') return { ok: false, error: `Invalid request: ${r}.` };
    messages.push(r);
  }
  const shape = checkShape(messages);
  if (shape) return { ok: false, error: `Invalid request: ${shape}.` };
  return { ok: true, value: { messages, tools } };
}
