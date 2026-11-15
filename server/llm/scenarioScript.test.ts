// The "scenario" script of the scripted test model, in process: session -> transport ->
// handler -> scripted model -> tool calls run through the registry of the stand-in app. Checks
// that it plays the three steps from tool results, in one message or as follow-ups, and that
// every number it writes is one it was sent back.
import { beforeEach, describe, expect, it } from 'vitest';
import { DeterministicEngine } from '../../src/assistant/deterministic/engine';
import { AssistantSession, type ChatMessage } from '../../src/assistant/session';
import { ALL_ACTIONS, installFakeApp, T0, type FakeAppOptions, type FakeState } from '../../src/assistant/testing/fakeApp';
import { httpTransport } from '../../src/assistant/transport';
import { actionLog, runAction } from '../../src/core/actions';
import { loadConfig } from './env';
import { createAssistantHandler, type HttpRequest } from './handler';
import { pickCandidate, scenarioScript } from './scenarioScript';
import { getScript, ScriptedProvider } from './scripted';

function handlerFetch(): typeof fetch {
  const handler = createAssistantHandler({
    loadConfig: () => loadConfig({ processEnv: { LUNYX_LLM_PROVIDER: 'scripted', LUNYX_LLM_SCRIPT: 'scenario' }, root: '/nonexistent-lunyx-root' }),
    provider: (cfg) => (cfg.provider === 'scripted' ? new ScriptedProvider(getScript(cfg.script)!, cfg.script) : null),
    log: () => undefined,
  });
  return (async (_url: Parameters<typeof fetch>[0], init?: Parameters<typeof fetch>[1]) => {
    const raw = typeof init?.body === 'string' ? init.body : '';
    const req: HttpRequest = { method: init?.method ?? 'GET', subpath: '', query: new URLSearchParams(), headers: {}, body: raw ? JSON.parse(raw) : undefined, rawBody: raw, signal: init?.signal ?? new AbortController().signal };
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

const session = () => new AssistantSession({ transport: httpTransport(handlerFetch()), responder: new DeterministicEngine(undefined, { wait: () => Promise.resolve() }) });
const reply = (s: AssistantSession): ChatMessage => s.messages.filter((m) => m.role === 'assistant').at(-1)!;
const ranSince = (from: number) => actionLog().filter((e) => e.origin === 'assistant' && e.seq > from);
const lastSeq = () => actionLog().at(-1)?.seq ?? 0;
type Row = Record<string, number | string>;

describe('scripted test model, scenario script', () => {
  let state: FakeState;
  const install = (options: FakeAppOptions = ALL_ACTIONS) => {
    state = installFakeApp(options);
  };
  beforeEach(async () => {
    install();
    await runAction('selectSite', { site: 'im-2' }, 'test');
  });

  it('is registered under its name', () => {
    expect(getScript('scenario')).toBe(scenarioScript);
  });

  it('plays the three steps as follow-ups, each on what the previous one left, and quotes only results', async () => {
    const s = session();
    let from = lastSeq();
    await s.send('Find a flatter nearby site with a shorter blackout');
    const scan = ranSince(from);
    expect(scan.map((e) => e.name)).toEqual(['rankNearby']);
    const { pick, reference } = pickCandidate(scan[0].result) as { pick: Row; reference: Row };
    expect(pick.id).toBe('cand-2');
    let r = reply(s);
    expect(r.source).toEqual({ kind: 'model', label: 'Scripted test model (not a language model)' });
    for (const x of [pick.slopeDeg, reference.slopeDeg, pick.longestDarknessH, reference.longestDarknessH, pick.illuminationPct, pick.earthVisiblePct]) expect(r.text).toContain(String(x));
    expect(state.site?.id).toBe('im-2');

    from = lastSeq();
    await s.send('compare it against this pin for the same dates');
    expect(ranSince(from).map((e) => e.name)).toEqual(['saveScenario', 'selectCandidate', 'saveScenario', 'compare', 'openCompare']);
    const cmp = ranSince(from).find((e) => e.name === 'compare')!.result as Record<string, Row & { illuminationPct: number }>;
    r = reply(s);
    expect(r.text).toContain(`A = ${cmp.A}`);
    expect(r.text).toContain(`B = ${cmp.B}`);
    expect(r.text).toContain(`B minus A: sunlight ${cmp.diff.illuminationPct} points`);
    expect(state).toMatchObject({ site: { id: 'cand-2' }, comparing: true, panelTab: 'compare' });

    from = lastSeq();
    await s.send('then show me the ridge at Earthset');
    expect(ranSince(from).map((e) => e.name)).toEqual(['jumpToEvent', 'explainBlockage', 'enterSurface', 'lookAt']);
    const blockage = ranSince(from).find((e) => e.name === 'explainBlockage')!.result as Row;
    r = reply(s);
    expect(r.text).toContain(`terrain ${blockage.ridgeDistanceM} m away, ${blockage.ridgeHeightM} m above the reference sphere (${blockage.demName}, ${blockage.demResolutionM} m)`);
    expect(r.text).toContain('not a radio link');
    expect(state).toMatchObject({ view: 'surface', timeMs: T0 + 9 * 3_600_000, look: { azDeg: 348.4, elDeg: 2.31 }, site: { id: 'cand-2' }, comparing: true });
  });

  it('plays all three in one message', async () => {
    const s = session();
    const from = lastSeq();
    await s.send('Find a flatter nearby site with a shorter blackout, compare it against this pin for the same dates, then show me the ridge at Earthset.');
    expect(ranSince(from).map((e) => e.name)).toEqual(['rankNearby', 'saveScenario', 'selectCandidate', 'saveScenario', 'compare', 'openCompare', 'jumpToEvent', 'explainBlockage', 'enterSurface', 'lookAt']);
    // One line per step after the heading, all from this one turn.
    const answer = reply(s).text;
    expect(answer.slice(answer.indexOf('Scripted test model:\n')).split('\n')).toHaveLength(4);
  });

  it('puts "this pin" back on screen before comparing when another site was selected meanwhile', async () => {
    const s = session();
    await s.send('find a flatter nearby site with a shorter blackout');
    await runAction('selectSite', { site: 'apollo-11' }, 'test');
    const from = lastSeq();
    await s.send('compare it against this pin');
    expect(ranSince(from).map((e) => e.name)).toEqual(['selectSite', 'saveScenario', 'selectCandidate', 'saveScenario', 'compare', 'openCompare']);
    expect(state.compareA?.label).toContain('IM-2 Athena');
  });

  it('reads the ridge from getAnalysis on a build without explainBlockage', async () => {
    install({ ...ALL_ACTIONS, analysisActions: false });
    // rankNearby and selectCandidate come with analysisActions in the stand-in: this build has neither, so only step 3 is possible.
    await runAction('selectSite', { site: 'im-2' }, 'test');
    const s = session();
    const from = lastSeq();
    await s.send('show me the ridge at Earthset');
    expect(ranSince(from).map((e) => e.name)).toEqual(['jumpToEvent', 'getAnalysis', 'enterSurface', 'lookAt']);
    expect(reply(s).text).toContain('terrain 4200 m away, 1385 m above the reference sphere (LOLA 60 m polar grid, 60 m)');
    expect(state.look).toMatchObject({ azDeg: 351, elDeg: 6.4 });
  });

  it('says what failed and stops', async () => {
    const s = session();
    await s.send('compare it against this pin');
    expect(reply(s).text).toContain('There is no earlier scan to compare against');
    expect(ranSince(0).filter((e) => e.name === 'saveScenario')).toHaveLength(0);
  });
});
