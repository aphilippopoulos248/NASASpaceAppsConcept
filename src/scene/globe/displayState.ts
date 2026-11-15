// How the globe is drawn, beyond what AppState holds: the relief (true scale or off) and the data
// coverage outline (changed through actions registered here), and what the scene reports
// back for labels: the relief scale drawn right now, which elevation data is loaded, whether
// the polar close-up is showing. Presentation state, so it lives beside the scene.
import { ActionError, defineAction, registerActions } from '../../core/actions';
import { BACKGROUND_STARS_NOTE } from '../globe';
import { imageryText, type ImageryState } from '../sitePatch';
import type { AverageState } from './averageMaps';

export const DEFAULT_RELIEF = 1;
/** Relief is never drawn taller than it is: 1 = true scale is the most the globe shows. */
export const MAX_RELIEF = 1;

export interface GlobeDisplay {
  /** Chosen relief scale: 0 = smooth sphere, 1 = true scale (the most allowed: heights are never exaggerated). */
  reliefFactor: number;
  /** Outline where each class of elevation data exists. */
  coverage: boolean;
  /** Outline the mapped ice-bearing permanently shaded regions (south polar region). */
  iceTargets: boolean;
}

export interface GlobeLive {
  /** Relief scale being drawn: 0 to 1. */
  reliefNow: number;
  /** Resolution of the whole-Moon elevation grid behind the relief, samples per degree (0 = none loaded yet). */
  reliefPpd: number;
  /** Why relief is not drawn, when it is not. */
  reliefProblem: string | null;
  /** The south-polar close-up built from elevation data: null when it is not on screen. */
  polar: null | { resolutionM: number; shadows: boolean; note: string };
  /** The multi-year average maps behind the avg-* overlays: off, loading, missing (with the reason) or ready (with their legend). */
  averages: AverageState;
  /** Close-up imagery around the selected site (fetched from NASA Moon Trek): null when no site has any (none selected, or poleward of 80 degrees). */
  closeUp: null | { state: ImageryState; credits: string[] };
  /**
   * The point the view was last asked to centre on (setGlobeCamera, a site, the keyboard, a link),
   * exactly as asked: kept while the camera flies there and while it rests there, cleared when
   * the globe is turned by hand. The Centre-of-view fields show it, and "Drop pin at centre" pins
   * it, so neither reads the camera while it is still on its way.
   */
  viewTarget: null | { lat: number; lon: number };
  /** True while the camera is flying to `viewTarget`. */
  flying: boolean;
}

type Listener = () => void;

class DisplayStore {
  private display: GlobeDisplay = { reliefFactor: DEFAULT_RELIEF, coverage: false, iceTargets: false };
  private live: GlobeLive = { reliefNow: 0, reliefPpd: 0, reliefProblem: null, polar: null, averages: { state: 'off' }, closeUp: null, viewTarget: null, flying: false };
  private readonly listeners = new Set<Listener>();

  get(): Readonly<GlobeDisplay> {
    return this.display;
  }

  getLive(): Readonly<GlobeLive> {
    return this.live;
  }

  set(patch: Partial<GlobeDisplay>): void {
    const next = { ...this.display, ...patch };
    if (next.reliefFactor === this.display.reliefFactor && next.coverage === this.display.coverage && next.iceTargets === this.display.iceTargets) return;
    this.display = next;
    this.emit();
  }

  /** Called by the scene; listeners hear about it only when something they would show has changed. */
  setLive(patch: Partial<GlobeLive>): void {
    const next = { ...this.live, ...patch };
    const same =
      Math.abs(next.reliefNow - this.live.reliefNow) < 0.05 && next.reliefPpd === this.live.reliefPpd && next.reliefProblem === this.live.reliefProblem &&
      next.averages === this.live.averages &&
      next.flying === this.live.flying &&
      (next.viewTarget === this.live.viewTarget || (!!next.viewTarget && !!this.live.viewTarget && next.viewTarget.lat === this.live.viewTarget.lat && next.viewTarget.lon === this.live.viewTarget.lon)) &&
      (next.closeUp === this.live.closeUp || (!!next.closeUp && !!this.live.closeUp && next.closeUp.state === this.live.closeUp.state && next.closeUp.credits.join() === this.live.closeUp.credits.join())) &&
      (next.polar === this.live.polar || (!!next.polar && !!this.live.polar && next.polar.resolutionM === this.live.polar.resolutionM && next.polar.shadows === this.live.polar.shadows && next.polar.note === this.live.polar.note));
    if (same) return;
    this.live = next;
    this.emit();
  }

  subscribe(fn: Listener): () => void {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  }

  private emit(): void {
    for (const fn of [...this.listeners]) fn();
  }
}

export const globeDisplay = new DisplayStore();

/** "relief at true scale", "smooth sphere (relief off)", or "relief ×0.5" for a scale in between. */
export function reliefText(factor: number): string {
  if (factor <= 0) return 'smooth sphere (relief off)';
  if (Math.abs(factor - 1) < 0.05) return 'relief at true scale';
  return `relief ×${Number(factor.toFixed(factor < 10 ? 1 : 0))}`;
}

/** The display state as a small JSON object, for action results and getState. */
export function displaySummary() {
  const d = globeDisplay.get(), l = globeDisplay.getLive();
  return {
    reliefExaggeration: d.reliefFactor,
    reliefDrawnNow: Math.round(l.reliefNow * 10) / 10,
    reliefDataSamplesPerDegree: l.reliefPpd || null,
    ...(l.reliefProblem && { reliefProblem: l.reliefProblem }),
    coverageShown: d.coverage,
    iceTargetsShown: d.iceTargets,
    polarCloseUp: l.polar ? { elevationGridM: l.polar.resolutionM, sunShadows: l.polar.shadows, note: l.polar.note } : null,
    /** The stars behind the globe are generated, not a catalogue. */
    backgroundStars: BACKGROUND_STARS_NOTE,
    /** Where the view was last asked to centre, as asked, and whether the camera is still on its way (null once the globe was turned by hand). */
    viewTarget: l.viewTarget ? { latDeg: l.viewTarget.lat, lonDegEast: l.viewTarget.lon, flying: l.flying } : null,
    /** Photographic close-up around the selected site, the only thing fetched from outside the app: null when the site has none. */
    closeUpImagery: l.closeUp ? { state: l.closeUp.state, layersShown: l.closeUp.credits, text: imageryText(l.closeUp.state, l.closeUp.credits) } : null,
    averageMaps:
      l.averages.state === 'ready'
        ? { state: 'ready', label: l.averages.legend.label, unit: l.averages.legend.unit, meaning: l.averages.legend.meaning, extent: l.averages.legend.extent, source: l.averages.legend.source }
        : l.averages.state === 'missing'
          ? { state: 'missing', reason: l.averages.reason }
          : { state: l.averages.state },
  };
}

let registered = false;

export function registerDisplayActions(): void {
  if (registered) return;
  registered = true;
  registerActions([
    defineAction<{ factor: number }, unknown>({
      name: 'setReliefExaggeration',
      title: 'Terrain relief scale',
      description:
        "Sets how the globe's terrain relief (LOLA elevation) is drawn: 1 = true scale (the default), 0 = smooth sphere (relief off). Heights are never exaggerated, so a factor above 1 is refused. What is drawn is shown on screen and returned as reliefDrawnNow. Analysis results never depend on it.",
      effect: 'command',
      params: { type: 'object', properties: { factor: { type: 'number', description: 'Relief scale: 0 off, 1 true scale.', minimum: 0, maximum: MAX_RELIEF } }, required: ['factor'] },
      run: ({ factor }) => {
        if (!Number.isFinite(factor)) throw new ActionError('The factor must be a number.');
        globeDisplay.set({ reliefFactor: factor });
        return displaySummary();
      },
    }),
    defineAction<{ show: boolean }, unknown>({
      name: 'showIceTargets',
      title: 'Show mapped ice targets',
      description:
        'Outlines on the globe the 169 permanently shaded regions with water-ice signatures mapped in the south polar region (Lemelin et al. 2021, CC BY 4.0). They are regions of interest, drawn about 0.3 km wider than the listed shadowed areas, not confirmed deposits. Use nearestIceTargets or getSiteScience for distances from a site.',
      effect: 'command',
      params: { type: 'object', properties: { show: { type: 'boolean', description: 'Show the outlines.' } }, required: ['show'] },
      run: ({ show }) => {
        globeDisplay.set({ iceTargets: show });
        return displaySummary();
      },
    }),
    defineAction<{ show: boolean }, unknown>({
      name: 'showCoverage',
      title: 'Show elevation data coverage',
      description:
        'Outlines on the globe where each class of elevation data exists: the three bundled south-polar LOLA grids (40 m, 80 m, 160 m squares) and the windows around the catalogued landing sites (480 m, 60 m and, where surveyed, 3 m). Everywhere else rests on the whole-Moon 1.9 km grid, or on a 60 m window the elevation server builds on request. Can be combined with any overlay.',
      effect: 'command',
      params: { type: 'object', properties: { show: { type: 'boolean', description: 'Show the coverage outlines.' } }, required: ['show'] },
      run: ({ show }) => {
        globeDisplay.set({ coverage: show });
        return displaySummary();
      },
    }),
  ]);
}
