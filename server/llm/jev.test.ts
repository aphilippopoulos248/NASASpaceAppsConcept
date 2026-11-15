// The Jev router against a fake HTTP endpoint that speaks the documented TypeSafe API.
// Nothing here has run against the real service: there is no TypeSafe key on this machine.
import { describe, expect, it } from 'vitest';
import type { StepEvent, WireMessage, WireTool } from '../../src/assistant/protocol';
import { buildParams } from './anthropic';
import { loadConfig, type LlmConfig } from './env';
import { createAssistantHandler, type HttpRequest } from './handler';
import { createJevRouter, JEV_URL, type JevConfig } from './jev';
import { assertFullCapability } from './router';
import type { LlmProvider, ProviderRequest, ProviderSet } from './types';

const JEV_KEY = 'ts-live-CANARY-abcdef0123456789';
const CFG: JevConfig = { apiKey: JEV_KEY, model: 'jev-latest', simpleEffort: 'low', minConfidence: 0.6, timeoutMs: 2000 };

const TOOLS: WireTool[] = ['getState', 'selectSite', 'setTime', 'rankNearby', 'compare'].map((name) => ({ name, description: `${name} action`, input_schema: { type: 'object', properties: {} } }));
const USER: WireMessage = { role: 'user', text: 'pause the clock' };
const request = (messages: WireMessage[] = [USER]): ProviderRequest => ({ system: 'S', tools: TOOLS, messages, signal: new AbortController().signal });

const provider: LlmProvider = { info: { provider: 'x', model: 'm', label: 'M' }, async *step() {} };
const providers: ProviderSet = { primary: provider, get: () => provider };

interface Call {
  url: string;
  init: { method: string; headers: Record<string, string>; body: string };
}

function fakeJev(answer: (body: any) => { status?: number; json?: unknown; throws?: unknown }) {
  const calls: Call[] = [];
  const fetchFn = async (url: string, init: Call['init']) => {
    calls.push({ url, init });
    const r = answer(JSON.parse(init.body));
    if (r.throws) throw r.throws;
    return { ok: (r.status ?? 200) < 400, status: r.status ?? 200, json: async () => r.json };
  };
  return { fetchFn, calls };
}

const choice = (kind: string, confidence: number) => ({ json: { model: 'jev-2026-09', answers: { kind: { type: 'choice', choice: kind, confidence, probabilities: { [kind]: confidence } } }, usage: { input_tokens: 90, output_tokens: 4 } } });

describe('Jev router', () => {
  it('sends the documented request: bearer key, model, the message, every action name, one choice question', async () => {
    const jev = fakeJev(() => choice('direct', 0.93));
    const logs: string[] = [];
    const decision = await createJevRouter(CFG, jev.fetchFn, (l) => logs.push(l)).route(request(), providers);
    expect(jev.calls).toHaveLength(1);
    const { url, init } = jev.calls[0];
    expect(url).toBe(JEV_URL);
    expect(url).toBe('https://api.typesafe.ai/v1/systemone');
    expect(init.method).toBe('POST');
    expect(init.headers).toEqual({ authorization: `Bearer ${JEV_KEY}`, 'content-type': 'application/json' });
    const body = JSON.parse(init.body);
    expect(Object.keys(body).sort()).toEqual(['model', 'questions', 'state']);
    expect(body.model).toBe('jev-latest');
    expect(body.state).toEqual({ message: 'pause the clock', actions: TOOLS.map((t) => t.name) });
    expect(body.questions.kind.type).toBe('choice');
    expect(Object.keys(body.questions.kind.criteria)).toEqual(['direct', 'multi_step', 'question']);
    expect(decision.request.effort).toBe('low');
    expect(logs).toEqual([]);
  });

  it('never touches the tools or the conversation', async () => {
    const jev = fakeJev(() => choice('question', 0.9));
    const req = request();
    const decision = await createJevRouter(CFG, jev.fetchFn).route(req, providers);
    expect(decision.provider).toBe(provider);
    expect(decision.request.tools).toBe(req.tools);
    expect(decision.request.messages).toBe(req.messages);
    expect(() => assertFullCapability(req, decision.request)).not.toThrow();
  });

  it('keeps the configured effort for multi-step requests and uncertain answers', async () => {
    for (const answer of [choice('multi_step', 0.99), choice('direct', 0.41)]) {
      const decision = await createJevRouter(CFG, fakeJev(() => answer).fetchFn).route(request(), providers);
      expect(decision.request.effort).toBeUndefined();
    }
  });

  it('falls back to the configured effort when Jev fails, without leaking its key', async () => {
    const failures = [
      { status: 401, json: { detail: 'Invalid API key' } },
      { status: 422, json: { detail: [{ msg: 'bad' }] } },
      { json: { answers: {} } },
      { json: { answers: { kind: { type: 'choice', choice: 'banana', confidence: 1, probabilities: {} } } } },
      { json: { answers: { kind: { type: 'noul', noul: 0.9 } } } },
      { json: null },
      { throws: new Error(`connect ECONNREFUSED with ${JEV_KEY}`) },
    ];
    for (const f of failures) {
      const logs: string[] = [];
      const decision = await createJevRouter(CFG, fakeJev(() => f).fetchFn, (l) => logs.push(l)).route(request(), providers);
      expect(decision.request.effort).toBeUndefined();
      expect(decision.request.tools).toHaveLength(TOOLS.length);
      expect(logs.join('\n')).toContain('using the configured effort');
      expect(logs.join('\n')).not.toContain(JEV_KEY);
    }
  });

  it('decides once per user turn: later steps of the turn reuse the decision, a new message asks again', async () => {
    const jev = fakeJev((body) => choice(body.state.message.includes('compare') ? 'multi_step' : 'direct', 0.95));
    const router = createJevRouter(CFG, jev.fetchFn);
    const turn: WireMessage[] = [USER];
    expect((await router.route(request(turn), providers)).request.effort).toBe('low');
    const later: WireMessage[] = [...turn, { role: 'assistant', text: '', toolCalls: [{ id: 'a', name: 'getState', input: {} }] }, { role: 'tool', results: [{ id: 'a', name: 'getState', ok: true, content: '{}' }] }];
    expect((await router.route(request(later), providers)).request.effort).toBe('low');
    expect(jev.calls).toHaveLength(1);
    const next: WireMessage[] = [...later, { role: 'assistant', text: 'Paused.', toolCalls: [] }, { role: 'user', text: 'compare the two best sites nearby' }];
    expect((await router.route(request(next), providers)).request.effort).toBeUndefined();
    expect(jev.calls).toHaveLength(2);
    // A step of a turn this server never saw the start of (for example after a restart) is not sent to Jev.
    const fresh = createJevRouter(CFG, jev.fetchFn);
    expect((await fresh.route(request(later), providers)).request.effort).toBeUndefined();
    expect(jev.calls).toHaveLength(2);
  });

  it('sets the effort of the model request', () => {
    const cfg: LlmConfig = { provider: 'anthropic', model: 'claude-opus-5-5', effort: 'medium', maxTokens: 64000, betas: true, sdkCredentials: false, customBaseUrl: false, router: 'jev', script: 'default', secrets: [] };
    const opts = { betas: true, stripThinking: false };
    expect((buildParams(cfg, request(), opts) as any).output_config).toEqual({ effort: 'medium' });
    expect((buildParams(cfg, { ...request(), effort: 'low' }, opts) as any).output_config).toEqual({ effort: 'low' });
  });
});

describe('Jev router through /api/assistant', () => {
  const post = (body: unknown): HttpRequest => ({ method: 'POST', subpath: '', query: new URLSearchParams(), headers: {}, body, rawBody: JSON.stringify(body), signal: new AbortController().signal });
  const config = (env: Record<string, string>) => loadConfig({ processEnv: env, root: '/nonexistent-lunyx-root' });

  it('needs its key, and says so', async () => {
    const handler = createAssistantHandler({ loadConfig: () => config({ LUNYX_LLM_PROVIDER: 'scripted', LUNYX_LLM_ROUTER: 'jev' }), provider: () => provider, log: () => undefined });
    const res = await handler({ ...post(undefined), method: 'GET' });
    expect(res.json).toMatchObject({ available: false, router: 'jev' });
    expect((res.json as { reason: string }).reason).toContain('TYPESAFE_API_KEY');
  });

  it('reads the Jev settings from the server environment and keeps the key out of every payload', async () => {
    const cfg = config({ LUNYX_LLM_PROVIDER: 'scripted', LUNYX_LLM_ROUTER: 'jev', TYPESAFE_API_KEY: JEV_KEY, LUNYX_JEV_MODEL: 'jev-preview', LUNYX_JEV_SIMPLE_EFFORT: 'medium', LUNYX_JEV_MIN_CONFIDENCE: '0.8', LUNYX_JEV_TIMEOUT_MS: '1500' });
    expect(cfg.jev).toEqual({ apiKey: JEV_KEY, model: 'jev-preview', simpleEffort: 'medium', minConfidence: 0.8, timeoutMs: 1500 });
    expect(cfg.secrets).toContain(JEV_KEY);

    const seen: ProviderRequest[] = [];
    const spy: LlmProvider = {
      info: { provider: 'spy', model: 'm', label: 'Spy' },
      async *step(req): AsyncIterable<StepEvent> {
        seen.push(req);
        yield { type: 'done', stop: 'end', servedBy: this.info, message: { role: 'assistant', text: 'ok', toolCalls: [] } };
      },
    };
    const jev = fakeJev(() => choice('direct', 0.9));
    const handler = createAssistantHandler({ loadConfig: () => cfg, provider: () => spy, log: () => undefined, router: (c) => createJevRouter(c.jev!, jev.fetchFn) });
    const status = await handler({ ...post(undefined), method: 'GET' });
    expect(status.json).toEqual({ available: true, model: spy.info, router: 'jev' });
    const res = await handler(post({ messages: [USER], tools: TOOLS }));
    let text = '';
    for await (const chunk of res.stream!) text += chunk;
    expect(seen).toHaveLength(1);
    expect(seen[0].effort).toBe('medium');
    expect(seen[0].tools.map((t) => t.name)).toEqual(TOOLS.map((t) => t.name));
    expect(JSON.parse(jev.calls[0].init.body).model).toBe('jev-preview');
    expect(text + JSON.stringify(status)).not.toContain(JEV_KEY);
  });
});
