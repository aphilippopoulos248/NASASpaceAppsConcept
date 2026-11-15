// Registered actions of the surface HUD (decision D-1): the skyline chart's display, the
// key-metrics panel, and the blockage explanation. The chart and the panel call these
// through runAction; the assistant gets them as tools. jumpToEvent, getAnalysis, setTime
// and lookAt are core actions and are only used here, not registered again.
import { blockageAt } from '../../analysis/api';
import type { Blockage } from '../../analysis/types';
import { ActionError, defineAction, registerActions, type ActionDef } from '../../core/actions';
import type { AnalysisStore } from '../../core/analysisStore';
import type { Store } from '../../core/store';
import { isoUtc, parseUtc } from '../../core/time';
import { hudState, setHudState } from './hudState';

export interface HudActionContext {
  store: Store;
  analysis: AnalysisStore;
}

const round = (v: number | undefined, digits: number): number | null => (v === undefined || !Number.isFinite(v) ? null : Number(v.toFixed(digits)));

/**
 * The HUD draws on the next animation frame. An action that says "it is on screen" waits for
 * that frame, so whoever called it (a button, the assistant, a test) can look at once. A page
 * in the background gets no frames: there the wait ends after a quarter of a second.
 */
function drawn(): Promise<void> {
  if (typeof requestAnimationFrame !== 'function') return Promise.resolve();
  return new Promise((resolve) => {
    const timer = setTimeout(resolve, 250);
    requestAnimationFrame(() => {
      clearTimeout(timer);
      resolve();
    });
  });
}

/** A blockage as an action result: units in the names, nothing that is not a number left as NaN. */
export function blockageResult(b: Blockage) {
  return {
    body: b.body,
    timeUtc: isoUtc(b.timeMs),
    blocked: b.blocked,
    bodyAzDeg: round(b.bodyAzDeg, 2),
    bodyElDeg: round(b.bodyElDeg, 2),
    skylineElDeg: round(b.skylineElDeg, 2),
    clearanceDeg: round(b.clearanceDeg, 2),
    discVisiblePct: round(b.discVisibleFraction === undefined ? undefined : b.discVisibleFraction * 100, 0),
    ...(b.body === 'sun' && { sunCoveredByEarthPct: round(b.eclipsedFraction === undefined ? undefined : b.eclipsedFraction * 100, 0) }),
    ridgeDistanceM: round(b.ridgeDistanceM, 0),
    ridgeHeightM: round(b.ridgeHeightM, 0),
    ridgeLatDeg: round(b.ridge.lat, 4),
    ridgeLonDegEast: round(b.ridge.lon, 4),
    demName: b.demName,
    demResolutionM: round(b.demResolutionM, 0),
    explanation: b.explanation,
  };
}

export function createHudActions(ctx: HudActionContext): ActionDef<any, any>[] {
  const { store, analysis } = ctx;
  const chartResult = () => {
    const h = hudState();
    return { chart: h.chart, mode: h.chartMode, table: h.chartTable, azimuthRange: h.chartFit };
  };

  return [
    defineAction<{ body: 'sun' | 'earth'; utc?: string }, unknown>({
      name: 'explainBlockage',
      title: 'Explain what hides the Sun or Earth',
      description:
        'Says why the Sun or Earth is hidden at the selected site, or by how much it clears the skyline: the body\'s azimuth and elevation, the skyline there, and the terrain that forms it (distance, height, coordinates, elevation data and its resolution), with a sentence stating it. Uses the simulated time unless `utc` is given ("YYYY-MM-DDTHH:MMZ"). The explanation is also put on screen next to the skyline chart. Earth visibility is geometric line of sight, not a radio link. Waits for the site analysis.',
      effect: 'command',
      params: {
        type: 'object',
        properties: {
          body: { type: 'string', description: 'Which body.', enum: ['sun', 'earth'] },
          utc: { type: 'string', description: 'Instant to explain (UTC). Default: the simulated time.' },
        },
        required: ['body'],
      },
      run: async ({ body, utc }) => {
        let timeMs = store.get().timeMs;
        if (utc !== undefined) {
          try {
            timeMs = parseUtc(utc);
          } catch (err) {
            throw new ActionError((err as Error).message);
          }
        }
        const st = await analysis.settled('current');
        if (st.state === 'idle') throw new ActionError('No site is selected. Select a landing site or drop a pin first.');
        if (st.state !== 'ready') throw new ActionError(st.state === 'error' ? `The site analysis is not available: ${st.error}` : 'The site analysis has not finished. Ask again in a moment.');
        const blockage = blockageAt(st.value, body, timeMs);
        setHudState({ explanation: { blockage, scenarioId: st.scenario.id, siteElevationM: st.value.horizon.siteElevationM } });
        await drawn();
        return { ...blockageResult(blockage), site: st.scenario.site.name, shownInHud: true };
      },
    }),
    defineAction({
      name: 'dismissBlockageExplanation',
      title: 'Close the blockage explanation',
      description: 'Removes the blockage explanation from the surface HUD.',
      effect: 'command',
      params: { type: 'object', properties: {} },
      run: async () => {
        setHudState({ explanation: null });
        await drawn();
        return { explanationShown: false };
      },
    }),
    defineAction<{ show?: boolean; expanded?: boolean; mode?: 'skyline' | 'time'; table?: boolean; azimuthRange?: 'full' | 'tracks' }, unknown>({
      name: 'setChart',
      title: 'Skyline chart',
      description:
        'Controls the chart of the surface view. `show` shows or hides it; `expanded` switches between the small and the large size; `mode` is "skyline" (terrain skyline around the compass with the Sun\'s and Earth\'s samples over the mission window: filled marks are above the skyline, hollow ones hidden) or "time" (their elevation and clearance above the skyline against time); `table` shows the same data as a table; `azimuthRange` is "full" (0 to 360 degrees) or "tracks" (only the azimuths the Sun and Earth cross). Omitted fields stay as they are.',
      effect: 'command',
      params: {
        type: 'object',
        properties: {
          show: { type: 'boolean', description: 'Show (true) or hide (false) the chart.' },
          expanded: { type: 'boolean', description: 'Large (true) or small (false).' },
          mode: { type: 'string', description: 'What is plotted.', enum: ['skyline', 'time'] },
          table: { type: 'boolean', description: 'Show the data as a table instead of the drawing.' },
          azimuthRange: { type: 'string', description: 'Skyline mode: the whole circle or only where the tracks are.', enum: ['full', 'tracks'] },
        },
      },
      run: async ({ show, expanded, mode, table, azimuthRange }) => {
        if ([show, expanded, mode, table, azimuthRange].every((v) => v === undefined)) throw new ActionError('Give at least one of `show`, `expanded`, `mode`, `table`, `azimuthRange`.');
        const now = hudState();
        let chart = now.chart;
        if (show === false) chart = 'hidden';
        else if (expanded !== undefined) chart = expanded ? 'expanded' : 'compact';
        // Showing it, or asking for a mode, the table or a range, brings a hidden chart back at its small size.
        else if (chart === 'hidden') chart = 'compact';
        setHudState({ chart, ...(mode && { chartMode: mode }), ...(table !== undefined && { chartTable: table }), ...(azimuthRange && { chartFit: azimuthRange }) });
        await drawn();
        return chartResult();
      },
    }),
    defineAction<{ open: boolean }, unknown>({
      name: 'showKeyMetrics',
      title: 'Key metrics panel',
      description: 'Opens or folds the key-metrics panel of the surface view (Sun and Earth now, countdowns to the next sunset, sunrise, Earthset and Earthrise, and the mission-window figures). Folded, it keeps only its title.',
      effect: 'command',
      params: { type: 'object', properties: { open: { type: 'boolean', description: 'true = open, false = folded.' } }, required: ['open'] },
      run: async ({ open }) => {
        setHudState({ metricsOpen: open });
        await drawn();
        return { keyMetricsOpen: hudState().metricsOpen };
      },
    }),
  ];
}

let registered = false;
/** Registers the HUD actions once (the metrics panel and the chart both need them). */
export function ensureHudActions(ctx: HudActionContext): void {
  if (registered) return;
  registered = true;
  registerActions(createHudActions(ctx));
}
