// The "Site science" section and its actions: what the science layers say about the active
// site, each value with its source and its caveat beside it.
//
//   mountSiteScience(el)            builds the section inside `el` and keeps it up to date
//   registerSiteScienceActions()    registers the query actions getSiteScience and
//                                   nearestIceTargets (decision D-1: what the section shows,
//                                   the assistant can ask for, with the same wording)
//
// The readouts themselves are in src/science/siteScience.ts; this file only shows them.
// A layer with no data at the site takes no rows: it is named in one closing line with the reason.
import { ActionError, defineAction, registerActions, type ActionDef } from '../../core/actions';
import { analysis as appAnalysis, type AnalysisStore } from '../../core/analysisStore';
import { spanText } from '../../core/scenario';
import { store as appStore, type Store } from '../../core/store';
import { formatDuration } from '../../core/time';
import { wrapLon, type SiteRef } from '../../core/types';
import { averagesReadout, dsnReadout, iceReadout, shadowCamReadout, siteScience, temperatureReadout, type AveragesReadout, type IceReadout, type ShadowCamReadout, type TemperatureReadout } from '../../science/siteScience';
import { el } from '../dom';
import './siteScience.css';

// ---------------------------------------------------------------- actions

export interface SiteScienceContext {
  store: Store;
  analysis: AnalysisStore;
}

/** The two query actions, bound to a store and an analysis store (the app's own, or a test's). */
export function createSiteScienceActions(ctx: SiteScienceContext): ActionDef<any, any>[] {
  const site = (): SiteRef => {
    const s = ctx.store.get().site;
    if (!s) throw new ActionError('No site is selected. Select a landing site or drop a pin first.');
    return s;
  };
  return [
    defineAction({
      name: 'getSiteScience',
      title: 'Site science readouts',
      description:
        'Reads the science layers for the selected site: (1) `dsn`: geometric opportunities with the three Deep Space Network complexes over the mission window (percent of the window and longest gap per station and for any station; line of sight only, not a link budget); ' +
        '(2) `longTermAverages`: the published multi-year average sunlight and Earth visibility there (NASA PGDA product 69: 18.6-year averages of a model, polar regions only, never to be confused with the dated mission-window figures); ' +
        '(3) `iceTargets`: the nearest mapped ice-bearing permanently shaded regions with straight-line distance and bearing (Lemelin et al. 2021, south polar region); ' +
        '(4) `surfaceTemperature`: the ANNUAL maximum and ANNUAL mean surface temperature in kelvin from LRO Diviner (240 m cells, poleward of 80 degrees; annual values, not the temperature on the simulated date, and separate summer and winter maps are not included); ' +
        '(5) `shadowCam`: ShadowCam controlled mosaics of permanently shadowed regions that cover the site, as credited links to the ShadowCam PDS archive (the images themselves are not in the app). ' +
        'Waits for the site analysis. Every part carries its source and caveats; a part without data for this site says why.',
      effect: 'query',
      params: { type: 'object', properties: {} },
      run: async () => {
        const s = site();
        const status = await ctx.analysis.settled('current');
        // The analysis that came back is for the site selected when it was asked for.
        return { site: { id: s.id, name: s.name, latDeg: s.lat, lonDegEast: s.lon }, ...(await siteScience(s, status)) };
      },
    }),
    defineAction<{ lat?: number; lon?: number; count?: number; limit?: number; maxKm?: number }, unknown>({
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
          limit: { type: 'integer', description: 'Another name for `count`.', minimum: 1, maximum: 20 },
          maxKm: { type: 'number', description: 'Ignore regions farther than this, km (default 500).', minimum: 1, maximum: 6000 },
        },
      },
      run: async ({ lat, lon, count, limit, maxKm = 500 }) => {
        if ((lat === undefined) !== (lon === undefined)) throw new ActionError('Give both `lat` and `lon`, or neither to use the selected site.');
        if (count !== undefined && limit !== undefined && count !== limit) throw new ActionError('`count` and `limit` mean the same thing: give one of them.');
        const at = lat !== undefined ? { lat, lon: wrapLon(lon!) } : (({ lat, lon }) => ({ lat, lon }))(site());
        return { from: { latDeg: at.lat, lonDegEast: at.lon }, ...(await iceReadout(at, count ?? limit ?? 5, maxKm)) };
      },
    }),
  ];
}

let appActions: ActionDef<any, any>[] | null = null;

/** Registers getSiteScience and nearestIceTargets for the app's own store. Safe to call more than once. */
export function registerSiteScienceActions(): void {
  appActions ??= createSiteScienceActions({ store: appStore, analysis: appAnalysis });
  registerActions(appActions);
}

// ---------------------------------------------------------------- section

type Rows = [label: string, value: string][];
interface More {
  summary: string;
  /**
   * The accessible name, where the visible summary alone does not say which block it opens (two
   * blocks have "Source and limits"). Starts with the visible text, so speech input still finds it.
   */
  label?: string;
  lines: string[];
}

/** A small table with a header row: for values that have two figures each. */
function table(columns: readonly string[], rows: readonly (readonly string[])[]): HTMLTableElement {
  const t = el('table', 'ss-table');
  const head = el('tr');
  for (const c of columns) {
    const th = el('th', undefined, c);
    th.scope = 'col';
    head.append(th);
  }
  const thead = el('thead');
  thead.append(head);
  const tbody = el('tbody');
  for (const r of rows) {
    const tr = el('tr');
    r.forEach((cell, i) => {
      const node = i === 0 ? el('th', undefined, cell) : el('td', 'ly-value', cell);
      if (i === 0) (node as HTMLTableCellElement).scope = 'row';
      tr.append(node);
    });
    tbody.append(tr);
  }
  t.append(thead, tbody);
  return t;
}

function fill(box: HTMLElement, heading: string, parts: { tag?: string; rows?: Rows; list?: HTMLElement; notes?: string[]; status?: string; more?: More; moreList?: HTMLElement }): void {
  const nodes: HTMLElement[] = [];
  if (parts.tag) nodes.push(el('span', 'ss-tag', parts.tag));
  nodes.push(el('h4', 'ss-head', heading));
  if (parts.status) {
    const p = el('p', 'ss-status', parts.status);
    p.setAttribute('role', 'status');
    nodes.push(p);
  }
  if (parts.rows?.length) {
    const dl = el('dl', 'ly-kv');
    for (const [k, v] of parts.rows) dl.append(el('dt', undefined, k), el('dd', undefined, v));
    nodes.push(dl);
  }
  if (parts.list) nodes.push(parts.list);
  for (const n of parts.notes ?? []) nodes.push(el('p', 'ly-note', n));
  if (parts.more && (parts.more.lines.length || parts.moreList)) {
    const d = el('details', 'ss-more');
    const summary = el('summary', undefined, parts.more.summary);
    if (parts.more.label) summary.setAttribute('aria-label', parts.more.label);
    d.append(summary);
    if (parts.moreList) d.append(parts.moreList);
    d.append(...parts.more.lines.map((n) => el('p', 'ly-note', n)));
    nodes.push(d);
  }
  box.hidden = false;
  box.replaceChildren(...nodes);
}

/** Takes a block off the page, with whatever it showed (a hidden "Reading..." line must not linger). */
function empty(box: HTMLElement): void {
  box.hidden = true;
  box.replaceChildren();
}

type Contact = { pctOfWindow: number | null; longestGapH: number | null; gapRunsIntoWindowEdge: boolean };
const share = (c: Contact): string => (c.pctOfWindow === null ? 'not available' : `${c.pctOfWindow.toFixed(1)} %`);
const gap = (c: Contact): string => (c.longestGapH === null ? 'not available' : c.longestGapH < 0.05 ? 'none' : `${formatDuration(c.longestGapH)}${c.gapRunsIntoWindowEdge ? ' or more' : ''}`);
const contactLine = (c: Contact): string => `${share(c)} of the window, longest gap ${gap(c)}`;

export interface SiteScienceOptions {
  /** Show the "Site science" title above the blocks (default true). */
  heading?: boolean;
  /** Use another store pair than the app's (tests). */
  context?: SiteScienceContext;
}

/**
 * Builds the "Site science" section inside `el` for the active site and keeps it current:
 * it reads `store.site` and the current analysis itself. Also registers the two query
 * actions when it runs on the app's own store.
 */
export function mountSiteScience(target: HTMLElement, options: SiteScienceOptions = {}): void {
  const ctx = options.context ?? { store: appStore, analysis: appAnalysis };
  if (!options.context) registerSiteScienceActions();

  const section = el('section', 'ss');
  section.setAttribute('aria-label', 'Site science');
  section.hidden = true;
  if (options.heading !== false) section.append(el('h3', 'ly-section-title', 'Site science'));
  const dsnBox = el('div', 'ss-block ss-dsn');
  const avgBox = el('div', 'ss-block ss-block--average');
  const iceBox = el('div', 'ss-block ss-ice');
  const tempBox = el('div', 'ss-block ss-temp');
  const camBox = el('div', 'ss-block ss-shadowcam');
  const none = el('p', 'ly-note ss-none');
  section.append(dsnBox, avgBox, iceBox, tempBox, camBox, none);
  target.append(section);

  // Layers that have nothing at this site: no rows, one closing line that says why (always in the same order).
  const LAYERS = ['long-term averages', 'mapped ice targets', 'Diviner annual temperatures', 'ShadowCam mosaics'] as const;
  const missing = new Map<(typeof LAYERS)[number], string>();
  const setMissing = (layer: (typeof LAYERS)[number], reason: string | null): void => {
    if (reason === null) missing.delete(layer);
    else missing.set(layer, reason.replace(/\.$/, ''));
    const lines = LAYERS.filter((l) => missing.has(l)).map((l) => `${l} (${missing.get(l)})`);
    none.textContent = lines.length ? `No data at this site: ${lines.join('; ')}.` : '';
  };

  // ---------- DSN: comes with the site analysis ----------
  const renderDsn = (): void => {
    if (!ctx.store.get().site) return;
    const want = ctx.analysis.wanted('current');
    const st = ctx.analysis.get('current');
    // For a moment after a change the store still holds the previous scenario's result.
    const r = dsnReadout(st.state !== 'idle' && want && st.scenario.id !== want.id ? { state: 'loading', scenario: want } : st);
    if (!r.available) {
      fill(dsnBox, 'Deep Space Network stations', { status: r.reason });
      return;
    }
    const openEnded = [...r.stations.map((s) => s.receive), r.anyStation.receive].some((c) => c.gapRunsIntoWindowEdge && (c.longestGapH ?? 0) >= 0.05);
    fill(dsnBox, `Deep Space Network stations, ${spanText(r.windowDurationH, true)} window`, {
      list: table(['Station', 'In view', 'Longest gap'], [...r.stations.map((s) => [s.name.split(' ')[0], share(s.receive), gap(s.receive)]), ['Any station', share(r.anyStation.receive), gap(r.anyStation.receive)]]),
      notes: [
        `Share of the mission window in which the station can receive from the site: the site above the station's ${r.stations[0]?.receiveLimitDeg ?? ''}° limit and the station above this site's terrain skyline.${openEnded ? ' "Or more": the gap runs into an edge of the window.' : ''} ${r.meaning}`,
      ],
      more: { summary: 'Stations, transmit limits and assumptions', lines: [...r.stations.map((s) => `${s.name}, ${s.complex}: for transmitting (limit ${s.transmitLimitDeg}°) ${contactLine(s.transmit)}.`), ...r.assumptions] },
    });
  };

  // ---------- long-term averages ----------
  const renderAverages = (r: AveragesReadout): void => {
    if (!('sunlight' in r)) {
      empty(avgBox);
      setMissing('long-term averages', r.reason);
      return;
    }
    const value = (x: { available: boolean; pctOfTime: number | null; neverInModel: boolean; cellM: number | null }): string | null =>
      !x.available || x.pctOfTime === null ? null : x.neverInModel ? `never (0 %), ${x.cellM} m cell` : `${x.pctOfTime === 1 ? '1 % or less' : `${x.pctOfTime} %`} of the time, ${x.cellM} m cell`;
    const sun = value(r.sunlight);
    const earth = value(r.earthVisibility);
    if (!sun && !earth) {
      empty(avgBox);
      setMissing('long-term averages', 'NASA PGDA product 69 maps only the polar regions');
      return;
    }
    setMissing('long-term averages', null);
    const rows: Rows = [];
    if (sun) rows.push(['Any sunlight', sun]);
    if (earth) rows.push(['Any of Earth in view', earth]);
    fill(avgBox, 'Long-term averages', {
      tag: '18.6-year average, not this date',
      rows,
      notes: ['Share of time with any part of the disc above the terrain horizon, averaged over 18.6 years of a model (NASA PGDA product 69). Not the mission-window figures, not a fraction of solar energy, and not a radio link.'],
      more: { summary: 'Source and limits', label: 'Source and limits of the long-term averages', lines: [r.averagingPeriod, ...r.caveats, r.citation] },
    });
  };

  // ---------- ice targets ----------
  const renderIce = (r: IceReadout): void => {
    if (!r.available) {
      empty(iceBox);
      setMissing('mapped ice targets', r.reason);
      return;
    }
    if (!r.nearest.length) {
      empty(iceBox);
      setMissing('mapped ice targets', 'none within 500 km: the database covers the south polar region only');
      return;
    }
    setMissing('mapped ice targets', null);
    fill(iceBox, 'Nearest mapped ice targets', {
      rows: r.nearest.map((t): [string, string] => [t.label, t.insideOutline ? 'inside its mapped outline' : `${t.distanceText}, bearing ${t.bearingDeg}°`]),
      notes: [`${r.distanceMeaning} ${r.whatTheseAre}`],
      more: { summary: 'Credit and data notes', lines: [r.credit, ...r.dataNotes] },
    });
  };

  // ---------- Diviner annual temperatures ----------
  const renderTemperature = (r: TemperatureReadout): void => {
    if (!('status' in r)) {
      empty(tempBox);
      setMissing('Diviner annual temperatures', r.reason);
      return;
    }
    if (r.status === 'outside') {
      empty(tempBox);
      setMissing('Diviner annual temperatures', 'the maps cover only latitudes poleward of 80°');
      return;
    }
    setMissing('Diviner annual temperatures', null);
    const rows: Rows = [];
    if (r.annualMaxK !== null) rows.push(['Annual maximum', `${r.annualMaxK} K`]);
    if (r.annualMeanK !== null) rows.push(['Annual mean', `${r.annualMeanK} K`]);
    fill(tempBox, 'Surface temperature (Diviner, annual)', {
      rows,
      notes: [
        r.status === 'empty'
          ? `The published maps have no value for this ${r.cellM} m cell; nothing is filled in.`
          : `Annual values for the ${r.cellM} m cell around the site, from LRO Diviner measurements of ${r.measuredOver}. Not the temperature on the date shown; separate summer and winter maps are not included.`,
      ],
      more: { summary: 'Source and limits', label: 'Source and limits of the Diviner temperatures', lines: [r.citation, `Licence: ${r.licence}`, ...r.caveats] },
    });
  };

  // ---------- ShadowCam links ----------
  const linkList = (items: Extract<ShadowCamReadout, { mosaics: unknown }>['mosaics']): HTMLUListElement => {
    const ul = el('ul', 'ss-links');
    for (const m of items) {
      const li = el('li');
      const a = el('a', undefined, `${m.site ?? m.id}: ${m.season}, ${m.localTime.replace(/^0?(\d+)(am|pm)$/, '$1 $2')} ↗`);
      a.href = m.url;
      a.target = '_blank';
      a.rel = 'noopener noreferrer';
      a.setAttribute('aria-label', `${m.label}. Opens the product in the ShadowCam PDS archive in a new tab.`);
      const dates = m.imagesFrom && m.imagesTo ? (m.imagesFrom === m.imagesTo ? `images of ${m.imagesFrom}` : `images of ${m.imagesFrom} to ${m.imagesTo}`) : 'image dates not stated';
      li.append(a, el('span', 'ly-note', `${dates}, ${m.pixelScaleM} m per pixel`));
      ul.append(li);
    }
    return ul;
  };
  const renderShadowCam = (r: ShadowCamReadout): void => {
    if (!('mosaics' in r)) {
      empty(camBox);
      setMissing('ShadowCam mosaics', r.reason);
      return;
    }
    if (!r.mosaics.length) {
      empty(camBox);
      setMissing('ShadowCam mosaics', `none of the ${r.mosaicsInIndex} controlled mosaics covers this point`);
      return;
    }
    setMissing('ShadowCam mosaics', null);
    const shown = r.mosaics.slice(0, 3);
    const rest = r.mosaics.slice(3);
    fill(camBox, `ShadowCam mosaics covering this point (${r.mosaics.length})`, {
      list: linkList(shown),
      notes: [`Images of permanently shadowed ground, taken by light reflected from nearby terrain. They are not included in the app: each link opens the product in the ShadowCam PDS archive. Credit: ${r.credit}.`],
      more: { summary: rest.length ? `${rest.length} more, credit and terms` : 'Credit and terms', lines: [r.licence, r.creditNote, r.coverageMeaning, ...r.citation] },
      moreList: rest.length ? linkList(rest) : undefined,
    });
  };

  // ---------- keeping it current ----------
  let token = 0;
  const render = (): void => {
    const site = ctx.store.get().site;
    const mine = ++token;
    missing.clear();
    none.textContent = '';
    if (!site) {
      section.hidden = true;
      return;
    }
    section.hidden = false;
    renderDsn();
    fill(avgBox, 'Long-term averages', { tag: '18.6-year average, not this date', status: 'Reading the maps…' });
    fill(iceBox, 'Nearest mapped ice targets', { status: 'Reading the database…' });
    fill(tempBox, 'Surface temperature (Diviner, annual)', { status: 'Reading the maps…' });
    fill(camBox, 'ShadowCam mosaics', { status: 'Reading the index…' });
    const current = <T>(draw: (r: T) => void) => (r: T): void => {
      if (mine === token) draw(r);
    };
    void averagesReadout(site).then(current(renderAverages));
    void iceReadout(site, 3).then(current(renderIce));
    void temperatureReadout(site).then(current(renderTemperature));
    void shadowCamReadout(site).then(current(renderShadowCam));
  };

  ctx.store.subscribe(['site'], render);
  ctx.analysis.subscribe((slot) => {
    if (slot === 'current') renderDsn();
  });
  render();
}
