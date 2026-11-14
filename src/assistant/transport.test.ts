import { describe, expect, it } from 'vitest';
import type { StepEvent, StepRequest } from './protocol';
import { httpTransport } from './transport';

const REQ: StepRequest = { messages: [{ role: 'user', text: 'hi' }], tools: [] };
const MODEL = { provider: 'scripted', model: 'm', label: 'Scripted' };
const DONE: StepEvent = { type: 'done', stop: 'end', servedBy: MODEL, message: { role: 'assistant', text: 'héllo ✓', toolCalls: [] } };

/** A fetch whose response body arrives in the given byte chunks. */
function chunkedFetch(chunks: (string | Uint8Array)[], init: ResponseInit = { status: 200 }): { fetchFn: typeof fetch; calls: { url: string; init?: RequestInit }[] } {
  const calls: { url: string; init?: RequestInit }[] = [];
  const fetchFn = (async (url: RequestInfo | URL, reqInit?: RequestInit) => {
    calls.push({ url: String(url), init: reqInit });
    const enc = new TextEncoder();
    const body = new ReadableStream<Uint8Array>({
      start(controller) {
        for (const c of chunks) controller.enqueue(typeof c === 'string' ? enc.encode(c) : c);
        controller.close();
      },
    });
    return new Response(body, init);
  }) as typeof fetch;
  return { fetchFn, calls };
}

async function collect(it: AsyncIterable<StepEvent>): Promise<StepEvent[]> {
  const out: StepEvent[] = [];
  for await (const e of it) out.push(e);
  return out;
}

const signal = () => new AbortController().signal;

describe('assistant transport', () => {
  it('posts the step as JSON and parses events across arbitrary chunk boundaries', async () => {
    const lines = [{ type: 'meta', ...MODEL }, { type: 'text', delta: 'hé' }, { type: 'text', delta: 'llo ✓' }, DONE].map((e) => `${JSON.stringify(e)}\n`).join('');
    const bytes = new TextEncoder().encode(lines);
    // Split in the middle of lines and in the middle of a multi-byte character.
    const cut = [7, 61, 62, 100, bytes.length - 3];
    const chunks = cut.map((end, i) => bytes.slice(i === 0 ? 0 : cut[i - 1], end)).concat([bytes.slice(cut.at(-1)!)]);
    const { fetchFn, calls } = chunkedFetch(chunks);
    const events = await collect(httpTransport(fetchFn).step(REQ, signal()));
    expect(events.map((e) => e.type)).toEqual(['meta', 'text', 'text', 'done']);
    expect(events.at(-1)).toEqual(DONE);
    expect(calls[0].url).toBe('/api/assistant');
    expect(calls[0].init?.method).toBe('POST');
    expect(JSON.parse(String(calls[0].init?.body))).toEqual(REQ);
  });

  it('accepts a final line without a newline and ignores junk lines', async () => {
    const { fetchFn } = chunkedFetch(['not json\n', '{"type":"mystery"}\n', '\n', JSON.stringify(DONE)]);
    expect(await collect(httpTransport(fetchFn).step(REQ, signal()))).toEqual([DONE]);
  });

  it('stops at the first final event and reports a stream that ends early', async () => {
    const twice = chunkedFetch([`${JSON.stringify(DONE)}\n${JSON.stringify({ type: 'text', delta: 'late' })}\n`]);
    expect(await collect(httpTransport(twice.fetchFn).step(REQ, signal()))).toEqual([DONE]);
    const early = chunkedFetch([`${JSON.stringify({ type: 'text', delta: 'a' })}\n`]);
    const events = await collect(httpTransport(early.fetchFn).step(REQ, signal()));
    expect(events.at(-1)).toMatchObject({ type: 'error', error: { kind: 'server' } });
  });

  it('maps HTTP failures to error events', async () => {
    const json = (status: number, body: unknown) => chunkedFetch([JSON.stringify(body)], { status, headers: { 'content-type': 'application/json' } }).fetchFn;
    const first = async (fetchFn: typeof fetch) => (await collect(httpTransport(fetchFn).step(REQ, signal())))[0];
    expect(await first(json(503, { error: { kind: 'no_model', message: 'No key.' } }))).toEqual({ type: 'error', error: { kind: 'no_model', message: 'No key.', status: 503 } });
    expect(await first(json(400, { error: { kind: 'invalid_request', message: 'Bad.' } }))).toMatchObject({ error: { kind: 'invalid_request', message: 'Bad.' } });
    // The stub from the app shell, a static host, or a body that is not ours.
    expect(await first(json(501, { error: '/api/assistant is not implemented yet.' }))).toMatchObject({ error: { kind: 'no_model' } });
    expect(await first(json(404, { error: 'No API named "assistant".' }))).toMatchObject({ error: { kind: 'no_model' } });
    expect(await first(json(413, { error: 'Request body too large.' }))).toMatchObject({ error: { kind: 'invalid_request' } });
    expect(await first(json(500, { error: 'Internal error in the API handler.' }))).toMatchObject({ error: { kind: 'server', status: 500 } });
  });

  it('treats an unreachable server as "no model" and an abort as a stop', async () => {
    const down = (async () => {
      throw new TypeError('fetch failed');
    }) as unknown as typeof fetch;
    expect(await collect(httpTransport(down).step(REQ, signal()))).toMatchObject([{ type: 'error', error: { kind: 'no_model' } }]);
    const controller = new AbortController();
    controller.abort();
    const aborted = (async () => {
      throw Object.assign(new Error('aborted'), { name: 'AbortError' });
    }) as unknown as typeof fetch;
    expect(await collect(httpTransport(aborted).step(REQ, controller.signal))).toMatchObject([{ type: 'error', error: { kind: 'aborted' } }]);
  });

  it('reads the status, and reports unavailable for anything unexpected', async () => {
    const json = (status: number, body: unknown) => chunkedFetch([JSON.stringify(body)], { status }).fetchFn;
    expect(await httpTransport(json(200, { available: true, model: MODEL, router: 'direct' })).status()).toEqual({ available: true, model: MODEL, router: 'direct' });
    expect(await httpTransport(json(200, { available: false, model: null, router: 'direct', reason: 'No key.' })).status()).toMatchObject({ available: false, reason: 'No key.' });
    expect(await httpTransport(json(501, { error: 'stub' })).status()).toMatchObject({ available: false });
    expect(await httpTransport(json(200, '<html>')).status()).toMatchObject({ available: false });
    const down = (async () => {
      throw new TypeError('fetch failed');
    }) as unknown as typeof fetch;
    expect(await httpTransport(down).status()).toMatchObject({ available: false, model: null });
  });
});
