import { describe, expect, it } from 'vitest';
import type { NearbyCandidate, NearbyOptions, SiteAnalysis } from '../../analysis/types';
import { registerActions, resetActions, runAction } from '../../core/actions';
import { AnalysisStore } from '../../core/analysisStore';
import { createCoreActions } from '../../core/coreActions';
import { MissionFilterStore } from '../../core/missionFilter';
import { initialState, Store } from '../../core/store';
import type { Scenario } from '../../core/types';
import type { Landing } from '../../data/landings';
import { createCompareActions } from './actions';
import { distanceText } from './format';
import { bindScanSettings } from './scanSettings';
import { createPanelStore, type PanelStore } from './state';
import { createCompareStorage } from './storage';

const T0 = Date.UTC(2025, 2, 6, 17, 28);
const IM2: Landing = { id: 'im-2', name: 'IM-2 Athena', program: 'p', country: 'c', date: '2025-03-06', time: '17:28', lat: -84.79, lon: 29.2, crewed: false, region: 'r', summary: 's' } as Landing;

const fakeAnalysis = (sc: Scenario): SiteAnalysis =>
  ({
    scenario: sc,
    metrics: { illuminationPct: 40 + sc.mastHeightM, longestDarknessH: 10, darknessOpenEnded: false, earthVisiblePct: 80, longestEarthGapH: 3, earthGapOpenEnded: false },
    slope: { slopeDeg: 4, baselineM: 120 },
    warnings: [],
  }) as unknown as SiteAnalysis;

/** A scan as the science core returns it: the site itself and one ranked alternative 300 m east. */
const fakeScan = (sc: Scenario, o: NearbyOptions): NearbyCandidate[] =>
  [0, 300].map((eastM) => {
    const isReference = eastM === 0;
    const lon = sc.site.lon + eastM / 3_000;
    return {
      site: isReference ? sc.site : { id: `pin:${sc.site.lat.toFixed(5)},${lon.toFixed(5)}`, name: `Candidate ${eastM} m E of ${sc.site.name}`, kind: 'candidate', lat: sc.site.lat, lon },
      eastM, northM: 0, distanceM: eastM, bearingDeg: isReference ? NaN : 90, elevationM: 5000,
      slope: { slopeDeg: 3, aspectDeg: 0, baselineM: 120, demName: 'LOLA' },
      metrics: { illuminationPct: 90, earthVisiblePct: 100, longestDarknessH: 10, darknessOpenEnded: false, longestEarthGapH: 0, earthGapOpenEnded: false },
      rejected: null, score: 95 - eastM / 300, rank: isReference ? 0 : 1, isReference,
      basis: `Slope over 120 m from LOLA, limit ${o.slopeLimitDeg} deg.`,
    } as NearbyCandidate;
  });

/** A stand-in for NumberField (widgets.ts): what it shows, whether the person is in it, show(), which leaves a field with the focus alone, and read(). */
function field() {
  const f = {
    value: '',
    focused: false,
    show(v: number) {
      if (!f.focused) f.value = String(v);
    },
    read: () => (f.value.trim() === '' || !Number.isFinite(Number(f.value)) ? null : Number(f.value)),
    /** Typing: committed once the person has left the field, still being typed while they are in it. */
    type(text: string, stillTyping = false) {
      f.value = text;
      f.focused = stillTyping;
    },
  };
  return f;
}

/**
 * The Radius and Spacing fields of the nearby tab as nearbyTab.ts binds them, drawn again on every
 * change that panel.ts redraws the tab for while it is shown: the panel opening, the assistant
 * drawer, the tab shown, the panel's scan settings, the site and its mission window, the
 * requirements, and the scan's progress, result or error. `redraws` records each one with what
 * the fields showed after it.
 */
function nearbyTab(store: Store, panel: PanelStore, analysis: AnalysisStore) {
  const radius = field(), spacing = field();
  const showNewScanSettings = bindScanSettings(radius, spacing, { panel, analysis });
  const redraws: string[] = [];
  const seen: [redraw: string, radius: string, spacing: string][] = [];
  const render = (why: string) => {
    if (!store.get().comparing || panel.get().tab !== 'nearby') return;
    showNewScanSettings();
    redraws.push(why);
    seen.push([why, radius.value, spacing.value]);
  };
  store.subscribe(['comparing', 'assistantOpen'], (_, changed) => render(changed.has('comparing') ? 'panel shown' : 'assistant drawer'));
  panel.subscribe((_, changed) => {
    if (changed.has('tab')) render('tab shown');
    if (changed.has('nearbyRadiusM') || changed.has('nearbySpacingM')) render('scan settings');
  });
  store.subscribe(['site', 'mastHeightM', 'windowStartMs', 'windowDurationH', 'delayH'], () => render('scenario'));
  store.subscribe(['sunElMinDeg', 'sunElMaxDeg', 'maxEarthGapH', 'slopeLimitDeg'], () => render('requirement'));
  analysis.subscribe((slot) => slot === 'nearby' && render('scan'));
  /** "Scan nearby sites" (or Enter in a field), as nearbyTab.ts runs it: a scan of what the fields show; null when one holds no number (the tab then asks for numbers). */
  const scan = async (slopeLimitDeg: number) => {
    const r = radius.read(), s = spacing.read();
    if (r === null || s === null) return null;
    return run('rankNearby', { radiusM: r, spacingM: s, slopeLimitDeg }, 'ui');
  };
  return { radius, spacing, redraws, seen, scan };
}

/** The app with a science core whose scans wait for `control.finish` while `control.hold` is set, and fail while `control.fail` is. */
function setup() {
  resetActions();
  const store = new Store(initialState(T0));
  const scans: NearbyOptions[] = [];
  const control = { hold: false, fail: false, finish: [] as (() => void)[] };
  const analysis = new AnalysisStore(
    store,
    {
      analyse: (sc) => Promise.resolve(fakeAnalysis(sc)),
      rankNearby: (sc, o, onProgress) => {
        scans.push(o);
        const result = () => (control.fail ? Promise.reject(new Error('the 60 m window could not be read')) : Promise.resolve(fakeScan(sc, o)));
        if (!control.hold) return result();
        onProgress?.(1, 2);
        return new Promise<NearbyCandidate[]>((resolve, reject) => control.finish.push(() => (onProgress?.(2, 2), result().then(resolve, reject))));
      },
    },
    5,
  );
  void analysis.start();
  const panel = createPanelStore();
  const storage = createCompareStorage({ getItem: () => null, setItem: () => undefined });
  registerActions(createCoreActions({ store, filters: new MissionFilterStore(), landings: () => [IM2], analysis }));
  registerActions(createCompareActions({ store, analysis, panel, storage }));
  return { store, analysis, panel, scans, control, tab: nearbyTab(store, panel, analysis) };
}

const run = async (name: string, params: unknown = {}, origin: 'ui' | 'assistant' = 'assistant') => {
  const r = await runAction<any>(name, params, origin);
  if (!r.ok) throw new Error(`${name} failed: ${r.error}`);
  return r.result;
};

/** Drops the pin of the QA reproduction and opens the "Nearby sites" tab. */
async function pinAndOpenNearby() {
  const app = setup();
  await run('dropPin', { lat: -89.45, lon: -137.2 }, 'ui');
  await run('openCompare', { tab: 'nearby' }, 'ui');
  return app;
}

type App = ReturnType<typeof setup>;

describe('the nearby scan settings keep what was typed (Q-7)', () => {
  it('a typed radius survives a change of the slope limit, and the scan covers what the field shows', async () => {
    const { tab, scans, analysis } = await pinAndOpenNearby();
    expect([tab.radius.value, tab.spacing.value]).toEqual(['2000', '300']);
    tab.radius.type('900');
    tab.redraws.length = 0;
    await run('setSlopeLimit', { degrees: 30 }, 'ui');
    expect(tab.redraws).toEqual(['requirement']);
    expect(tab.radius.value).toBe('900');

    const r = await tab.scan(30);
    expect(r?.options).toEqual({ radiusM: 900, spacingM: 300, slopeLimitDeg: 30 });
    expect(scans.at(-1)).toMatchObject({ radiusM: 900, spacingM: 300, slopeLimitDeg: 30 });
    // The summary says "within 900 m", and the fields still show what was scanned.
    expect(distanceText(analysis.nearby().options!.radiusM)).toBe('900 m');
    expect([tab.radius.value, tab.spacing.value]).toEqual(['900', '300']);
  });

  // Every other change that redraws the tab, made by its action, with the redraw it causes. Pin and
  // "Compare as B" need a ranked list, so a scan comes before the typing.
  const changes: { what: string; redraw: string; change: (app: App) => Promise<unknown>; scanFirst?: boolean }[] = [
    { what: 'the slope limit', redraw: 'requirement', change: () => run('setSlopeLimit', { degrees: 25 }) },
    { what: "the Sun's elevation band", redraw: 'requirement', change: () => run('setSunBand', { minDeg: 2, maxDeg: 60 }) },
    { what: 'the Earth gap limit', redraw: 'requirement', change: () => run('setMaxEarthGap', { hours: 12 }) },
    { what: 'another pin', redraw: 'scenario', change: () => run('dropPin', { lat: -89.3, lon: -130 }) },
    { what: 'a catalogued site', redraw: 'scenario', change: () => run('selectSite', { site: 'im-2' }) },
    { what: 'no site, then a pin again', redraw: 'scenario', change: async () => (await run('clearSite'), run('dropPin', { lat: -89.3, lon: -130 })) },
    { what: 'Pin on a ranked row', redraw: 'scenario', change: () => run('selectCandidate', { rank: 1 }, 'ui'), scanFirst: true },
    { what: '"Compare as B" on a ranked row, then the tab again', redraw: 'tab shown', change: async () => (await run('selectCandidate', { rank: 1, asB: true }, 'ui'), run('openCompare', { tab: 'nearby' }, 'ui')), scanFirst: true },
    { what: 'the mast height', redraw: 'scenario', change: () => run('setMastHeight', { metres: 5 }) },
    { what: 'the mission window', redraw: 'scenario', change: () => run('setMissionWindow', { startUtc: '2025-04-01T00:00Z', durationH: 96 }) },
    { what: 'the arrival delay', redraw: 'scenario', change: () => run('setDelay', { hours: 12 }) },
    { what: 'another tab and back', redraw: 'tab shown', change: async () => (await run('openCompare', { tab: 'compare' }), run('openCompare', { tab: 'nearby' })) },
    { what: 'closing and reopening the panel', redraw: 'panel shown', change: async () => (await run('stopCompare'), run('openCompare', { tab: 'nearby' })) },
    { what: 'opening and closing the assistant drawer', redraw: 'assistant drawer', change: async ({ store }) => (store.set({ assistantOpen: true }), store.set({ assistantOpen: false })) },
  ];

  for (const { what, redraw, change, scanFirst } of changes) {
    it(`keeps a typed radius and spacing when ${what} redraws the tab`, async () => {
      const app = await pinAndOpenNearby();
      const { tab } = app;
      if (scanFirst) await run('rankNearby');
      tab.radius.type('900');
      tab.spacing.type('150');
      tab.redraws.length = 0;
      await change(app);
      expect(tab.redraws).toContain(redraw);
      expect([tab.radius.value, tab.spacing.value]).toEqual(['900', '150']);
      // The scan covers what the fields show.
      expect((await tab.scan(10))?.options).toMatchObject({ radiusM: 900, spacingM: 150 });
    });
  }

  // Still being typed: the person is in the field when the tab is drawn again, and leaves it without a scan.
  for (const name of ['radius', 'spacing'] as const) {
    for (const { what, redraw, change, scanFirst } of changes) {
      it(`keeps a ${name} still being typed when ${what} redraws the tab, and after the field is left`, async () => {
        const app = await pinAndOpenNearby();
        const { tab } = app;
        if (scanFirst) await run('rankNearby');
        const typed = name === 'radius' ? '900' : '150';
        tab[name].type(typed, true);
        tab.redraws.length = 0;
        await change(app);
        expect(tab.redraws).toContain(redraw);
        expect(tab[name].value).toBe(typed);
        tab[name].focused = false;
        await run('setSlopeLimit', { degrees: 33 });
        expect([tab.radius.value, tab.spacing.value]).toEqual(name === 'radius' ? ['900', '300'] : ['2000', '150']);
        expect((await tab.scan(10))?.options).toMatchObject(name === 'radius' ? { radiusM: 900, spacingM: 300 } : { radiusM: 2000, spacingM: 150 });
      });
    }
  }

  for (const outcome of ['result', 'error'] as const) {
    it(`what is typed while a scan runs survives its progress and its ${outcome}`, async () => {
      const { tab, control, analysis } = await pinAndOpenNearby();
      control.hold = true;
      control.fail = outcome === 'error';
      const first = tab.scan(10).catch((e: Error) => e.message);
      expect(analysis.nearby()).toMatchObject({ state: 'loading', progress: { done: 1, total: 2 } });
      tab.radius.type('600');
      tab.spacing.type('200', true);
      tab.redraws.length = 0;
      control.finish.shift()!();
      await first;
      expect(analysis.nearby().state).toBe(outcome === 'error' ? 'error' : 'ready');
      expect(tab.redraws.filter((r) => r === 'scan').length).toBeGreaterThanOrEqual(2);
      expect([tab.radius.value, tab.spacing.value]).toEqual(['600', '200']);
      tab.spacing.focused = false;
      control.hold = control.fail = false;
      expect((await tab.scan(10))?.options).toMatchObject({ radiusM: 600, spacingM: 200 });
    });
  }

  it('a scan with a new slope limit never shows other settings, though rankNearby sets the limit before the panel\'s settings', async () => {
    const { tab, store } = await pinAndOpenNearby();
    tab.radius.type('900');
    tab.spacing.type('150');
    tab.seen.length = 0;
    const r = await tab.scan(25);
    expect(store.get().slopeLimitDeg).toBe(25);
    expect(r?.options).toEqual({ radiusM: 900, spacingM: 150, slopeLimitDeg: 25 });
    expect(tab.seen.map(([why]) => why)).toEqual(expect.arrayContaining(['requirement', 'scan settings', 'scan']));
    expect(tab.seen.filter(([, radius, spacing]) => radius !== '900' || spacing !== '150')).toEqual([]);
  });

  it('a new scan puts its own settings in the fields, the assistant\'s too, even when they are the last scan\'s; a field being typed in keeps the typing', async () => {
    const { tab, panel } = await pinAndOpenNearby();
    // The assistant scans with the defaults, which are the panel's settings already: the fields show what it scans.
    tab.radius.type('900');
    tab.spacing.type('150');
    await run('rankNearby');
    expect(panel.get()).toMatchObject({ nearbyRadiusM: 2000, nearbySpacingM: 300 });
    expect([tab.radius.value, tab.spacing.value]).toEqual(['2000', '300']);

    await run('rankNearby', { radiusM: 1500, spacingM: 250 });
    expect([tab.radius.value, tab.spacing.value]).toEqual(['1500', '250']);

    // Someone typing in Radius when the assistant's scan starts keeps their typing; Spacing shows the scan's.
    tab.radius.type('700', true);
    await run('rankNearby', { radiusM: 1200, spacingM: 400 });
    expect([tab.radius.value, tab.spacing.value]).toEqual(['700', '400']);
    // And it stays after they leave the field, through the redraws that follow.
    tab.radius.focused = false;
    await run('setSlopeLimit', { degrees: 12 });
    expect(tab.radius.value).toBe('700');
  });

  for (const name of ['radius', 'spacing'] as const) {
    it(`an emptied ${name} stays empty through a redraw, so the scan asks for a number instead of covering another area`, async () => {
      const { tab, scans } = await pinAndOpenNearby();
      tab[name].type('');
      await run('setSlopeLimit', { degrees: 20 });
      expect(tab[name].value).toBe('');
      expect(await tab.scan(20)).toBeNull();
      expect(scans).toEqual([]);
    });
  }
});
