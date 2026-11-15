// The Anthropic provider against a fake SDK client: request shape, replay rules, stop
// reasons, recovery paths and error wording. No network and no key are involved.
import Anthropic from '@anthropic-ai/sdk';
import { describe, expect, it } from 'vitest';
import type { StepEvent, WireMessage, WireTool } from '../../src/assistant/protocol';
import { AnthropicProvider, BETAS, buildParams, credentialsProblem, describeFailure, echoBlocks, NO_CREDENTIALS, toMessageParams, toToolParams, type MessagesClient } from './anthropic';
import type { LlmConfig } from './env';
import type { ProviderRequest } from './types';

const SECRET = 'sk-ant-test-CANARY-0123456789abcdef';

const cfg = (over: Partial<LlmConfig> = {}): LlmConfig => ({
  provider: 'anthropic', model: 'claude-opus-5-5', effort: 'medium', maxTokens: 64000, betas: true,
  customBaseUrl: false, router: 'direct', script: 'default', secrets: [SECRET], ...over,
});

const TOOLS: WireTool[] = [
  { name: 'setTime', description: 'Sets the time.', input_schema: { type: 'object', properties: { utc: { type: 'string', description: 'UTC' } } } },
  { name: 'getState', description: 'Reads the state. (Read-only.)', input_schema: { type: 'object', properties: {} } },
];

const request = (messages: WireMessage[], signal = new AbortController().signal): ProviderRequest => ({ system: 'SYSTEM', tools: TOOLS, messages, signal });

type Params = Parameters<MessagesClient['beta']['messages']['stream']>[0];
type Outcome = { deltas?: string[]; message: Record<string, unknown> } | { throws: unknown; afterDeltas?: string[] };

const message = (content: unknown[], stop_reason: string, extra: Record<string, unknown> = {}) => ({
  id: 'msg_1', type: 'message', role: 'assistant', model: 'claude-opus-5-5', content, stop_reason, stop_sequence: null, stop_details: null,
  usage: { input_tokens: 100, output_tokens: 20, cache_read_input_tokens: 80, cache_creation_input_tokens: 5 }, ...extra,
});

function fakeClient(outcomes: Outcome[]): MessagesClient & { calls: Params[] } {
  const calls: Params[] = [];
  return {
    calls,
    beta: {
      messages: {
        stream(params) {
          calls.push(structuredClone(params));
          const outcome = outcomes[calls.length - 1];
          if (!outcome) throw new Error('unexpected extra request');
          const deltas = 'throws' in outcome ? (outcome.afterDeltas ?? []) : (outcome.deltas ?? []);
          return {
            async *[Symbol.asyncIterator]() {
              for (const text of deltas) yield { type: 'content_block_delta', index: 0, delta: { type: 'text_delta', text } } as never;
              if ('throws' in outcome) throw outcome.throws;
            },
            finalMessage: async () => {
              if ('throws' in outcome) throw outcome.throws;
              return outcome.message as never;
            },
          };
        },
      },
    },
  };
}

async function collect(provider: AnthropicProvider, req: ProviderRequest): Promise<StepEvent[]> {
  const out: StepEvent[] = [];
  for await (const e of provider.step(req)) out.push(e);
  return out;
}

const apiError = (status: number, text: string) => Anthropic.APIError.generate(status, { type: 'error', error: { type: 'invalid_request_error', message: text } }, text, new Headers());
const USER: WireMessage = { role: 'user', text: 'Go to Apollo 11', state: { view: 'globe', timeUtc: '2026-03-01T12:00Z' } };
const logs: string[] = [];
const provider = (client: MessagesClient, over: Partial<LlmConfig> = {}) => new AnthropicProvider(cfg(over), client, (l) => logs.push(l));

describe('request shape', () => {
  it('sends a streamed request the current models accept, with the registry tools and a stable prefix', async () => {
    const client = fakeClient([{ deltas: ['Done', '.'], message: message([{ type: 'text', text: 'Done.' }], 'end_turn') }]);
    const events = await collect(provider(client), request([USER]));
    const p = client.calls[0] as Record<string, any>;
    expect(p.model).toBe('claude-opus-5-5');
    expect(p.max_tokens).toBe(64000);
    expect(p.output_config).toEqual({ effort: 'medium' });
    // Thinking is adaptive (it cannot be disabled or budgeted on current models); tool choice is left on auto.
    expect(p.thinking).toEqual({ type: 'adaptive', block_binding: { prefix_mismatch_behavior: 'drop_block' } });
    expect(p).not.toHaveProperty('tool_choice');
    expect(p).not.toHaveProperty('temperature');
    expect(p.betas).toEqual([...BETAS]);
    expect(p.fallbacks).toBe('default');
    // Static prefix: tools sorted by name, one cached system block, automatic caching for the conversation.
    expect(p.tools.map((t: any) => t.name)).toEqual(['getState', 'setTime']);
    expect(p.tools.every((t: any) => t.eager_input_streaming === true)).toBe(true);
    expect(p.tools[1].input_schema).toEqual(TOOLS[0].input_schema);
    expect(p.system).toEqual([{ type: 'text', text: 'SYSTEM', cache_control: { type: 'ephemeral' } }]);
    expect(p.cache_control).toEqual({ type: 'ephemeral' });
    // The state snapshot travels in the user turn, never in the system prompt.
    expect(p.messages).toEqual([{ role: 'user', content: [{ type: 'text', text: 'Go to Apollo 11' }, { type: 'text', text: '<app_state>\n{"view":"globe","timeUtc":"2026-03-01T12:00Z"}\n</app_state>' }] }]);
    expect(events.map((e) => e.type)).toEqual(['meta', 'text', 'text', 'done']);
    expect(events[0]).toMatchObject({ provider: 'anthropic', model: 'claude-opus-5-5', label: 'Claude Opus 5.5' });
    expect(events[3]).toMatchObject({ stop: 'end', message: { text: 'Done.', toolCalls: [] }, usage: { inputTokens: 100, outputTokens: 20, cacheReadTokens: 80, cacheWriteTokens: 5 } });
  });

  it('omits the beta features when they are switched off, and eager streaming behind a custom base URL', () => {
    const p = buildParams(cfg({ betas: false, customBaseUrl: true }), request([USER]), { betas: false, stripThinking: false }) as Record<string, any>;
    expect(p).not.toHaveProperty('betas');
    expect(p).not.toHaveProperty('fallbacks');
    expect(p.thinking).toEqual({ type: 'adaptive' });
    expect(p.tools.some((t: any) => 'eager_input_streaming' in t)).toBe(false);
  });

  it('is deterministic: the same conversation always renders to the same bytes', () => {
    const history: WireMessage[] = [USER, { role: 'assistant', text: 'ok', toolCalls: [] }, { role: 'user', text: 'again' }];
    expect(JSON.stringify(toMessageParams(history))).toBe(JSON.stringify(toMessageParams(structuredClone(history))));
    expect(JSON.stringify(toToolParams([...TOOLS].reverse(), true))).toBe(JSON.stringify(toToolParams(TOOLS, true)));
  });
});

describe('replaying the conversation', () => {
  const THINKING = { type: 'thinking', thinking: '', signature: 'sig-abc' };
  const assistantTurn: WireMessage = {
    role: 'assistant',
    text: 'Selecting it.',
    toolCalls: [{ id: 'toolu_1', name: 'setTime', input: { utc: '2026-03-01T12:00Z' } }],
    provider: { id: 'anthropic', blocks: [THINKING, { type: 'text', text: 'Selecting it.', citations: null }, { type: 'tool_use', id: 'toolu_1', name: 'setTime', input: { utc: '2026-03-01T12:00Z' }, caller: { type: 'direct' } }] },
  };
  const results: WireMessage = { role: 'tool', results: [{ id: 'toolu_1', name: 'setTime', ok: false, content: 'Time must be between 1950 and 2100.' }] };

  it('echoes thinking blocks unchanged and answers every tool call in one user message', () => {
    const params = toMessageParams([USER, assistantTurn, results]);
    expect(params[1]).toEqual({
      role: 'assistant',
      content: [THINKING, { type: 'text', text: 'Selecting it.' }, { type: 'tool_use', id: 'toolu_1', name: 'setTime', input: { utc: '2026-03-01T12:00Z' } }],
    });
    expect(params[2]).toEqual({ role: 'user', content: [{ type: 'tool_result', tool_use_id: 'toolu_1', content: 'Time must be between 1950 and 2100.', is_error: true }] });
  });

  it('can strip replayed reasoning (the recovery path) and drops block types it does not know', () => {
    expect(echoBlocks((assistantTurn as any).provider.blocks, true).map((b) => b.type)).toEqual(['text', 'tool_use']);
    expect(echoBlocks([{ type: 'document', source: { type: 'url', url: 'http://evil.example' } }, { type: 'text', text: '  ' }, { type: 'text', text: 'kept' }, 'junk', null], false)).toEqual([{ type: 'text', text: 'kept' }]);
    expect(echoBlocks('not a list', false)).toEqual([]);
  });

  it('after a server-side fallback echoes only text before the switch and keeps the fallback block in place', () => {
    const fallback = { type: 'fallback', from: { model: 'claude-opus-5-5' }, to: { model: 'claude-opus-4-8' }, trigger: { type: 'refusal' } };
    const blocks = [THINKING, { type: 'text', text: 'partial' }, { type: 'tool_use', id: 'old', name: 'setTime', input: {} }, fallback, { type: 'thinking', thinking: '', signature: 'sig-2' }, { type: 'tool_use', id: 'new', name: 'getState', input: {} }];
    expect(echoBlocks(blocks, false)).toEqual([{ type: 'text', text: 'partial' }, fallback, { type: 'thinking', thinking: '', signature: 'sig-2' }, { type: 'tool_use', id: 'new', name: 'getState', input: {} }]);
  });

  it('renders turns that did not come from this provider as plain text and calls', () => {
    const params = toMessageParams([USER, { role: 'assistant', text: 'Deterministic reply', toolCalls: [] }, { role: 'user', text: 'next' }, { role: 'assistant', text: '', toolCalls: [], provider: { id: 'scripted', blocks: null } }]);
    expect(params[1]).toEqual({ role: 'assistant', content: [{ type: 'text', text: 'Deterministic reply' }] });
    expect(params[3]).toEqual({ role: 'assistant', content: [{ type: 'text', text: '(no reply)' }] });
  });
});

describe('stop reasons', () => {
  it('returns tool calls with the provider blocks to echo back', async () => {
    const content = [{ type: 'thinking', thinking: '', signature: 's1' }, { type: 'text', text: 'Looking.' }, { type: 'tool_use', id: 'toolu_9', name: 'getState', input: {} }];
    const events = await collect(provider(fakeClient([{ deltas: ['Looking.'], message: message(content, 'tool_use') }])), request([USER]));
    expect(events.at(-1)).toMatchObject({ type: 'done', stop: 'tool_calls', message: { text: 'Looking.', toolCalls: [{ id: 'toolu_9', name: 'getState', input: {} }], provider: { id: 'anthropic', blocks: content } } });
  });

  it('treats a refusal as a normal answer: partial text is withdrawn and nothing is run', async () => {
    const refused = message([{ type: 'text', text: 'Sure, first' }, { type: 'tool_use', id: 't', name: 'setTime', input: {} }], 'refusal', { stop_details: { type: 'refusal', category: 'cyber', explanation: null } });
    const events = await collect(provider(fakeClient([{ deltas: ['Sure, first'], message: refused }])), request([USER]));
    expect(events.map((e) => e.type)).toEqual(['meta', 'text', 'reset', 'done']);
    const done = events.at(-1) as Extract<StepEvent, { type: 'done' }>;
    expect(done.stop).toBe('refusal');
    expect(done.message.toolCalls).toEqual([]);
    expect(done.message.provider).toBeUndefined();
    expect(done.message.text).toContain('declined this request (category: cyber)');
  });

  it('never runs tools from a reply that was cut off at the token limit', async () => {
    const cut = message([{ type: 'tool_use', id: 't', name: 'setTime', input: { utc: '2026' } }], 'max_tokens');
    const events = await collect(provider(fakeClient([{ message: cut }])), request([USER]));
    expect(events.at(-1)).toMatchObject({ type: 'error', error: { kind: 'model_request' } });
    const text = message([{ type: 'text', text: 'A long answer that stops' }], 'max_tokens');
    const cutText = await collect(provider(fakeClient([{ message: text }])), request([USER]));
    expect(cutText.at(-1)).toMatchObject({ type: 'done', stop: 'max_tokens', notice: 'The reply was cut off at the length limit.' });
  });

  it('reports the model that served the answer after a fallback, and runs only its tool calls', async () => {
    const fallback = { type: 'fallback', from: { model: 'claude-opus-5-5' }, to: { model: 'claude-opus-4-8' }, trigger: { type: 'refusal' } };
    const content = [{ type: 'tool_use', id: 'old', name: 'setTime', input: {} }, fallback, { type: 'text', text: 'Here.' }, { type: 'tool_use', id: 'new', name: 'getState', input: {} }];
    const events = await collect(provider(fakeClient([{ message: message(content, 'tool_use', { model: 'claude-opus-4-8' }) }])), request([USER]));
    const done = events.at(-1) as Extract<StepEvent, { type: 'done' }>;
    expect(done.message.toolCalls.map((c) => c.id)).toEqual(['new']);
    expect(done.servedBy).toMatchObject({ model: 'claude-opus-4-8' });
    expect(done.notice).toContain('Claude Opus 5.5 declined this request');
  });

  it('asks for a new conversation when the context window is exceeded', async () => {
    const events = await collect(provider(fakeClient([{ message: message([], 'model_context_window_exceeded') }])), request([USER]));
    expect(events.at(-1)).toMatchObject({ type: 'error', error: { kind: 'model_request' } });
  });
});

describe('failures and recovery', () => {
  it('retries once as a plain request, without replayed reasoning, when the API rejects the request', async () => {
    const history: WireMessage[] = [
      USER,
      { role: 'assistant', text: '', toolCalls: [{ id: 't1', name: 'getState', input: {} }], provider: { id: 'anthropic', blocks: [{ type: 'thinking', thinking: '', signature: 's' }, { type: 'tool_use', id: 't1', name: 'getState', input: {} }] } },
      { role: 'tool', results: [{ id: 't1', name: 'getState', ok: true, content: '{}' }] },
    ];
    const client = fakeClient([{ throws: apiError(400, 'unknown beta flag') }, { message: message([{ type: 'text', text: 'ok' }], 'end_turn') }]);
    const events = await collect(provider(client), request(history));
    expect(events.at(-1)).toMatchObject({ type: 'done', stop: 'end' });
    const [first, second] = client.calls as Record<string, any>[];
    expect(first.betas).toBeDefined();
    expect(second).not.toHaveProperty('betas');
    expect(second).not.toHaveProperty('fallbacks');
    expect(second.thinking).toEqual({ type: 'adaptive' });
    expect(first.messages[1].content.map((b: any) => b.type)).toEqual(['thinking', 'tool_use']);
    expect(second.messages[1].content.map((b: any) => b.type)).toEqual(['tool_use']);
  });

  it('gives up after the second rejection and never leaks the secret in the message', async () => {
    const client = fakeClient([{ throws: apiError(400, `bad request for key ${SECRET}`) }, { throws: apiError(400, `still bad ${SECRET}`) }]);
    const events = await collect(provider(client), request([USER]));
    const last = events.at(-1) as Extract<StepEvent, { type: 'error' }>;
    expect(last.error.kind).toBe('model_request');
    expect(last.error.message).toContain('still bad [redacted]');
    expect(JSON.stringify(events)).not.toContain(SECRET);
    expect(client.calls).toHaveLength(2);
  });

  it('issues the step again when a streamed tool input cannot be read, and withdraws partial text', async () => {
    const client = fakeClient([{ throws: new SyntaxError('Unexpected end of JSON input'), afterDeltas: ['Half'] }, { message: message([{ type: 'text', text: 'Full answer' }], 'end_turn') }]);
    const events = await collect(provider(client), request([USER]));
    expect(events.map((e) => e.type)).toEqual(['meta', 'text', 'reset', 'done']);
    const never = fakeClient([{ throws: new Error('a') }, { throws: new Error('b') }, { throws: new Error('c') }]);
    const failed = await collect(provider(never), request([USER]));
    expect(never.calls).toHaveLength(3);
    expect(failed.at(-1)).toMatchObject({ type: 'error', error: { kind: 'server' } });
  });

  it('words API failures by class, without retrying them as JSON problems', async () => {
    for (const [status, kind] of [[401, 'auth'], [403, 'auth'], [404, 'model_request'], [429, 'rate_limit'], [529, 'overloaded'], [500, 'overloaded']] as const) {
      const client = fakeClient([{ throws: apiError(status, `failure ${SECRET}`) }]);
      const events = await collect(provider(client), request([USER]));
      expect(events.at(-1), String(status)).toMatchObject({ type: 'error', error: { kind } });
      expect(client.calls, String(status)).toHaveLength(1);
      expect(JSON.stringify(events)).not.toContain(SECRET);
    }
    expect(describeFailure(new Anthropic.APIConnectionError({ message: 'socket hang up' }), cfg())).toMatchObject({ kind: 'network' });
    expect(describeFailure(new Anthropic.APIUserAbortError(), cfg())).toMatchObject({ kind: 'aborted' });
    expect(describeFailure(new Error('x'), cfg())).toMatchObject({ kind: 'server' });
  });

  it('stops quietly when the browser goes away', async () => {
    const controller = new AbortController();
    controller.abort();
    const client = fakeClient([{ throws: new Anthropic.APIUserAbortError() }]);
    const events = await collect(provider(client), request([USER], controller.signal));
    expect(events.at(-1)).toMatchObject({ type: 'error', error: { kind: 'aborted' } });
    expect(client.calls).toHaveLength(1);
  });

  it('never writes secrets to the log', async () => {
    logs.length = 0;
    await collect(provider(fakeClient([{ throws: apiError(400, `x ${SECRET}`) }, { throws: apiError(401, `y ${SECRET}`) }])), request([USER]));
    expect(logs.length).toBeGreaterThan(0);
    expect(logs.join('\n')).not.toContain(SECRET);
  });
});

describe('no credentials (SDK 1.8: the client builds, the first request fails with a plain Error)', () => {
  it('maps the SDK\'s plain "Could not resolve authentication method" and a missing profile to no_model', () => {
    const cfg = { model: 'claude-opus-5-5', secrets: [] };
    const plain = new Error('Could not resolve authentication method. Expected one of apiKey, authToken, credentials, config, or profile to be set. Or for the "Authorization" header to be explicitly omitted');
    expect(describeFailure(plain, cfg)).toEqual({ kind: 'no_model', message: NO_CREDENTIALS });
    expect(describeFailure(new Anthropic.AnthropicError('Profile "work" could not be resolved (no <config_dir>/configs/work.json found).'), cfg).kind).toBe('no_model');
    expect(describeFailure(new Error('something else'), cfg).kind).not.toBe('no_model');
  });

  it('finds the credentials problem without sending a request', async () => {
    expect(await credentialsProblem({ apiKey: 'k' }, async () => null)).toBeNull();
    expect(await credentialsProblem({ authToken: 't' }, async () => null)).toBeNull();
    expect(await credentialsProblem({ apiKey: null, authToken: null }, async () => ({ provider: {} }))).toBeNull();
    expect(await credentialsProblem({ apiKey: null, authToken: null }, async () => null)).toBe(NO_CREDENTIALS);
    expect(await credentialsProblem({}, async () => { throw new Error('Profile "x" could not be resolved'); })).toBe(`${NO_CREDENTIALS} (Profile "x" could not be resolved)`);
  });

  it('checks once per provider, and a stand-in client is ready', async () => {
    let calls = 0;
    const p = new AnthropicProvider(cfg(), fakeClient([]), () => {}, async () => (calls++, NO_CREDENTIALS));
    expect(await p.ready()).toBe(NO_CREDENTIALS);
    expect(await p.ready()).toBe(NO_CREDENTIALS);
    expect(calls).toBe(1);
    expect(await new AnthropicProvider(cfg(), fakeClient([])).ready()).toBeNull();
  });
});
