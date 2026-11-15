// Missions to replay as actions (decision D-1): listPresets describes the presets, loadPreset
// puts one on screen and plays it. The "Missions to replay" list in the Filters panel runs
// loadPreset and nothing else, so the assistant reaches exactly the same state.
//
// A preset only sets what the other actions set (site, mission window, clock, view, look
// direction, rate, play): nothing here is new state, and every number in the result is read
// back from the store and from the analysis that ran.
import { skyAt as modelSkyAt } from '../analysis/api';
import type { SiteAnalysis } from '../analysis/types';
import { landingSite } from '../data/catalog';
import type { Landing } from '../data/landings';
import type { MissionPreset } from '../data/presets';
import { ActionDef, ActionError, defineAction } from './actions';
import type { AnalysisStore } from './analysisStore';
import { emitCommand } from './bus';
import { enterSurfaceView, flyGlobeTo, SITE_ALTITUDE_KM, type CoreContext } from './coreActions';
import { effectiveStartMs, spanText } from './scenario';
import type { Store } from './store';
import { isoUtc } from './time';
import type { AppState, LatLon } from './types';

const HOUR_MS = 3_600_000;
/** The surface view's normal vertical field of view, degrees. */
const NORMAL_FOV_DEG = 70;

type Direction = { azDeg: number; elDeg: number };

/**
 * Where a preset's surface view looks when it opens, so that the same preset always opens the
 * same way whatever was on screen before. With a `look` of its own: towards that body, aimed
 * off its centre by `elOffsetDeg`. Without one: the surface view's own rule on arriving at a
 * site, the Sun (or Earth when the Sun is down) ahead with the horizon in view; with neither
 * above the ground, level and where the viewer was already facing.
 */
export function presetLook(preset: Pick<MissionPreset, 'look'>, sky: { sun: Direction; earth: Direction }, current: { azDeg: number }): { azDeg: number; elDeg: number; fovDeg: number } {
  const turn = (az: number) => ((az % 360) + 360) % 360;
  if (preset.look) {
    const body = preset.look.towards === 'sun' ? sky.sun : sky.earth;
    return { azDeg: turn(body.azDeg), elDeg: Math.max(-85, Math.min(85, body.elDeg + (preset.look.elOffsetDeg ?? 0))), fovDeg: preset.look.fovDeg };
  }
  const body = sky.sun.elDeg > -1 ? sky.sun : sky.earth.elDeg > 0 ? sky.earth : null;
  return body ? { azDeg: turn(body.azDeg), elDeg: Math.max(0, Math.min(30, body.elDeg - 20)), fovDeg: NORMAL_FOV_DEG } : { azDeg: turn(current.azDeg), elDeg: 0, fovDeg: NORMAL_FOV_DEG };
}

export interface PresetContext extends Pick<CoreContext, 'prepareSurface' | 'viewShown'> {
  store: Store;
  presets: () => readonly MissionPreset[];
  landings: () => readonly Landing[];
  analysis?: AnalysisStore;
  /** Where the Sun and Earth are from a site at an instant, for the look direction. Defaults to the science core. */
  skyAt?: (site: LatLon, elevationM: number, timeMs: number) => { sun: { azDeg: number; elDeg: number }; earth: { azDeg: number; elDeg: number } };
}

/** What the analysis says about where its Sun and Earth positions came from, in words for the screen and the assistant. */
export function ephemerisStatement(a: Pick<SiteAnalysis, 'provenance'> | null): { source: 'horizons' | 'model' | null; text: string; note: string | null } {
  if (!a) return { source: null, text: 'The site analysis has not finished, so the source of the Sun and Earth positions is not known yet.', note: null };
  const source = a.provenance.ephemeris;
  return {
    source,
    text:
      source === 'horizons'
        ? 'Sun and Earth positions for this window come from a JPL Horizons table bundled with the app: no network is needed.'
        : 'No bundled JPL Horizons table covers this site and window, so the Sun and Earth positions come from the in-app model.',
    note: a.provenance.ephemerisNote,
  };
}

/** The preset the state on screen still is: same site, same mission window. Null once either has been changed. */
export function activePreset(s: Readonly<AppState>, presets: readonly MissionPreset[]): MissionPreset | null {
  return presets.find((p) => s.site?.id === p.siteId && s.delayH === 0 && s.windowStartMs === p.windowStartMs && s.windowDurationH === p.windowDurationH) ?? null;
}

function describe(p: MissionPreset, landings: readonly Landing[]) {
  const l = landings.find((x) => x.id === p.siteId);
  const e = p.sunBehindEarth;
  return {
    id: p.id,
    title: p.title,
    description: p.description,
    site: { id: p.siteId, name: l?.name ?? null, latDeg: l?.lat ?? null, lonDegEast: l?.lon ?? null },
    missionWindow: { startUtc: isoUtc(p.windowStartMs), durationH: p.windowDurationH, endUtc: isoUtc(p.windowStartMs + p.windowDurationH * HOUR_MS) },
    clockStartsUtc: isoUtc(p.clockMs),
    view: p.view,
    ...(p.look && { look: p.look }),
    rateSimSecondsPerSecond: p.rate,
    /** Real seconds from the clock's start to the end of the window at that rate. */
    playsForSeconds: Math.round((p.windowStartMs + p.windowDurationH * HOUR_MS - p.clockMs) / 1000 / p.rate),
    playsOnLoad: p.play,
    ...(e && {
      sunBehindEarth: {
        partlyCoveredFromUtc: isoUtc(e.partlyCoveredFromMs),
        entirelyHiddenFromUtc: isoUtc(e.entirelyHiddenFromMs),
        entirelyHiddenUntilUtc: isoUtc(e.entirelyHiddenUntilMs),
        clearAgainUtc: isoUtc(e.clearAgainMs),
        computedBy: 'This app, from geometric discs (Earth\'s atmosphere ignored), to the minute.',
        reported: e.reported,
      },
    }),
    sources: p.sources,
  };
}

export function createPresetActions(ctx: PresetContext): ActionDef<any, any>[] {
  const { store } = ctx;
  const state = () => store.get();
  const ids = () => ctx.presets().map((p) => p.id);

  return [
    defineAction({
      name: 'listPresets',
      title: 'Missions to replay',
      description:
        'Lists the missions that can be replayed in one step from data bundled with the app (no network): for each its id, what plays, the site, the mission window (UTC), where the clock starts, the view it opens in, the playback rate and its data sources. `loaded` is the id of the preset on screen now, or null. Load one with loadPreset.',
      effect: 'query',
      params: { type: 'object', properties: {} },
      run: () => ({ presets: ctx.presets().map((p) => describe(p, ctx.landings())), loaded: activePreset(state(), ctx.presets())?.id ?? null }),
    }),

    defineAction<{ id: string; play?: boolean }, unknown>({
      name: 'loadPreset',
      title: 'Replay a mission',
      description:
        'Puts a mission preset on screen in one step and plays it: selects its landing site, sets the mission window and the clock (UTC), real sunlight, opens its view (the surface view, facing the Sun with the horizon in view, or as the preset says), sets the playback rate and starts the clock. The clock stops by itself at the end of the mission window. ' +
        '`play: false` loads it paused. Waits until the surface view is on screen and the site analysis has finished, and reports which source the Sun and Earth positions come from (`ephemeris.source`: "horizons" = a JPL Horizons table bundled with the app). Ids: see listPresets. The mast height is left as it is.',
      effect: 'command',
      params: {
        type: 'object',
        properties: {
          id: { type: 'string', description: 'Preset id, from listPresets.' },
          play: { type: 'boolean', description: 'Start the clock once it is on screen (default: as the preset says, normally true).' },
        },
        required: ['id'],
      },
      run: async ({ id, play }) => {
        const preset = ctx.presets().find((p) => p.id === id.trim());
        if (!preset) throw new ActionError(ids().length ? `There is no preset "${id}". Presets: ${ids().join(', ')}.` : 'No mission presets are loaded in this session.');
        const landing = ctx.landings().find((l) => l.id === preset.siteId);
        if (!landing) throw new ActionError(`Preset "${preset.id}" needs the landing "${preset.siteId}", which is not in the catalogue.`);
        const site = landingSite(landing);

        const before = state();
        const comparisonClosed = before.comparing;
        // Another site's surface cannot stay on screen while this one loads.
        if (before.view === 'surface' && (before.site?.id !== site.id || preset.view === 'globe')) store.set({ view: 'globe' });
        // Everything the preset defines in one change, so the analysis is asked for once.
        store.set({
          site,
          timeMs: preset.clockMs,
          windowStartMs: preset.windowStartMs,
          windowDurationH: preset.windowDurationH,
          delayH: 0,
          rate: preset.rate,
          playing: false,
          lightMode: 'real',
          comparing: false,
        });
        flyGlobeTo(store, site.lat, site.lon, SITE_ALTITUDE_KM);

        /** True while what this action put on screen is still there (the user may act while it loads). */
        const stillOurs = () => {
          const s = state();
          return s.site?.id === site.id && s.windowStartMs === preset.windowStartMs && s.windowDurationH === preset.windowDurationH && s.timeMs === preset.clockMs && !s.playing;
        };

        if (preset.view === 'surface') {
          await enterSurfaceView(ctx);
          if (stillOurs() && state().view === 'surface') {
            const look = presetLook(preset, (ctx.skyAt ?? modelSkyAt)(site, 0, preset.clockMs), state().look);
            store.set({ look });
            emitCommand('lookAt', { azDeg: look.azDeg, elDeg: look.elDeg });
          }
        }

        const status = ctx.analysis ? await ctx.analysis.settled('current') : null;
        const analysed = status?.state === 'ready' ? status.value : null;
        const wantPlay = play ?? preset.play;
        const interrupted = !stillOurs();
        if (wantPlay && !interrupted) store.set({ playing: true });

        const s = state();
        const start = effectiveStartMs(s);
        return {
          preset: { id: preset.id, title: preset.title, description: preset.description },
          view: s.view,
          site: { id: site.id, name: site.name, latDeg: site.lat, lonDegEast: site.lon },
          timeUtc: isoUtc(s.timeMs),
          playing: s.playing,
          rateSimSecondsPerSecond: s.rate,
          missionWindow: { startUtc: isoUtc(start), durationH: s.windowDurationH, endUtc: isoUtc(start + s.windowDurationH * HOUR_MS), length: spanText(s.windowDurationH) },
          mastHeightM: s.mastHeightM,
          lightMode: s.lightMode,
          ...(s.view === 'surface' && { look: s.look }),
          ephemeris: ephemerisStatement(analysed),
          analysisState: status?.state ?? 'not running',
          ...(status?.state === 'error' && { analysisError: status.error }),
          ...(describe(preset, ctx.landings()).sunBehindEarth && { sunBehindEarth: describe(preset, ctx.landings()).sunBehindEarth }),
          sources: preset.sources,
          ...(comparisonClosed && { comparisonClosed: true }),
          ...(interrupted && { note: 'Something else changed the site, the window or the clock while the preset was loading, so the clock was not started.' }),
        };
      },
    }),
  ];
}
