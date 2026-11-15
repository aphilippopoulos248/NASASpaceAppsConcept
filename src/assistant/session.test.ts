// The conversation session against a scripted transport: which path answers, what the
// model's history contains, and what the user is told when things go wrong.
import { beforeEach, describe, expect, it } from 'vitest';
import { DeterministicEngine } from './deterministic/engine';
import { DETERMINISTIC_LABEL, LIMITS, type AssistantStatus, type ModelInfo, type StepEvent, type StepRequest } from './protocol';
import { AssistantSession, type ChatMessage } from './session';
import { installFakeApp, type FakeState } from './testing/fakeApp';
import type { Transport } from './transport';

const MODEL: ModelInfo = { provider: 'scripted', model: 'script:test', label: 'Scripted test model (not a language model)' };
const AVAILABLE: AssistantStatus = { available: true, model: MODEL, router: 'direct' };
const NO_MODEL: AssistantStatus = { available: false, model: null, router: 'direct', reason: 'No language model key on this server.' };

type StepScript = (req: StepRequest, call: number) => StepEvent[];

function fakeTransport(status: AssistantStatus | (() => AssistantStatus), script: StepScript = () => []) {
  const requests: StepRequest[] = [];
  let statusCalls = 0;
  const transport: Transport = {
    async status() {
      statusCalls++;
      return typeof status === 'function' ? status() : status;
    },
    async *step(req, signal) {
      requests.push(structuredClone(req));
      for (const e of script(req, requests.length - 1)) {
        if (signal.aborted) {
          yield { type: 'error', error: { kind: 'aborted', message: 'Stopped.' } };
          return;
        }
        yield e;
      }
    },
  };
  return { transport, requests, statusCalls: () => statusCalls };
}

const meta: StepEvent = { type: 'meta', ...MODEL };
const done = (text: string, calls: { name: string; input?: unknown }[] = [], id = 'c'): StepEvent => ({
  type: 'done', stop: calls.length ? 'tool_calls' : 'end', servedBy: MODEL,
  message: { role: 'assistant', text, toolCalls: calls.map((c, i) => ({ id: `${id}${i}`, name: c.name, input: c.input ?? {} })), provider: { id: 'scripted', blocks: null } },
});

const session = (transport: Transport) => new AssistantSession({ transport, responder: new DeterministicEngine(undefined, { wait: () => Promise.resolve() }) });
const reply = (s: AssistantSession): ChatMessage => s.messages.filter((m) => m.role === 'assistant').at(-1)!;

describe('assistant session', () => {
  let state: FakeState;
  beforeEach(() => {
    state = installFakeApp();
  });

  it('keeps real web lookups separate from app actions and preserves the sourced reply', async () => {
    const t = fakeTransport(AVAILABLE, () => [meta, { type: 'web_search', query: 'NASA Apollo 11 landing' }, done('Published source: https://www.nasa.gov/')]);
    const s = session(t.transport);
    await s.send('Look up Apollo 11 on the web.');
    expect(reply(s)).toMatchObject({ searches: ['NASA Apollo 11 landing'], text: 'Published source: https://www.nasa.gov/', actions: [], pending: false });
  });

  it('answers in deterministic mode, labelled, when the server has no model', async () => {
    const t = fakeTransport(NO_MODEL);
    const s = session(t.transport);
    await s.send('go to Apollo 11');
    expect(s.mode).toEqual({ kind: 'deterministic', reason: 'No language model key on this server.' });
    expect(reply(s)).toMatchObject({ source: { kind: 'deterministic' }, pending: false });
    expect(reply(s).text).toContain('Selected Apollo 11');
    expect(reply(s).actions.map((a) => a.name)).toEqual(['selectSite']);
    expect(state.site?.id).toBe('apollo-11');
    // No step request is made without a model.
    expect(t.requests).toHaveLength(0);
    expect(DETERMINISTIC_LABEL).toBe('Deterministic mode: no language model');
    // Every deterministic reply is marked as such, including "not understood".
    await s.send('do something clever');
    expect(reply(s).source).toEqual({ kind: 'deterministic' });
    expect(reply(s).text).toContain('I did not understand');
  });

  it('keeps deterministic exchanges in the history a model would later receive, as plain text', async () => {
    let status = NO_MODEL;
    const t = fakeTransport(() => status, () => [meta, done('Hello from the model.')]);
    const s = session(t.transport);
    await s.send('go to Apollo 11');
    status = AVAILABLE;
    await s.refreshStatus(true);
    await s.send('and now?');
    expect(t.requests[0].messages.map((m) => m.role)).toEqual(['user', 'assistant', 'user']);
    expect(t.requests[0].messages[1]).toMatchObject({ role: 'assistant', toolCalls: [] });
    expect(reply(s)).toMatchObject({ text: 'Hello from the model.', source: { kind: 'model', label: MODEL.label, provider: MODEL.provider } });
  });

  it('sends the registry tools and the state snapshot, and runs the model\'s calls through the registry', async () => {
    const t = fakeTransport(AVAILABLE, (_req, call) =>
      call === 0
        ? [meta, { type: 'text', delta: 'Selecting ' }, { type: 'text', delta: 'it.' }, done('Selecting it.', [{ name: 'selectSite', input: { site: 'IM-2' } }, { name: 'enterSurface' }])]
        : [meta, done('You are on the surface at IM-2 Athena.')],
    );
    const s = session(t.transport);
    await s.send('take me to IM-2 and land');
    expect(state).toMatchObject({ view: 'surface', site: { id: 'im-2' } });
    const first = t.requests[0];
    expect(first.tools.map((x) => x.name)).toContain('selectSite');
    expect(first.tools.find((x) => x.name === 'getState')?.description).toContain('(Read-only.)');
    expect(first.messages).toHaveLength(1);
    expect(first.messages[0]).toMatchObject({ role: 'user', text: 'take me to IM-2 and land', state: { view: 'globe', site: null } });
    // Second step: the assistant turn is replayed exactly as received, followed by one message with both results.
    const second = t.requests[1];
    expect(second.messages.map((m) => m.role)).toEqual(['user', 'assistant', 'tool']);
    expect(second.messages[1]).toMatchObject({ provider: { id: 'scripted', blocks: null } });
    expect(second.messages[2]).toMatchObject({ results: [{ id: 'c0', name: 'selectSite', ok: true }, { id: 'c1', name: 'enterSurface', ok: true }] });
    expect(JSON.parse((second.messages[2] as any).results[1].content)).toMatchObject({ view: 'surface', site: { id: 'im-2' } });
    const r = reply(s);
    expect(r.text).toBe('Selecting it.\n\nYou are on the surface at IM-2 Athena.');
    expect(r.actions.map((a) => [a.name, a.origin, a.ok])).toEqual([['selectSite', 'assistant', true], ['enterSurface', 'assistant', true]]);
    expect(s.busy).toBe(false);
  });

  it('returns unknown tools, malformed arguments and failing actions to the model as errors, without stopping', async () => {
    const t = fakeTransport(AVAILABLE, (_req, call) =>
      call === 0
        ? [meta, done('', [
            { name: 'launchRocket', input: { now: true } },
            { name: 'setOverlay', input: { mode: 'purple' } },
            { name: 'setTime', input: 'tomorrow' },
            { name: 'setDelay', input: { hours: '24' } },
            { name: 'enterSurface' },
            { name: 'setOverlay', input: { mode: 'sun-band', extra: 1 } },
          ])]
        : [meta, done('Those did not work.')],
    );
    const s = session(t.transport);
    await s.send('try things');
    const results = (t.requests[1].messages[2] as any).results as { ok: boolean; content: string }[];
    expect(results.map((r) => r.ok)).toEqual([false, false, false, false, false, false]);
    expect(results[0].content).toBe('Unknown action "launchRocket"');
    expect(results[1].content).toContain('params.mode must be one of');
    expect(results[2].content).toBe('params must be an object');
    expect(results[3].content).toBe('params.hours must be a number');
    expect(results[4].content).toContain('No site is selected');
    expect(results[5].content).toContain('params.extra is not a known parameter');
    expect(state.overlay).toBe('off');
    expect(reply(s).actions.map((a) => a.ok)).toEqual([false, false, false, false, false, false]);
    expect(reply(s).text).toBe('Those did not work.');
  });

  it('falls back to deterministic mode for this message when the model fails before doing anything', async () => {
    const t = fakeTransport(AVAILABLE, () => [meta, { type: 'error', error: { kind: 'rate_limit', message: 'The Claude API rate limit was reached. Wait a moment and try again.' } }]);
    const s = session(t.transport);
    await s.send('go to Apollo 11');
    const r = reply(s);
    expect(r.source).toEqual({ kind: 'deterministic' });
    expect(r.note).toContain('The language model could not answer: The Claude API rate limit was reached');
    expect(state.site?.id).toBe('apollo-11');
    // The model stays selected for the next message.
    expect(s.mode.kind).toBe('model');
    // The failed turn was taken back; the deterministic exchange is recorded once.
    expect(s.history().map((m) => m.role)).toEqual(['user', 'assistant']);
  });

  it('switches to deterministic mode when the server reports no model mid-conversation', async () => {
    const t = fakeTransport(AVAILABLE, () => [{ type: 'error', error: { kind: 'no_model', message: 'The assistant server cannot be reached, so no language model is available.' } }]);
    const s = session(t.transport);
    await s.send('status');
    expect(s.mode).toEqual({ kind: 'deterministic', reason: 'The assistant server cannot be reached, so no language model is available.' });
    expect(reply(s).source).toEqual({ kind: 'deterministic' });
    expect(reply(s).note).toBeUndefined();
  });

  it('does not re-run anything when the model fails after actions were applied', async () => {
    const t = fakeTransport(AVAILABLE, (_req, call) => (call === 0 ? [meta, done('', [{ name: 'selectSite', input: { site: 'Apollo 11' } }])] : [{ type: 'error', error: { kind: 'overloaded', message: 'The Claude API is unavailable or overloaded right now (HTTP 529). Try again shortly.' } }]));
    const s = session(t.transport);
    await s.send('go to Apollo 11 and tell me about it');
    const r = reply(s);
    expect(r.failed).toBe(true);
    expect(r.source).toEqual({ kind: 'model', label: MODEL.label, provider: MODEL.provider });
    expect(r.note).toContain('overloaded');
    expect(r.note).toContain('The actions above were applied');
    expect(r.actions.map((a) => a.name)).toEqual(['selectSite']);
    // History stays continuable: the tool results are the last entry.
    expect(s.history().map((m) => m.role)).toEqual(['user', 'assistant', 'tool']);
  });

  it('shows a refusal as the reply, runs nothing and keeps the model path', async () => {
    const t = fakeTransport(AVAILABLE, () => [meta, { type: 'text', delta: 'Sure' }, { type: 'reset' }, { type: 'done', stop: 'refusal', servedBy: MODEL, message: { role: 'assistant', text: 'The language model declined this request.', toolCalls: [] } }]);
    const s = session(t.transport);
    await s.send('something refused');
    expect(reply(s).text).toBe('The language model declined this request.');
    expect(reply(s).actions).toEqual([]);
    expect(s.mode.kind).toBe('model');
  });

  it('stops after the step limit instead of looping forever', async () => {
    const t = fakeTransport(AVAILABLE, (_req, call) => [meta, done('', [{ name: 'getState' }], `s${call}-`)]);
    const s = session(t.transport);
    await s.send('loop');
    expect(t.requests).toHaveLength(LIMITS.maxStepsPerTurn);
    expect(reply(s).note).toContain(`Stopped after ${LIMITS.maxStepsPerTurn} steps`);
    expect(s.busy).toBe(false);
  });

  it('can be stopped: pending calls are answered as not run and the history stays valid', async () => {
    let s!: AssistantSession;
    const t = fakeTransport(AVAILABLE, (_req, call) => {
      if (call === 0) {
        // The user presses stop while the first step is arriving.
        queueMicrotask(() => s.stop());
        return [meta, done('', [{ name: 'selectSite', input: { site: 'Apollo 11' } }, { name: 'enterSurface' }])];
      }
      return [meta, done('unreachable')];
    });
    s = session(t.transport);
    await s.send('go and land');
    expect(reply(s).note).toContain('Stopped');
    expect(state.view).toBe('globe');
    const last = s.history().at(-1);
    if (last?.role === 'tool') expect(last.results.every((r) => r.ok || r.content.includes('stopped the assistant'))).toBe(true);
    expect(s.busy).toBe(false);
    expect(t.requests).toHaveLength(1);
  });

  it('starts a fresh model context when the history gets close to the request limit', async () => {
    const big = 'x'.repeat(LIMITS.maxToolResultChars);
    const t = fakeTransport(AVAILABLE, () => [meta, done(big)]);
    const s = session(t.transport);
    for (let i = 0; i < 30; i++) await s.send(`message ${i}`);
    const sizes = t.requests.map((r) => JSON.stringify(r).length);
    expect(Math.max(...sizes)).toBeLessThan(LIMITS.maxRequestBytes);
    expect(s.messages.some((m) => m.role === 'notice' && m.text.includes('no longer sent to the language model'))).toBe(true);
    expect(t.requests.at(-1)!.messages.length).toBeLessThan(60);
  });

  it('refuses overlong input and ignores a second send while busy', async () => {
    const t = fakeTransport(AVAILABLE, () => [meta, done('ok')]);
    const s = session(t.transport);
    await s.send('y'.repeat(LIMITS.maxUserTextChars + 1));
    expect(s.messages.at(-1)).toMatchObject({ role: 'notice' });
    expect(t.requests).toHaveLength(0);
    const first = s.send('one');
    await s.send('two');
    await first;
    expect(s.messages.filter((m) => m.role === 'user').map((m) => m.text)).toEqual(['one']);
  });

  it('clears the conversation without touching the app', async () => {
    const t = fakeTransport(AVAILABLE, (_req, call) => (call === 0 ? [meta, done('', [{ name: 'selectSite', input: { site: 'Apollo 11' } }], 'a')] : [meta, done('x')]));
    const s = session(t.transport);
    await s.send('go');
    s.clear();
    expect(s.messages).toEqual([]);
    expect(s.history()).toEqual([]);
    expect(state.site?.id).toBe('apollo-11');
  });

  it('notifies subscribers while text streams', async () => {
    const t = fakeTransport(AVAILABLE, () => [meta, { type: 'text', delta: 'a' }, { type: 'text', delta: 'b' }, done('ab')]);
    const s = session(t.transport);
    const seen: string[] = [];
    s.subscribe(() => {
      const r = s.messages.filter((m) => m.role === 'assistant').at(-1);
      if (r) seen.push(r.text);
    });
    await s.send('hi');
    expect(seen).toContain('a');
    expect(seen).toContain('ab');
  });
});
