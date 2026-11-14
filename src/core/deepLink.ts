// Deep links: ?site=apollo-11 opens a site (or ?site=pin:<lat>,<lon> a custom pin),
// &view=surface drops straight to the ground, &light=landing sets the clock to touchdown,
// &t=2025-03-14T06:00Z sets the clock. Applied through the action registry (origin "url"),
// and the address bar follows the current site and view so a link can be copied at any time.
import { getLandings } from '../data/catalog';
import { landingDate } from '../data/landings';
import { runAction } from './actions';
import type { Store } from './store';
import { isoUtc } from './time';

export interface DeepLink {
  site: string | null;
  view: 'surface' | 'globe' | null;
  light: 'landing' | null;
  t: string | null;
}

export function parseDeepLink(search: string): DeepLink {
  const p = new URLSearchParams(search);
  const view = p.get('view');
  return {
    site: p.get('site'),
    view: view === 'surface' || view === 'globe' ? view : null,
    light: p.get('light') === 'landing' ? 'landing' : null,
    t: p.get('t'),
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
  if (link.t) await run('setTime', { utc: link.t });
  if (!link.site) return errors;
  const sel = await run('selectSite', { site: link.site });
  if (!sel.ok) return errors;
  const landing = getLandings().find((l) => l.id === (sel.result as { site: { id: string } }).site.id);
  if (link.light === 'landing' && landing) {
    await run('setLightMode', { mode: 'real' });
    await run('setTime', { utc: isoUtc(landingDate(landing).getTime()) });
  }
  if (link.view === 'surface') {
    const site = (sel.result as { site: { latDeg: number; lonDegEast: number } }).site;
    jumpTo?.(site.latDeg, site.lonDegEast);
    await run('enterSurface', {});
  }
  return errors;
}

/** Keeps ?site= and ?view= in the address bar in step with the app. */
export function syncUrl(store: Store): () => void {
  return store.subscribe(['site', 'view'], (s) => {
    const p = new URLSearchParams(location.search);
    p.delete('light');
    p.delete('t');
    if (s.site) p.set('site', s.site.id);
    else p.delete('site');
    if (s.site && s.view === 'surface') p.set('view', 'surface');
    else p.delete('view');
    const q = p.toString();
    history.replaceState(null, '', `${location.pathname}${q ? `?${q}` : ''}${location.hash}`);
  });
}
