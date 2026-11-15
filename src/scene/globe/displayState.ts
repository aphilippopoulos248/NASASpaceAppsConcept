// How the globe is drawn, beyond what AppState holds: the relief exaggeration and the data
// coverage outline (changed through actions registered here), and what the scene reports
// back for labels: the exaggeration drawn right now, which elevation data is loaded, whether
// the polar close-up is showing. Presentation state, so it lives beside the scene.
import { ActionError, defineAction, registerActions } from '../../core/actions';
import type { AverageState } from './averageMaps';
import { FULL_EXAGGERATION_KM, TRUE_SCALE_BELOW_KM } from './reliefTiles';

export const DEFAULT_RELIEF = 1;
export const MAX_RELIEF = 30;

/** How many times larger (in width) than life each landing's explored area is drawn, so it reads on the globe. */
export const AREA_SCALE_CHOICES = [1, 5, 10, 25, 50] as const;
export const DEFAULT_AREA_SCALE = 10;
export const MAX_AREA_SCALE = 50;

export interface GlobeDisplay {
  /** Chosen relief exaggeration: 0 = smooth sphere, 1 = true scale. */
  reliefFactor: number;
  /** Explored areas (territories) are drawn this many times wider than they are: 1 = true size. */
  areaScale: number;
  /** Outline where each class of elevation data exists. */
  coverage: boolean;
  /** Outline the mapped ice-bearing permanently shaded regions (south polar region). */
  iceTargets: boolean;
}

export interface GlobeLive {
  /** Exaggeration drawn at the camera's present altitude. */
  reliefNow: number;
  /** Resolution of the whole-Moon elevation grid behind the relief, samples per degree (0 = none loaded yet). */
  reliefPpd: number;
  /** Why relief is not drawn, when it is not. */
  reliefProblem: string | null;
  /** The south-polar close-up built from elevation data: null when it is not on screen. */
  polar: null | { resolutionM: number; shadows: boolean; note: string };
  /** The multi-year average maps behind the avg-* overlays: off, loading, missing (with the reason) or ready (with their legend). */
  averages: AverageState;
}

type Listener = () => void;

class DisplayStore {
  private display: GlobeDisplay = { reliefFactor: DEFAULT_RELIEF, areaScale: DEFAULT_AREA_SCALE, coverage: false, iceTargets: false };
  private live: GlobeLive = { reliefNow: 0, reliefPpd: 0, reliefProblem: null, polar: null, averages: { state: 'off' } };
  private readonly listeners = new Set<Listener>();

  get(): Readonly<GlobeDisplay> {
    return this.display;
  }

  getLive(): Readonly<GlobeLive> {
    return this.live;
  }

  set(patch: Partial<GlobeDisplay>): void {
    const next = { ...this.display, ...patch };
    if (next.reliefFactor === this.display.reliefFactor && next.areaScale === this.display.areaScale && next.coverage === this.display.coverage && next.iceTargets === this.display.iceTargets) return;
    this.display = next;
    this.emit();
  }

  /** Called by the scene; listeners hear about it only when something they would show has changed. */
  setLive(patch: Partial<GlobeLive>): void {
    const next = { ...this.live, ...patch };
    const same =
      Math.abs(next.reliefNow - this.live.reliefNow) < 0.05 && next.reliefPpd === this.live.reliefPpd && next.reliefProblem === this.live.reliefProblem &&
      next.averages === this.live.averages &&
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

/** "relief x10", "relief x5.4", "true scale", "smooth sphere". */
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
    reliefRule: d.reliefFactor > 1 ? `The chosen factor applies above ${FULL_EXAGGERATION_KM} km camera altitude and eases to true scale (1) below ${TRUE_SCALE_BELOW_KM} km.` : null,
    reliefDataSamplesPerDegree: l.reliefPpd || null,
    ...(l.reliefProblem && { reliefProblem: l.reliefProblem }),
    territoryScale: d.areaScale,
    coverageShown: d.coverage,
    iceTargetsShown: d.iceTargets,
    polarCloseUp: l.polar ? { elevationGridM: l.polar.resolutionM, sunShadows: l.polar.shadows, note: l.polar.note } : null,
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
      title: 'Relief exaggeration',
      description:
        `Sets how much the globe's terrain relief (LOLA elevation) is stretched so it can be seen from orbit: 0 = smooth sphere (relief off), 1 = true scale (the default), up to ${MAX_RELIEF}. ` +
        `A factor above 1 applies from orbit and eases to true scale below ${TRUE_SCALE_BELOW_KM} km camera altitude, so close-ups are never distorted; the factor drawn at the moment is shown on screen and returned as reliefDrawnNow. Analysis results never use the exaggeration.`,
      effect: 'command',
      params: { type: 'object', properties: { factor: { type: 'number', description: 'Exaggeration factor: 0 off, 1 true scale.', minimum: 0, maximum: MAX_RELIEF } }, required: ['factor'] },
      run: ({ factor }) => {
        if (!Number.isFinite(factor)) throw new ActionError('The factor must be a number.');
        globeDisplay.set({ reliefFactor: factor });
        return displaySummary();
      },
    }),
    defineAction<{ factor: number }, unknown>({
      name: 'setTerritoryScale',
      title: 'Territory size exaggeration',
      description:
        `Sets how many times wider than life each landing's explored area (its territory) is drawn on the globe, so it can be seen from orbit: 1 = true size, ${DEFAULT_AREA_SCALE} = default, up to ${MAX_AREA_SCALE}. ` +
        'Only the drawing changes: the size quoted in the site card stays the real one, and the shape of the Moon is not affected.',
      effect: 'command',
      params: { type: 'object', properties: { factor: { type: 'number', description: 'Width multiplier: 1 = true size.', minimum: 1, maximum: MAX_AREA_SCALE } }, required: ['factor'] },
      run: ({ factor }) => {
        if (!Number.isFinite(factor)) throw new ActionError('The factor must be a number.');
        globeDisplay.set({ areaScale: factor });
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
