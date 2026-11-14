// The whole assistant path in one process, without a network or a key:
//   browser session -> HTTP transport -> /api/assistant handler -> scripted model ->
//   streamed step -> tool calls run through the real action registry -> results back.
// The scripted model here is a small policy that reads tool results to decide its next
// calls, the way a language model would; the app is the fake navigator used by the
// assistant's unit tests (same action names and result shapes as the real one).
import { beforeEach, describe, expect, it } from 'vitest';
import { DeterministicEngine } from '../../src/assistant/deterministic/engine';
import type { StepRequest } from '../../src/assistant/protocol';
import { AssistantSession, type ChatMessage } from '../../src/assistant/session';
import { installFakeApp, metricsFor, NEARBY, T0, type FakeState } from '../../src/assistant/testing/fakeApp';
import { httpTransport } from '../../src/assistant/transport';
import { actionLog, runAction } from '../../src/core/actions';
import { loadConfig } from './env';
import { createAssistantHandler, type HttpRequest } from './handler';
import { defaultScript, ScriptedProvider, type Script } from './scripted';

type Row = Record<string, number | string>;

/** A fetch that calls the handler directly, streaming its answer like the dev server does. */
function handlerFetch(env: Record<string, string>, script: Script = defaultScript, seen: StepRequest[] = []): typeof fetch {
  const handler = createAssistantHandler({
    loadConfig: () => loadConfig({ processEnv: env, root: '/nonexistent-lunyx-root' }),
    provider: (cfg) => (cfg.provider === 'scripted' ? new ScriptedProvider(script, 'test') : null),
    log: () => undefined,
  });
  return (async (_url: Parameters<typeof fetch>[0], init?: Parameters<typeof fetch>[1]) => {
    const raw = typeof init?.body === 'string' ? init.body : '';
    const req: HttpRequest = { method: init?.method ?? 'GET', subpath: '', query: new URLSearchParams(), headers: {}, body: raw ? JSON.parse(raw) : undefined, rawBody: raw, signal: init?.signal ?? new AbortController().signal };
    if (req.method === 'POST' && req.body) seen.push(req.body as StepRequest);
    const res = await handler(req);
    if (!res.stream) return new Response(JSON.stringify(res.json ?? null), { status: res.status, headers: { 'content-type': 'application/json' } });
    const iterator = res.stream[Symbol.asyncIterator]();
    const enc = new TextEncoder();
    const body = new ReadableStream<Uint8Array>({
      async pull(controller) {
        const { value, done } = await iterator.next();
        if (done) controller.close();
        else controller.enqueue(typeof value === 'string' ? enc.encode(value) : value);
      },
    });
    return new Response(body, { status: res.status, headers: res.headers });
  }) as typeof fetch;
}

const newSession = (fetchFn: typeof fetch) => new AssistantSession({ transport: httpTransport(fetchFn), responder: new DeterministicEngine(undefined, { wait: () => Promise.resolve() }) });
const reply = (s: AssistantSession): ChatMessage => s.messages.filter((m) => m.role === 'assistant').at(-1)!;
const SCRIPTED = { LUNYX_LLM_PROVIDER: 'scripted' };

/**
 * A scripted policy for: "Find a flatter nearby site with a shorter blackout, compare it
 * against this pin for the same dates, then show me the ridge at Earthset."
 */
const scenario: Script = (ctx) => {
  const by = (name: string) => ctx.results.filter((r) => r.name === name).at(-1);
  const failed = ctx.results.find((r) => !r.ok);
  if (failed) return { text: `I could not finish: ${failed.name} failed (${failed.error}).` };
  const ranked = by('rankNearby');
  if (!ranked) return { text: 'Scanning nearby alternatives.', calls: [{ name: 'rankNearby', input: {} }] };
  const { reference, candidates } = ranked.value as { reference: Row; candidates: Row[] };
  const pick = candidates.find((c) => c.slopeDeg < reference.slopeDeg && c.longestDarknessH < reference.longestDarknessH);
  if (!pick) return { text: 'No nearby site is both flatter and has a shorter blackout than this pin.' };
  if (!by('compare')) {
    return { calls: [{ name: 'saveScenario', input: { slot: 'A' } }, { name: 'selectCandidate', input: { rank: pick.rank } }, { name: 'saveScenario', input: { slot: 'B' } }, { name: 'compare', input: {} }] };
  }
  if (!by('explainBlockage')) {
    return { calls: [{ name: 'jumpToEvent', input: { type: 'earthset' } }, { name: 'enterSurface', input: {} }, { name: 'explainBlockage', input: { body: 'earth' } }] };
  }
  const blockage = by('explainBlockage')!.value as Record<string, number | string>;
  if (!by('lookAt')) return { calls: [{ name: 'lookAt', input: { azDeg: blockage.bodyAzDeg, elDeg: blockage.skylineElDeg } }] };
  const jump = by('jumpToEvent')!.value as Record<string, string>;
  return {
    text:
      `${pick.name} is flatter (${pick.slopeDeg}° against ${reference.slopeDeg}°) and its longest darkness is shorter (${pick.longestDarknessH} h against ${reference.longestDarknessH} h). ` +
      `The comparison is open with this pin as A and ${pick.name} as B over the same mission window. ` +
      `At Earthset (${jump.timeUtc}) the view faces azimuth ${blockage.bodyAzDeg}°: ${blockage.explanation}`,
  };
};

describe('assistant loop end to end (scripted model, no key)', () => {
  let state: FakeState;
  beforeEach(() => {
    state = installFakeApp({ analysisActions: true });
  });

  it('completes the multi-step scenario and reports only values the app returned', async () => {
    const seen: StepRequest[] = [];
    const s = newSession(handlerFetch(SCRIPTED, scenario, seen));
    await s.refreshStatus();
    expect(s.mode).toMatchObject({ kind: 'model', model: { provider: 'scripted' } });
    // The user pins a south-polar site with the UI, then asks the assistant.
    await runAction('selectSite', { site: 'IM-2' }, 'ui');
    expect(state.site?.id).toBe('im-2');
    const pin = metricsFor(state.site!, 2, 0);

    await s.send('Find a flatter nearby site with a shorter blackout, compare it against this pin for the same dates, then show me the ridge at Earthset.');
    const r = reply(s);
    expect(r.source).toEqual({ kind: 'model', label: 'Scripted test model (not a language model)' });
    expect(r.failed).toBeUndefined();

    // What is left on screen: the comparison, the site, the time and the camera.
    expect(state.comparing).toBe(true);
    expect(state.compareA?.label).toBe('IM-2 Athena, from 2026-03-01T12:00Z for 24 h, mast 2 m');
    expect(state.compareB?.label).toBe('Candidate 2, from 2026-03-01T12:00Z for 24 h, mast 2 m');
    expect(state.site?.id).toBe('cand-2');
    expect(state.timeMs).toBe(T0 + 9 * 3_600_000);
    expect(state.view).toBe('surface');
    expect(state.look).toMatchObject({ azDeg: 348.4, elDeg: 2.31 });

    // What was done, in order, all through the registry with origin "assistant".
    expect(r.actions.map((a) => a.name)).toEqual(['rankNearby', 'saveScenario', 'selectCandidate', 'saveScenario', 'compare', 'jumpToEvent', 'enterSurface', 'explainBlockage', 'lookAt']);
    expect(r.actions.every((a) => a.ok && a.origin === 'assistant')).toBe(true);
    expect(actionLog().filter((e) => e.origin !== 'assistant').map((e) => e.name)).toEqual(['selectSite']);

    // Every number in the answer is one the app returned.
    const cand = NEARBY[1];
    expect(r.text).toContain(`Candidate 2 is flatter (${cand.slopeDeg}° against ${pin.slopeDeg}°)`);
    expect(r.text).toContain(`(${cand.longestDarknessH} h against ${pin.longestDarknessH} h)`);
    expect(r.text).toContain('At Earthset (2026-03-01T21:00Z) the view faces azimuth 348.4°');
    expect(r.text).toContain('Earth is hidden by a ridge 4.20 km away');

    // The server saw the registry's full tool list on every step, and an append-only history.
    const steps = seen.slice(-5);
    expect(steps).toHaveLength(5);
    for (const req of steps) expect(req.tools.map((t) => t.name).sort()).toEqual(actionNames());
    for (let i = 1; i < steps.length; i++) expect(steps[i].messages.slice(0, steps[i - 1].messages.length)).toEqual(steps[i - 1].messages);
  });

  it('lets the model see and recover from failing, unknown and malformed calls', async () => {
    const s = newSession(handlerFetch(SCRIPTED));
    await s.send('call enterSurface; call warpDrive {"factor":9}; call setDelay {"hours":"soon"}; call selectSite {"site":"Apollo 11"}; call enterSurface');
    const r = reply(s);
    expect(r.actions.map((a) => [a.name, a.ok])).toEqual([['enterSurface', false], ['warpDrive', false], ['setDelay', false], ['selectSite', true], ['enterSurface', true]]);
    expect(r.text).toContain('1. enterSurface: failed: No site is selected');
    expect(r.text).toContain('2. warpDrive: failed: Unknown action "warpDrive"');
    expect(r.text).toContain('3. setDelay: failed: params.hours must be a number');
    expect(r.text).toContain('5. enterSurface: {"view":"surface"');
    expect(state).toMatchObject({ view: 'surface', site: { id: 'apollo-11' } });
  });

  it('answers follow-ups against the current state', async () => {
    const s = newSession(handlerFetch(SCRIPTED));
    await s.send('call selectSite {"site":"IM-2"}');
    await s.send('what is on screen?');
    expect(reply(s).text).toContain('"site":{"id":"im-2"');
    await s.send('call setTime {"offsetHours":6}');
    await s.send('and now?');
    expect(reply(s).text).toContain('"timeUtc":"2026-03-01T18:00Z"');
    // The model's history holds all four exchanges, in order.
    expect(s.history().filter((m) => m.role === 'user')).toHaveLength(4);
  });

  it('uses deterministic mode, labelled, when the server has no key', async () => {
    const s = newSession(handlerFetch({}));
    await s.refreshStatus();
    expect(s.mode.kind).toBe('deterministic');
    await s.send('go to IM-2, then find a flatter nearby site with a shorter blackout, compare it against this pin for the same dates, then show me the ridge at Earthset');
    const r = reply(s);
    expect(r.source).toEqual({ kind: 'deterministic' });
    expect(state).toMatchObject({ comparing: true, view: 'surface', site: { id: 'cand-2' }, timeMs: T0 + 9 * 3_600_000, look: { azDeg: 348.4 } });
    expect(r.text).toContain('Found a site with flatter and a shorter blackout: Candidate 2');
  });

  it('never shows a credential to the browser, whatever the server holds', async () => {
    const KEY = 'sk-ant-test-CANARY-0123456789abcdef';
    const bodies: string[] = [];
    const inner = handlerFetch({ ...SCRIPTED, ANTHROPIC_API_KEY: KEY });
    const spy = (async (url: Parameters<typeof fetch>[0], init?: Parameters<typeof fetch>[1]) => {
      const res = await inner(url, init);
      bodies.push(await res.clone().text());
      return res;
    }) as typeof fetch;
    const s = newSession(spy);
    await s.refreshStatus();
    await s.send('call getState');
    await s.send('call nope');
    expect(bodies.length).toBeGreaterThan(3);
    expect(bodies.join('\n')).not.toContain(KEY);
    expect(JSON.stringify(s.messages)).not.toContain(KEY);
  });
});

function actionNames(): string[] {
  return ['clearSite', 'compare', 'dropPin', 'enterSurface', 'exitSurface', 'explainBlockage', 'getState', 'jumpToEvent', 'lookAt', 'pause', 'play', 'rankNearby', 'saveScenario', 'selectCandidate', 'selectSite', 'setDelay', 'setFilters', 'setGlobeCamera', 'setLightMode', 'setMastHeight', 'setMaxEarthGap', 'setMissionWindow', 'setOverlay', 'setRate', 'setSlopeLimit', 'setSunBand', 'setTime', 'showMissions', 'stopCompare'].sort();
}
