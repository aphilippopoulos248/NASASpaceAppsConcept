// Actions that read the merged science layers for a place (decision D-1: what the site card
// shows, the assistant can ask for, and gets the same sources and caveats with the numbers).
import { ActionDef, ActionError, defineAction } from './actions';
import type { AnalysisStore } from './analysisStore';
import { iceReadout, siteScience } from './siteScience';
import type { Store } from './store';
import { wrapLon } from './types';

export interface ScienceContext {
  store: Store;
  analysis: AnalysisStore;
}

export function createScienceActions(ctx: ScienceContext): ActionDef<any, any>[] {
  const site = () => {
    const s = ctx.store.get().site;
    if (!s) throw new ActionError('No site is selected. Select a landing site or drop a pin first.');
    return s;
  };
  return [
    defineAction({
      name: 'getSiteScience',
      title: 'Site science readouts',
      description:
        'Reads the science layers for the selected site: (1) geometric opportunities with the three Deep Space Network complexes over the mission window (percent of the window and longest gap per station and for any station; line of sight only, not a link budget); ' +
        '(2) the published multi-year average sunlight and Earth visibility there (NASA PGDA product 69: 18.6-year averages of a model, polar regions only, never to be confused with the dated mission-window figures); ' +
        '(3) the nearest mapped ice-bearing permanently shaded regions with straight-line distance and bearing (Lemelin et al. 2021, south polar region). Waits for the site analysis. Every part carries its source and caveats; a part without data says why.',
      effect: 'query',
      params: { type: 'object', properties: {} },
      run: async () => {
        const s = site();
        const status = await ctx.analysis.settled('current');
        // The analysis that came back is for the site selected when it was asked for.
        return { site: { id: s.id, name: s.name, latDeg: s.lat, lonDegEast: s.lon }, ...(await siteScience(s, status)) };
      },
    }),
    defineAction<{ lat?: number; lon?: number; count?: number; maxKm?: number }, unknown>({
      name: 'nearestIceTargets',
      title: 'Nearest ice targets',
      description:
        'Lists the mapped ice-bearing permanently shaded regions nearest to a point (default: the selected site; or give lat and lon, degrees, longitude east-positive): straight-line distance in km to the edge of the mapped outline (0 inside), compass bearing, the outline\'s nearest point, listed area and the objectives the authors flagged. South polar region only (Lemelin et al. 2021, CC BY 4.0). Distances are over a sphere, not traverses.',
      effect: 'query',
      params: {
        type: 'object',
        properties: {
          lat: { type: 'number', description: 'Latitude, degrees north-positive.', minimum: -90, maximum: 90 },
          lon: { type: 'number', description: 'Longitude, degrees east-positive.', minimum: -360, maximum: 360 },
          count: { type: 'integer', description: 'How many to list (default 5).', minimum: 1, maximum: 20 },
          maxKm: { type: 'number', description: 'Ignore regions farther than this, km (default 500).', minimum: 1, maximum: 6000 },
        },
      },
      run: async ({ lat, lon, count = 5, maxKm = 500 }) => {
        if ((lat === undefined) !== (lon === undefined)) throw new ActionError('Give both `lat` and `lon`, or neither to use the selected site.');
        const at = lat !== undefined ? { lat, lon: wrapLon(lon!) } : (({ lat, lon }) => ({ lat, lon }))(site());
        return { from: { latDeg: at.lat, lonDegEast: at.lon }, ...(await iceReadout(at, count, maxKm)) };
      },
    }),
  ];
}
