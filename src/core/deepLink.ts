// Deep links: ?site=apollo-11 opens a site (or ?site=pin:<lat>,<lon> a custom pin),
// &view=surface drops straight to the ground, &light=landing sets the clock to touchdown,
// &t=2025-03-14T06:00Z sets the clock (&time= is read the same way: links made for the main
// branch's app use that spelling). A time given in the link wins over &light=landing.
// Whichever sets the clock also starts the mission window there, so the analysis and the
// time scrubber are about the moment the link shows.
// ?preset=eclipse-2025-03-14 replays a mission preset (loadPreset): it defines the site, the
// window, the clock and the view by itself, so the rest of such a link is not applied.
// Applied through the action registry (origin "url"), and the address bar follows the
// current site and view (and the preset, while one is on screen) so a link can be copied at
// any time.
import { getLandings } from '../data/catalog';
import { landingDate } from '../data/landings';
import { getPresets } from '../data/presets';
import { runAction } from './actions';
import { activePreset } from './presetActions';
import type { Store } from './store';
import { isoUtc } from './time';

export interface DeepLink {
  site: string | null;
  view: 'surface' | 'globe' | null;
  light: 'landing' | null;
  t: string | null;
  preset: string | null;
}

export function parseDeepLink(search: string): DeepLink {
  const p = new URLSearchParams(search);
  const view = p.get('view');
  return {
    site: p.get('site'),
    view: view === 'surface' || view === 'globe' ? view : null,
    light: p.get('light') === 'landing' ? 'landing' : null,
    t: p.get('t') ?? p.get('time'),
    preset: p.get('preset'),
  };
}

/** Runs the actions a link asks for. Returns the errors, if any, as sentences. */
export async function applyDeepLink(link: DeepLink, jumpTo?: (lat: number, lon: number) => void): Promise<string[]> {
  const errors: string[] = [];
  const run = async (name: string, params: unknown) => {
    const r = await runAction(name, params, 'url');
    if (!r.ok) errors.push(`${name}: ${r.error}`);
    return r;
  };
  // A preset is a whole scene; if it cannot be loaded the rest of the link is used instead.
  if (link.preset && (await run('loadPreset', { id: link.preset })).ok) return errors;
  const timeSet = link.t ? (await run('setTime', { utc: link.t })).ok : false;
  if (timeSet) await run('setMissionWindow', { startUtc: 'now' });
  if (!link.site) return errors;
  const sel = await run('selectSite', { site: link.site });
  if (!sel.ok) return errors;
  const landing = getLandings().find((l) => l.id === (sel.result as { site: { id: string } }).site.id);
  if (link.light === 'landing' && landing) {
    await run('setLightMode', { mode: 'real' });
    if (!timeSet) {
      await run('setTime', { utc: isoUtc(landingDate(landing).getTime()) });
      await run('setMissionWindow', { startUtc: 'landing' });
    }
  }
  if (link.view === 'surface') {
    const site = (sel.result as { site: { latDeg: number; lonDegEast: number } }).site;
    jumpTo?.(site.latDeg, site.lonDegEast);
    await run('enterSurface', {});
  }
  return errors;
}

/** The query string that leads back to what is on screen: the preset while one is loaded, otherwise the site and the view. */
export function linkQuery(s: Parameters<typeof activePreset>[0], search: string): string {
  const p = new URLSearchParams(search);
  for (const key of ['light', 't', 'time', 'preset', 'site', 'view']) p.delete(key);
  const preset = activePreset(s, getPresets());
  if (preset) p.set('preset', preset.id);
  else if (s.site) {
    p.set('site', s.site.id);
    if (s.view === 'surface') p.set('view', 'surface');
  }
  return p.toString();
}

/** Keeps the address bar in step with the app. */
export function syncUrl(store: Store): () => void {
  return store.subscribe(['site', 'view', 'windowStartMs', 'windowDurationH', 'delayH'], (s) => {
    const q = linkQuery(s, location.search);
    history.replaceState(null, '', `${location.pathname}${q ? `?${q}` : ''}${location.hash}`);
  });
}
