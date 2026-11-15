// The commands deterministic mode understands. Each intent is a pattern over one step of
// the request and a plan that runs registered actions (never anything else) and words
// its reply from their results.
//
// Order matters: the first intent that matches wins, so specific phrasings sit above
// general ones ("go to next sunrise" is an event jump, not a site called "next sunrise").
// A step that matches nothing is reported as not understood; nothing here guesses.
import { MOON_RADIUS_KM } from '../../core/types';
import { isoUtc } from '../../core/time';
import { Halt, type CandidateMemo, type Ctx } from './context';
import { at, bearing, coordinates, degrees, distance, hours, isObject, num, percent, plural, span, str, utc, type Json } from './format';
import * as later from './laterIntents';
import { COMPASS_WORD, compassAzimuth, findCoordinates, findDateTime, findDuration, findNumbers } from './parse';
import { EARTH_NOTE, plan, siteText, type Intent, type Plan } from './plan';

export type { Plan } from './plan';

/** Camera altitude of the whole-Moon view, km above the surface (2.4 lunar radii, as the globe uses). */
const WHOLE_MOON_ALTITUDE_KM = 2.4 * MOON_RADIUS_KM;


// ---------------------------------------------------------------- reply wording

/**
 * The headline metrics of an analysis result (either the getState summary or a getAnalysis result).
 * Earth comes in two definitions that are never mixed up: its centre above the skyline
 * (earthVisiblePct, longestEarthGapH) and, where the result gives it (getAnalysis from T-47 on),
 * any part of its disc (earthAnyPct, longestEarthAnyGapH: the PGDA long-term map's definition).
 */
function metricsText(a: Json): string {
  const slope = num(a, 'slopeDeg', 'slope.slopeDeg');
  const anyPct = num(a, 'earthAnyPct', 'metrics.earthAnyPct'), anyGap = num(a, 'longestEarthAnyGapH', 'metrics.longestEarthAnyGapH');
  return [
    `illumination ${percent(num(a, 'illuminationPct', 'metrics.illuminationPct'))}`,
    `longest darkness ${hours(num(a, 'longestDarknessH', 'metrics.longestDarknessH'))}`,
    `Earth's centre in view ${percent(num(a, 'earthVisiblePct', 'metrics.earthVisiblePct'))}`,
    `longest Earth-centre gap ${hours(num(a, 'longestEarthGapH', 'metrics.longestEarthGapH'))}`,
    ...(anyPct !== undefined ? [`any part of Earth's disc in view ${percent(anyPct)}`] : []),
    ...(anyGap !== undefined ? [`longest spell with Earth's whole disc hidden ${hours(anyGap)}`] : []),
    `slope ${degrees(slope)}`,
  ].join(', ');
}

/** The Filters panel's solar band when nobody has changed it (src/core/requirements.ts DEFAULT_SUN_BAND): no requirement. For builds before T-46's `required`. */
const defaultSunBand = (band: Json): boolean => num(band, 'minDeg') === 0 && num(band, 'maxDeg') === 90;

function warningsText(a: Json): string {
  const w = a.warnings;
  return Array.isArray(w) && w.length ? ` Notes from the analysis: ${w.filter((x) => typeof x === 'string').join(' ')}` : '';
}

function sideText(tag: 'A' | 'B', r: Json): { line: string; data: Json | null } {
  const raw = isObject(r[`analysis${tag}`]) ? (r[`analysis${tag}`] as Json) : isObject(r[tag]) ? (r[tag] as Json) : null;
  const label = typeof r[tag] === 'string' ? (r[tag] as string) : (str(raw, 'scenario', 'label', 'scenario.label') ?? `scenario ${tag}`);
  if (!raw || raw.state === 'idle') return { line: `${tag}: ${label}: no analysis available.`, data: null };
  if (raw.state === 'loading') return { line: `${tag}: ${label}: still being analysed.`, data: null };
  if (raw.state === 'error') return { line: `${tag}: ${label}: ${str(raw, 'error') ?? 'analysis not available'}`, data: null };
  return { line: `${tag}: ${label}: ${metricsText(raw)}.`, data: raw };
}

const signed = (v: number, digits = 1): string => `${v > 0 ? '+' : ''}${v.toFixed(digits)}`;

function comparisonText(r: Json): string {
  const a = sideText('A', r);
  const b = sideText('B', r);
  const lines = [a.line, b.line];
  if (a.data && b.data) {
    const given = isObject(r.diff) ? r.diff : null;
    const diff = (flat: string, nested: string): number | undefined => {
      const fromApp = given ? num(given, flat) : undefined;
      if (fromApp !== undefined) return fromApp;
      const x = num(a.data, flat, nested), y = num(b.data, flat, nested);
      return x !== undefined && y !== undefined ? y - x : undefined;
    };
    const parts: string[] = [];
    const add = (label: string, v: number | undefined, unit: string) => {
      if (v !== undefined) parts.push(`${label} ${signed(v)}${unit}`);
    };
    add('illumination', diff('illuminationPct', 'metrics.illuminationPct'), ' percentage points');
    add('longest darkness', diff('longestDarknessH', 'metrics.longestDarknessH'), ' h');
    add("Earth's centre in view", diff('earthVisiblePct', 'metrics.earthVisiblePct'), ' percentage points');
    add('longest Earth-centre gap', diff('longestEarthGapH', 'metrics.longestEarthGapH'), ' h');
    add("any part of Earth's disc in view", diff('earthAnyPct', 'metrics.earthAnyPct'), ' percentage points');
    add('slope', diff('slopeDeg', 'slope.slopeDeg'), '°');
    if (parts.length) lines.push(`B minus A: ${parts.join(', ')}.`);
    const highlights = given && Array.isArray(given.highlights) ? given.highlights.filter((h): h is string => typeof h === 'string') : [];
    if (highlights.length) lines.push(highlights.join(' '));
  }
  if (!(a.data && b.data) && typeof r.error === 'string') lines.push(r.error);
  lines.push('The comparison is open on screen.');
  return lines.join('\n');
}

function stateText(s: Json): string {
  const lines: string[] = [];
  const view = str(s, 'view') === 'surface' ? 'Surface view' : 'Globe view';
  lines.push(`${view}. Simulated time ${utc(str(s, 'timeUtc'))}${s.playing === true ? ' (clock running)' : ' (clock paused)'}.`);
  lines.push(s.site ? `Site: ${siteText(s.site)}.` : 'No site is selected.');
  const start = str(s, 'missionWindow.startUtc');
  const delay = num(s, 'missionWindow.delayH');
  lines.push(`Mission window: from ${utc(start)} for ${hours(num(s, 'missionWindow.durationH'))}${delay ? `, arrival delay ${hours(delay)}` : ''}; mast height ${num(s, 'mastHeightM') ?? 'unavailable'} m.`);
  const a = s.analysis;
  if (isObject(a)) {
    if (a.state === 'ready') lines.push(`Analysis: ${metricsText(a)}.${warningsText(a)}`);
    else if (a.state === 'loading') lines.push('Analysis: still running.');
    else if (a.state === 'error') lines.push(`Analysis: ${str(a, 'error') ?? 'not available'}`);
  }
  const overlay = str(s, 'overlay');
  if (overlay && overlay !== 'off') lines.push(`Overlay: ${overlay}.`);
  if (at(s, 'compare.open') === true) lines.push(`Comparison open: A = ${str(s, 'compare.A') ?? 'empty'}; B = ${str(s, 'compare.B') ?? 'empty'}.`);
  return lines.join('\n');
}

// ---------------------------------------------------------------- help and raw actions

const help: Intent = (step) => {
  if (!/^(help|\?|commands?|examples?|what can (you|i) (do|say|ask)|what do you understand|how do(es)? (this|you|it) work)$/.test(step)) return null;
  return plan('show help', async (ctx) => {
    const lines = ['Deterministic mode understands these kinds of requests (join several with "then"):'];
    const add = (needs: string[], text: string) => {
      if (needs.every((n) => ctx.has(n))) lines.push(`- ${text}`);
    };
    add(['selectSite'], 'Sites: "go to Apollo 11", "show IM-2 at its landing time", "select Chang\'e 4", "clear the pin"');
    add(['dropPin'], 'Coordinates: "drop a pin at 89.45 S, 137.2 W", "go to lat -85.3 lon 31.2"');
    add(['enterSurface', 'exitSurface'], 'Views: "enter the surface", "back to the globe"');
    add(['setTime'], 'Time: "set time to 2026-03-01 12:00", "forward 6 hours", "back 2 days", "play", "pause"');
    add(['jumpToEvent'], 'Events: "jump to next sunrise", "previous earthset"');
    add(['setDelay'], 'Delay: "delay arrival by 24 h", "no delay"');
    add(['saveScenario', 'compare'], 'Compare: "save as A", "save as B", "compare", "compare with a 24 h delay", "compare mast 2 m and 10 m", "close comparison"');
    add(['rankNearby'], 'Nearby: "rank nearby sites within 2 km", "find a flatter nearby site with a shorter blackout", then "compare it against this pin" or "go there"');
    add(['explainBlockage'], 'Blocking terrain: "what blocks the Sun", "show the ridge at earthset"');
    add(['setMastHeight', 'setMissionWindow'], 'Mission: "mast 10 m", "mission window 14 days", "window starts 2026-01-05 00:00"');
    add(['setSlopeLimit'], 'Requirements: "slope limit 8", "maximum earth gap 12 h", "sun elevation between 5 and 60"');
    add(['setOverlay'], 'Overlays: "show the sun band overlay", "show the average illumination map", "hide overlay"');
    add(['setFilters'], 'Missions: "hide missions", "only Apollo", "only crewed", "missions from 1969 to 1972", "reset filters"');
    add(['lookAt'], 'Looking around (surface): "look north", "look at azimuth 120", "turn left", "look at the Sun"');
    add(['setGlobeCamera'], 'Globe: "show the whole Moon", "show the south pole", "zoom in", "turn the globe to 10 N 45 E"');
    add(['getState'], 'Questions: "status", "what time is it", "illumination", "where is the Earth"');
    for (const [needs, text] of later.LATER_HELP) add(needs, text);
    lines.push('- Anything else by name: "/actions" lists every action, "/setOverlay {"mode":"off"}" runs one.');
    lines.push('It does not understand free-form language: that needs the language model.');
    return lines.join('\n');
  });
};

const listAll: Intent = (step) => {
  if (!/^(\/actions|actions|list (all |the )?actions|tools|\/tools)$/.test(step)) return null;
  return plan('list every action', async (ctx) => {
    const all = ctx.api.list();
    const lines = all.map((a) => {
      const params = Object.keys(a.params.properties);
      return `/${a.name}${params.length ? ` {${params.join(', ')}}` : ''}: ${a.title}`;
    });
    return `${plural(all.length, 'action')} in this build:\n${lines.join('\n')}`;
  });
};

const rawCall: Intent = (_step, raw) => {
  const m = /^\s*(?:\/|(?:run|call|do|action)\s+\/?)([A-Za-z][A-Za-z0-9_]*)\s*(\{[\s\S]*\})?\s*$/.exec(raw);
  if (!m) return null;
  const wanted = m[1];
  return plan(`run the action ${wanted}`, async (ctx) => {
    const def = ctx.api.def(wanted) ?? ctx.api.list().find((a) => a.name.toLowerCase() === wanted.toLowerCase());
    if (!def) throw new Halt(`There is no action named "${wanted}". Type "/actions" for the list.`);
    let params: unknown = {};
    if (m[2]) {
      try {
        params = JSON.parse(m[2]);
      } catch {
        throw new Halt(`The parameters after "${def.name}" are not valid JSON. Example: /${def.name} {"name": value}`);
      }
    }
    const result = await ctx.run(def.name, isObject(params) ? params : { value: params });
    return `${def.title}: ${JSON.stringify(result)}`;
  });
};

const assistantUi: Intent = (step) => {
  if (/^(close|hide|dismiss) (the |this )?(assistant|chat|drawer|panel)$/.test(step)) {
    return plan('close the assistant', async (ctx) => {
      await ctx.run('setAssistantOpen', { open: false });
      return 'Closing the assistant.';
    });
  }
  if (/^(clear|reset|new|erase|start (a )?new) (the |this )?(chat|conversation|history)$/.test(step)) {
    return plan('clear the conversation', async (ctx) => {
      await ctx.run('clearConversation');
      return 'Conversation cleared.';
    });
  }
  return null;
};

// ---------------------------------------------------------------- comparison

async function selectMemo(ctx: Ctx, site: { id?: string; latDeg: number; lonDegEast: number }): Promise<void> {
  if (site.id && !site.id.startsWith('pin:') && !site.id.startsWith('cand')) await ctx.run('selectSite', { site: site.id });
  else await ctx.run('dropPin', { lat: site.latDeg, lon: site.lonDegEast });
}

async function selectCandidate(ctx: Ctx, c: CandidateMemo): Promise<void> {
  if (ctx.has('selectCandidate') && (c.rank !== undefined || c.id !== undefined)) {
    await ctx.run('selectCandidate', c.rank !== undefined ? { rank: c.rank } : { id: c.id! });
  } else {
    await ctx.run('dropPin', { lat: c.latDeg, lon: c.lonDegEast, fly: true });
  }
}

const compareFamily: Intent = (step) => {
  if (/^(close|hide|stop|exit|end|leave|dismiss)\b.*\b(comparison|compare|comparing|side by side)\b/.test(step)) {
    return plan('close the comparison', async (ctx) => {
      await ctx.run('stopCompare');
      return 'Closed the comparison. Scenarios A and B are kept.';
    });
  }
  const save = /^(?:save|store|keep|remember)\b(?:.*\b(?:as|in|to|into|for))?\s*(?:slot |scenario )?([ab])$/.exec(step) ?? /^set (?:slot|scenario) ([ab])$/.exec(step);
  if (save) {
    const slot = save[1].toUpperCase();
    return plan(`save the current scenario as ${slot}`, async (ctx) => {
      const r = await ctx.run('saveScenario', { slot });
      return `Saved the current scenario as ${slot}: ${str(r, 'scenario.label') ?? 'done'}.`;
    });
  }
  if (!/^(compare|comparison|open (the )?comparison|show (the )?comparison|side by side)\b/.test(step)) return null;

  if (/\bmast\b/.test(step)) {
    const heights = findNumbers(step);
    if (heights.length < 2) return null;
    const [a, b] = heights;
    return plan(`compare mast heights ${a} m and ${b} m`, async (ctx) => {
      // The compare panel's control: B is A with the other mast; the mast on screen is not changed.
      if (ctx.has('compareMastHeights')) {
        const r = await ctx.comparison('compareMastHeights', { heightAM: a, heightBM: b, basis: 'current' });
        return `Comparing mast heights ${num(r, 'mastHeightAM') ?? a} m (A) and ${num(r, 'mastHeightBM') ?? b} m (B) at the same site and over the same mission window. The mast height on screen is not changed.\n${comparisonText(r)}`;
      }
      await ctx.run('setMastHeight', { metres: a });
      await ctx.run('saveScenario', { slot: 'A' });
      await ctx.run('setMastHeight', { metres: b });
      await ctx.run('saveScenario', { slot: 'B' });
      return `Comparing mast heights ${a} m (A) and ${b} m (B) at the same site and mission window. The mast is now set to ${b} m.\n${comparisonText(await ctx.comparison())}`;
    });
  }

  if (/\b(delay|delayed|late|later|slip)\b|(?:\+|\bplus )\s*\d/.test(step)) {
    const d = findDuration(step);
    if (!d || d.hours <= 0) return null;
    return plan(`compare an on-time arrival with a ${hours(d.hours)} delay`, async (ctx) => {
      // The compare panel's control: B is the scenario on screen arriving later; the scenario on screen is not changed.
      if (ctx.has('compareDelayedArrival')) {
        const r = await ctx.comparison('compareDelayedArrival', { delayH: d.hours, basis: 'current' });
        return `Comparing the scenario on screen (A, arriving ${utc(str(r, 'plannedArrivalUtc'))}) with the same arriving ${hours(num(r, 'delayH') ?? d.hours)} later (B, ${utc(str(r, 'revisedArrivalUtc'))}). The scenario on screen and its own arrival delay are not changed.\n${comparisonText(r)}`;
      }
      await ctx.run('setDelay', { hours: 0 });
      await ctx.run('saveScenario', { slot: 'A' });
      await ctx.run('setDelay', { hours: d.hours });
      await ctx.run('saveScenario', { slot: 'B' });
      return `Comparing arrival on time (A) with arrival ${hours(d.hours)} late (B) at the same site. The delay is now set to ${hours(d.hours)}.\n${comparisonText(await ctx.comparison())}`;
    });
  }

  if (/^compare (it|that|that site|that one|this one|the candidate|the alternative|the new (site|one)) (against|with|to|and|vs|versus) (this pin|this site|the pin|my pin|here|the original( site| pin)?|the current (site|pin)|the reference( site)?|where i am)\b/.test(step)) {
    return plan('compare the alternative (B) against the original pin (A) for the same mission window', async (ctx) => {
      const { reference, candidate } = ctx.memory;
      if (!reference || !candidate) throw new Halt('I do not know which site "it" is yet. Ask me to find a nearby alternative first, for example "find a flatter nearby site".');
      const st = await ctx.state();
      if (str(st, 'site.id') !== reference.id) await selectMemo(ctx, reference);
      await ctx.run('saveScenario', { slot: 'A' });
      await selectCandidate(ctx, candidate);
      await ctx.run('saveScenario', { slot: 'B' });
      const r = await ctx.comparison();
      return `Comparing the original pin (A) with the alternative (B) over the same mission window and mast height. The alternative is now the selected site.\n${comparisonText(r)}`;
    });
  }

  if (/^(compare|comparison|open (the )?comparison|show (the )?comparison|side by side)( (a (and|with|to|vs|versus|against) b|scenarios?|them|both|a\/b|a & b))?$/.test(step)) {
    return plan('open the comparison of A and B', async (ctx) => comparisonText(await ctx.comparison()));
  }
  return null;
};

// ---------------------------------------------------------------- nearby alternatives

interface Criterion {
  words: string;
  /** Result key of the metric, and whether lower is better. */
  key: string;
  lower: boolean;
  unit: (v: number | undefined) => string;
  label: string;
}

const CRITERIA: { pattern: RegExp; c: Criterion }[] = [
  { pattern: /\b(flatter|less steep|lower slope|gentler|smoother)\b/, c: { words: 'flatter', key: 'slopeDeg', lower: true, unit: degrees, label: 'slope' } },
  { pattern: /\b(shorter|less|smaller|lower)\s+(blackout|darkness|dark|night)s?\b/, c: { words: 'a shorter blackout', key: 'longestDarknessH', lower: true, unit: hours, label: 'longest darkness' } },
  { pattern: /\b(more (sun|sunlight|light|illumination|power)|sunnier|brighter|better (lit|illuminated))\b/, c: { words: 'more sunlight', key: 'illuminationPct', lower: false, unit: percent, label: 'illumination' } },
  { pattern: /\bshorter (earth )?gaps?\b/, c: { words: 'a shorter Earth-centre gap', key: 'longestEarthGapH', lower: true, unit: hours, label: 'longest Earth-centre gap' } },
  { pattern: /\b((more|better|longer) earth|better (comms|communication|contact|line of sight))\b/, c: { words: "more time with Earth's centre in view", key: 'earthVisiblePct', lower: false, unit: percent, label: "Earth's centre in view" } },
];

function rowText(row: Json): string {
  const where = num(row, 'distanceM') !== undefined ? `${distance(num(row, 'distanceM'))} to the ${bearing(num(row, 'bearingDeg'))}` : coordinates(num(row, 'latDeg'), num(row, 'lonDegEast'));
  return `${str(row, 'name') ?? 'candidate'} (${where}): slope ${degrees(num(row, 'slopeDeg'))}, illumination ${percent(num(row, 'illuminationPct'))}, longest darkness ${hours(num(row, 'longestDarknessH'))}, Earth's centre in view ${percent(num(row, 'earthVisiblePct'))}`;
}

function memoOf(row: Json): CandidateMemo | null {
  const latDeg = num(row, 'latDeg'), lonDegEast = num(row, 'lonDegEast');
  if (latDeg === undefined || lonDegEast === undefined) return null;
  return { rank: num(row, 'rank'), id: str(row, 'id'), name: str(row, 'name'), latDeg, lonDegEast };
}

const nearby: Intent = (step) => {
  const asksNearby = /\b(nearby|near here|around here|close by|in the area|alternatives?|better (landing )?(site|spot|place|location)s?)\b|^rank\b/.test(step);
  const asksBetter = /^(find|suggest|search|look for|show|scan|is there|are there)\b.*\b(site|spot|place|location|pin)s?\b/.test(step) && CRITERIA.some((k) => k.pattern.test(step));
  if (!asksNearby && !asksBetter) return null;
  if (/^(compare|select|pin|choose|pick|go|fly)\b/.test(step)) return null;

  const params: Json = {};
  const radius = /\b(?:within|radius(?: of)?|out to|up to)\s+(\d+(?:\.\d+)?)\s*(km|m)\b/.exec(step) ?? /\b(\d+(?:\.\d+)?)\s*(km|m)\s+radius\b/.exec(step);
  if (radius) params.radiusM = Number(radius[1]) * (radius[2] === 'km' ? 1000 : 1);
  const spacing = /\b(?:spacing(?: of)?|every|grid(?: of)?|step(?: of)?)\s+(\d+(?:\.\d+)?)\s*(km|m)\b/.exec(step);
  if (spacing) params.spacingM = Number(spacing[1]) * (spacing[2] === 'km' ? 1000 : 1);
  const slope = /\bslopes?\s*(?:limit|max(?:imum)?)?\s*(?:of|under|below|<|at most|up to|=|to)?\s*(\d+(?:\.\d+)?)/.exec(step);
  if (slope) params.slopeLimitDeg = Number(slope[1]);
  const criteria = CRITERIA.filter((k) => k.pattern.test(step)).map((k) => k.c);

  return plan(criteria.length ? `look for a nearby site with ${criteria.map((c) => c.words).join(' and ')}` : 'rank nearby alternative sites', async (ctx) => {
    const st = await ctx.state();
    const site = st.site;
    if (!isObject(site)) throw new Halt('No site is selected. Select a landing site or drop a pin first, then ask for nearby alternatives.');
    const r = await ctx.run('rankNearby', params);
    const reference = isObject(r.reference) ? r.reference : null;
    const rows = (Array.isArray(r.candidates) ? r.candidates : []).filter((c): c is Json => isObject(c) && c.isReference !== true && (num(c, 'rank') ?? 1) > 0);
    const id = str(site, 'id'), latDeg = num(site, 'latDeg'), lonDegEast = num(site, 'lonDegEast');
    if (id && latDeg !== undefined && lonDegEast !== undefined) ctx.memory.reference = { id, name: str(site, 'name') ?? 'the pin', latDeg, lonDegEast };
    const basis = str(r, 'basis');
    const tail = `${basis ? ` Basis: ${basis}` : ''} ${EARTH_NOTE}`;
    if (!rows.length) return `The scan found no acceptable alternative near ${str(site, 'name') ?? 'the pin'}.${tail}`;

    if (!criteria.length) {
      const top = rows.slice(0, 3);
      const first = memoOf(top[0]);
      if (first) ctx.memory.candidate = first;
      const lines = top.map((row, i) => `${i + 1}. ${rowText(row)}.`);
      return `Ranked ${plural(rows.length, 'alternative')} near ${str(site, 'name') ?? 'the pin'}. Best first:\n${lines.join('\n')}${reference ? `\nThis pin: ${rowText(reference)}.` : ''}\nSay "go there" for the first one, or "compare it against this pin".${tail}`;
    }

    if (!reference) throw new Halt('The ranking did not include the values of the current pin, so I cannot tell which alternatives are better than it.');
    const missing = criteria.filter((c) => num(reference, c.key) === undefined);
    if (missing.length) throw new Halt(`The ranking does not report ${missing.map((c) => c.label).join(' or ')} for this pin, so I cannot apply that condition.`);
    const better = rows.filter((row) =>
      criteria.every((c) => {
        const v = num(row, c.key), ref = num(reference, c.key)!;
        return v !== undefined && (c.lower ? v < ref : v > ref);
      }),
    );
    const wanted = criteria.map((c) => c.words).join(' and ');
    const refValues = criteria.map((c) => `${c.label} ${c.unit(num(reference, c.key))}`).join(', ');
    const rankedCount = num(r, 'rankedCount');
    const among = rankedCount !== undefined && rankedCount > rows.length ? `${rows.length} best-ranked alternatives (of ${rankedCount} ranked)` : plural(rows.length, 'ranked alternative');
    if (!better.length) {
      return `None of the ${among} has ${wanted} than this pin (${refValues}). The best-ranked alternative is ${rowText(rows[0])}.${tail}`;
    }
    const pick = better[0];
    const memo = memoOf(pick);
    if (memo) ctx.memory.candidate = memo;
    const versus = criteria.map((c) => `${c.label} ${c.unit(num(pick, c.key))} (this pin: ${c.unit(num(reference, c.key))})`).join(', ');
    return `Found a site with ${wanted}: ${rowText(pick)}.\nAgainst this pin: ${versus}. ${plural(better.length, 'alternative')} of the ${among} met the condition; this is the best-ranked of them.\nSay "compare it against this pin" or "go there".${tail}`;
  });
};

const pickCandidate: Intent = (step) => {
  const there = /^(go|fly|move|jump|switch|head|take me) (there|to it|to that (site|one|spot|place)|to the (candidate|alternative))$/.test(step);
  const it = /^(select|pin|choose|pick|use|take|open|go to|switch to) (it|that (site|one)|the (candidate|alternative))$/.test(step);
  const numbered = /^(?:select|pin|choose|pick|use|take|open|go to|switch to) (?:candidate|alternative|number|no|#)\s*#?\s*(\d+)$/.exec(step);
  const ordinal = /^(?:select|pin|choose|pick|use|take|open|go to|switch to) the (first|second|third|best|top)(?: (?:one|candidate|site|alternative))?$/.exec(step);
  if (!there && !it && !numbered && !ordinal) return null;
  const rank = numbered ? Number(numbered[1]) : ordinal ? ({ first: 1, best: 1, top: 1, second: 2, third: 3 } as Record<string, number>)[ordinal[1]] : undefined;
  return plan(rank ? `select nearby candidate ${rank}` : 'select the alternative found earlier', async (ctx) => {
    if (rank !== undefined) {
      const r = await ctx.run('selectCandidate', { rank });
      return `Selected candidate ${rank}: ${siteText(r.site)}.`;
    }
    const c = ctx.memory.candidate;
    if (!c) throw new Halt('I do not know which site you mean yet. Ask me to rank or find nearby alternatives first.');
    await selectCandidate(ctx, c);
    return `Selected the alternative: ${c.name ?? 'the candidate'} (${coordinates(c.latDeg, c.lonDegEast)}).`;
  });
};

// ---------------------------------------------------------------- events and blocking terrain

const EVENT = '(sunrise|sunset|earthrise|earthset|sun rise|sun set|earth rise|earth set)';
const eventType = (word: string): string => word.replace(' ', '');
const eventWhich = (word: string | undefined): 'next' | 'previous' => (word && /previous|last|prior|preceding/.test(word) ? 'previous' : 'next');
const EVENT_NAME: Record<string, string> = { sunrise: 'sunrise', sunset: 'sunset', earthrise: 'Earthrise', earthset: 'Earthset' };
/**
 * A rise or set time with the instant it is (decision D-8): "Sun fully set 2025-03-16 19:30 UTC
 * (the last part of the Sun's disc goes behind the terrain skyline)" when the result names it;
 * builds before the labels give the time alone.
 */
const whenText = (j: Json): string =>
  `${str(j, 'label') ? `${str(j, 'label')} ` : ''}${utc(str(j, 'timeUtc'))}${str(j, 'instant') ? ` (${str(j, 'instant')})` : ''}${j.outsideAnalysedWindow === true ? ', just outside the analysed mission window' : ''}`;

/** Times in order, as the science core writes them: the date only when it differs from the time before. */
function clockText(): (iso: string) => string {
  let day = '';
  return (iso) => {
    const m = /^(\d{4}-\d{2}-\d{2})T(\d{2}:\d{2})/.exec(iso);
    if (!m) return iso;
    const text = m[1] === day ? m[2] : `${m[1]} ${m[2]}`;
    day = m[1];
    return text;
  };
}

/**
 * The whole passage of a disc through the skyline (decision D-8: both ends of a set), from the
 * `span` that jumpToEvent and getAnalysis give (T-47): "The Sun starts setting 2025-03-16 18:23
 * and is fully set 19:30 UTC." Earth's centre crossings are named in between; a graze is "partly
 * hidden ... until its whole disc is clear again ...; it never fully sets". An end that was not
 * found or lies outside the analysed window is worded by the science core's own `summary`.
 * Without a span it says plainly that only the one labelled instant is available.
 */
function passageText(span: unknown, eventName?: string): string {
  if (!isObject(span)) return `Only this one instant${eventName ? ` of the ${eventName}` : ''} is available here, not the start and end of its passage through the skyline.`;
  const The = str(span, 'body') === 'earth' ? 'Earth' : 'The Sun';
  const kind = str(span, 'kind');
  const start = str(span, 'start.timeUtc'), end = str(span, 'end.timeUtc');
  // Earth's centre crossings are part of its passage (Earthset and Earthrise are the centre); the science core names none for the Sun.
  const centre = The === 'Earth' && Array.isArray(span.centre) ? span.centre.filter(isObject) : [];
  const allInside = at(span, 'start.inWindow') === true && at(span, 'end.inWindow') === true && centre.every((c) => c.inWindow === true && str(c, 'timeUtc'));
  if (start && end && allInside && (kind === 'set' || kind === 'rise' || kind === 'graze' || kind === 'peek')) {
    const t = clockText();
    const from = t(start);
    // "Earth's centre sets" -> "its centre sets 2025-03-19 04:08"
    const mids = centre.map((c) => `${(str(c, 'label') ?? '').replace(/^.*?centre\b/, 'its centre')} ${t(str(c, 'timeUtc')!)}`);
    const between = mids.length ? ` (${mids.join(', ')})` : '';
    const to = t(end);
    if (kind === 'set') return `${The} starts setting ${from}${between} and is fully set ${to} UTC.`;
    if (kind === 'rise') return `${The} starts rising ${from}${between} and is fully risen ${to} UTC.`;
    if (kind === 'graze') return `${The} is partly hidden from ${from}${between} until its whole disc is clear again ${to} UTC; it never fully sets.`;
    return `Part of ${The === 'Earth' ? 'Earth' : 'the Sun'} shows from ${from}${between} until it is gone again ${to} UTC; it never fully rises.`;
  }
  const summary = str(span, 'summary');
  return summary ? `${The}: ${summary}.` : `The start and end of this passage are not available, only the instant above.`;
}

/** Which instant of an event a request asks for (jumpToEvent `instant`, T-47): the event itself, or an end of its passage. */
type InstantChoice = 'event' | 'start' | 'end';

/**
 * The event and instant named by an end of a passage: "the Sun starts setting" is the start of a
 * sunset, "Earth fully risen" the end of an Earthrise. A sunset is itself the last limb and a
 * sunrise the first limb, so those ends are the events themselves (and work on every build).
 */
function edgeEvent(body: string, starts: string | undefined, fully: string | undefined): { type: string; instant: InstantChoice } {
  const setting = starts ? /^set/.test(starts) : fully === 'set';
  const type = `${body}${setting ? 'set' : 'rise'}`;
  if (starts) return { type, instant: type === 'sunrise' ? 'event' : 'start' };
  return { type, instant: type === 'sunset' ? 'event' : 'end' };
}

/** "start" of a sunrise and "end" of a sunset are the events themselves. */
const sameAsEvent = (type: string, instant: InstantChoice): InstantChoice => ((type === 'sunrise' && instant === 'start') || (type === 'sunset' && instant === 'end') ? 'event' : instant);

/** The terrain that forms the skyline under a body, whichever action reported it. */
interface Blocking {
  azDeg?: number;
  elDeg?: number;
  skylineElDeg?: number;
  clearanceDeg?: number;
  blocked?: boolean;
  distanceM?: number;
  heightM?: number;
  demName?: string;
  demResolutionM?: number;
  explanation?: string;
}

/** From `explainBlockage`. */
function blockingFromAction(b: Json): Blocking {
  return {
    azDeg: num(b, 'bodyAzDeg'), elDeg: num(b, 'bodyElDeg'), skylineElDeg: num(b, 'skylineElDeg'), clearanceDeg: num(b, 'clearanceDeg'),
    blocked: typeof b.blocked === 'boolean' ? b.blocked : undefined,
    distanceM: num(b, 'ridgeDistanceM'), heightM: num(b, 'ridgeHeightM'), demName: str(b, 'demName'), demResolutionM: num(b, 'demResolutionM'), explanation: str(b, 'explanation'),
  };
}

/** From `getAnalysis`: `now.sun` / `now.earth` at the simulated time. */
function blockingFromAnalysis(a: Json, body: string): Blocking | null {
  const n = at(a, `now.${body}`);
  if (!isObject(n) || num(n, 'azDeg') === undefined) return null;
  const km = num(n, 'skylineTerrain.distanceKm');
  const above = n.centreAboveSkyline;
  return {
    azDeg: num(n, 'azDeg'), elDeg: num(n, 'elDeg'), skylineElDeg: num(n, 'skylineElDeg'), clearanceDeg: num(n, 'clearanceDeg'),
    blocked: typeof above === 'boolean' ? !above : undefined,
    distanceM: km === undefined ? undefined : km * 1000, heightM: num(n, 'skylineTerrain.heightM'),
    demName: str(n, 'skylineTerrain.demName'), demResolutionM: num(n, 'skylineTerrain.demResolutionM'), explanation: str(n, 'explanation'),
  };
}

const blockage: Intent = (step) => {
  const aboutTerrain = /\bridge\b/.test(step) || (/\b(blocks?|blocked|blocking|blockage|obstruct\w*|hidden|hides?|hiding|behind)\b/.test(step) && /\b(sun|earth|sunlight|view|line of sight|signal|contact|terrain|mountain|hill|crater rim)\b/.test(step));
  if (!aboutTerrain && !/^why\b.*\b(dark|shadow|no (sun|sunlight|earth|contact|signal))\b/.test(step)) return null;
  const ev = new RegExp(`\\bat (?:the )?(next |previous |last )?${EVENT}\\b`).exec(step);
  const event = ev ? eventType(ev[2]) : undefined;
  const body = /\bearth\b/.test(step) ? 'earth' : /\b(sun|solar|sunlight|dark|shadow|blackout)\b/.test(step) ? 'sun' : event?.startsWith('earth') ? 'earth' : event ? 'sun' : undefined;
  if (!body) {
    return plan('explain what blocks the view', async () => {
      throw new Halt('Do you mean the Sun or the Earth? For example: "what blocks the Earth" or "show the ridge at sunset".');
    });
  }
  const turn = Boolean(event) || /\b(show|look|see|point|turn|where|face)\b/.test(step);
  const bodyName = body === 'earth' ? 'Earth' : 'the Sun';
  return plan(`explain the terrain that blocks ${bodyName}${event ? ` at ${EVENT_NAME[event]}` : ''}`, async (ctx) => {
    const lines: string[] = [];
    let eventAz: number | undefined;
    if (!ctx.has('getAnalysis')) await ctx.analysis();
    if (event) {
      const j = await ctx.run('jumpToEvent', { type: event, which: eventWhich(ev![1]) });
      eventAz = num(j, 'azDeg');
      lines.push(`Moved the clock to the ${eventWhich(ev![1])} ${EVENT_NAME[event]}: ${whenText(j)}. ${passageText(j.span, EVENT_NAME[event])}`);
    }
    // The blocking terrain comes from the dedicated action when the build has it, otherwise
    // from the analysis readout at the simulated time. Both describe the same skyline.
    let b: Blocking | null = null;
    if (ctx.has('explainBlockage')) b = blockingFromAction(await ctx.run('explainBlockage', { body }));
    else if (ctx.has('getAnalysis')) b = blockingFromAnalysis(await ctx.analysis(), body);
    const unavailable = b ? '' : 'The blocking-terrain explanation is not available in this build.';
    if (turn) {
      const st = await ctx.state();
      if (str(st, 'view') !== 'surface') await ctx.run('enterSurface');
      const azDeg = b?.azDeg ?? eventAz;
      if (azDeg === undefined) throw new Halt(`${[...lines, unavailable].filter(Boolean).join(' ')} I do not have a direction to turn the view to.`);
      const skyline = b?.skylineElDeg;
      const look = await ctx.run('lookAt', { azDeg, ...(skyline !== undefined ? { elDeg: Math.max(-85, Math.min(85, skyline)) } : {}) });
      lines.push(`Turned the surface view to azimuth ${degrees(num(look, 'look.azDeg') ?? azDeg)}${event ? `, where ${bodyName} meets the skyline` : ''}.`);
    }
    if (b) {
      lines.push(b.explanation ?? `${bodyName} is ${b.blocked === true ? 'blocked' : b.blocked === false ? 'not blocked' : 'here'}: elevation ${degrees(b.elDeg, 2)}, skyline ${degrees(b.skylineElDeg, 2)} at azimuth ${degrees(b.azDeg)}.`);
      lines.push(
        `Ridge: ${distance(b.distanceM)} away, ${b.heightM !== undefined ? `${Math.round(b.heightM)} m above the reference sphere` : 'height unavailable'}; clearance ${degrees(b.clearanceDeg, 2)}.${b.demName ? ` Elevation data: ${b.demName}${b.demResolutionM !== undefined ? ` (${b.demResolutionM} m)` : ''}.` : ''}`,
      );
    } else {
      lines.push(unavailable);
    }
    if (body === 'earth') lines.push(EARTH_NOTE);
    return lines.join('\n');
  });
};

const JUMP_VERB = '(?:(?:jump|go|skip|move|advance|fast[- ]?forward|rewind|scrub|take me|set (?:the )?(?:time|clock))\\s+)?(?:to\\s+|at\\s+)?(?:the\\s+)?';
const WHICH = '(next|previous|last|prior|preceding|following|upcoming)';
/** An end of a passage by its label (T-47 words): "the Sun starts setting", "Earth fully risen". */
const EDGE = "(sun|earth)(?:'s)?\\s+(?:(?:starts|begins|start|begin)\\s+(?:to\\s+)?(setting|rising|set|rise)|(?:is\\s+|has\\s+)?fully\\s+(set|risen|rose|up))";
const INSTANT_WORDS: Record<InstantChoice, string> = { event: '', start: 'start of the ', end: 'end of the ' };

const events: Intent = (step) => {
  const jump = new RegExp(`^${JUMP_VERB}${WHICH}?\\s*${EVENT}$`).exec(step);
  const part = jump ? null : new RegExp(`^${JUMP_VERB}(start|beginning|end)\\s+of\\s+(?:the\\s+)?${WHICH}?\\s*${EVENT}$`).exec(step);
  const edge = jump || part ? null : new RegExp(`^${JUMP_VERB}(?:${WHICH}\\s+)?(?:(?:moment|time|point)\\s+)?(?:when\\s+)?(?:the\\s+)?${EDGE}$`).exec(step);
  if (jump || part || edge) {
    let type: string, which: 'next' | 'previous', instant: InstantChoice;
    if (jump) {
      type = eventType(jump[2]);
      which = eventWhich(jump[1]);
      instant = 'event';
    } else if (part) {
      type = eventType(part[3]);
      which = eventWhich(part[2]);
      instant = part[1] === 'end' ? 'end' : 'start';
    } else {
      ({ type, instant } = edgeEvent(edge![2], edge![3], edge![4]));
      which = eventWhich(edge![1]);
    }
    instant = sameAsEvent(type, instant);
    const what = `${INSTANT_WORDS[instant]}${which} ${EVENT_NAME[type]}`;
    return plan(`move the clock to the ${what}`, async (ctx) => {
      // jumpToEvent goes to an end of the passage from T-47 on; earlier builds only to the event itself.
      if (instant !== 'event' && !ctx.api.def('jumpToEvent')?.params.properties.instant) {
        throw new Halt(`This build can move the clock to the ${which} ${EVENT_NAME[type]} itself (say "jump to ${which} ${type}"), not to the ${instant} of its passage through the skyline.`);
      }
      // Older builds fail while the analysis is running; newer ones (with getAnalysis) wait themselves.
      if (!ctx.has('getAnalysis')) await ctx.analysis();
      const j = await ctx.run('jumpToEvent', { type, which, ...(instant !== 'event' && { instant }) });
      const az = num(j, 'azDeg');
      return `Moved the clock to the ${what}: ${whenText(j)}${az !== undefined ? `, at azimuth ${degrees(az)}` : ''}. ${passageText(j.span, EVENT_NAME[type])} Rise and set times are measured against the terrain skyline.`;
    });
  }
  const ask = new RegExp(`^(?:when|what time)\\b.*?\\b(next|previous|last)?\\s*${EVENT}\\b`).exec(step);
  if (ask) {
    const type = eventType(ask[2]);
    return plan(`say when the next ${EVENT_NAME[type]} is`, async (ctx) => {
      if (!ctx.has('getAnalysis')) throw new Halt(`I can move the clock there: say "jump to next ${type}". Reading the time without moving the clock is not available in this build.`);
      const a = await ctx.analysis();
      const e = at(a, `nextEvents.${type}`);
      if (!isObject(e)) {
        // No such event in the window, but a passage may be under way, end beyond the window or be a graze (no event at all).
        const p = at(a, `nextPassages.${type.startsWith('sun') ? 'sun' : 'earth'}`);
        // After "Next passage of the Sun through the skyline:", the sentence goes on without naming the body twice.
        const words = isObject(p) ? passageText(p).replace(/^(?:The Sun|Earth): /, '').replace(/^(The|Part) /, (w) => w.toLowerCase()) : '';
        const next = words ? ` Next passage of ${type.startsWith('sun') ? 'the Sun' : 'Earth'} through the skyline: ${words}` : '';
        return `There is no ${EVENT_NAME[type]} after the simulated time inside the analysed mission window.${next}`;
      }
      const definition = str(a, `eventDefinitions.${type}`);
      const instant = definition && str(e, 'label') && definition.startsWith(`${str(e, 'label')}: `) ? definition.slice(str(e, 'label')!.length + 2).replace(/\.$/, '') : undefined;
      return `The next ${EVENT_NAME[type]}: ${whenText({ ...e, ...(instant && { instant }) })}${num(e, 'azDeg') !== undefined ? `, azimuth ${degrees(num(e, 'azDeg'))}` : ''} (against the terrain skyline). ${passageText(e.span, EVENT_NAME[type])}`;
    });
  }
  return null;
};

// ---------------------------------------------------------------- time, delay, mission

const delay: Intent = (step) => {
  if (!/\b(delay|delayed|postpone|slip)\b|\b(arriv\w*|land\w*|touch ?down)\b.*\blate\b|\blate(r)? (arrival|landing)\b/.test(step)) return null;
  if (/^(what|how|when|why|is|does)\b/.test(step) && !/\bwhat if\b/.test(step)) return null;
  const off = /\b(no|without|remove|clear|reset|cancel|zero|undo)\b.*\bdelay\b|\bdelay\b.*\b(off|none|zero)\b|\bon time\b/.test(step);
  const d = off ? { hours: 0 } : findDuration(step);
  if (!d || d.hours < 0) return null;
  return plan(off ? 'remove the arrival delay' : `set the arrival delay to ${hours(d.hours)}`, async (ctx) => {
    const r = await ctx.run('setDelay', { hours: d.hours });
    const h = num(r, 'delayH') ?? d.hours;
    return h === 0 ? `Arrival delay removed: the mission window starts ${utc(str(r, 'effectiveStartUtc'))}.` : `Arrival delay set to ${hours(h)}: the mission window now starts ${utc(str(r, 'effectiveStartUtc'))}.`;
  });
};

const clock: Intent = (step) => {
  if (/^(play|start|resume|run|animate)( (the )?(clock|time|simulation|animation|playback))?$/.test(step)) {
    return plan('start the clock', async (ctx) => {
      const r = await ctx.run('play');
      return `Clock running from ${utc(str(r, 'timeUtc'))} at ${span((num(r, 'rateSimSecondsPerSecond') ?? NaN) / 3600)} of simulated time per second.`;
    });
  }
  if (/^(pause|stop|freeze|halt)( (the )?(clock|time|simulation|animation|playback))?$/.test(step)) {
    return plan('pause the clock', async (ctx) => {
      const r = await ctx.run('pause');
      return `Clock paused at ${utc(str(r, 'timeUtc'))}.`;
    });
  }
  const rate = /\b(?:speed|rate|play|run)\b/.test(step) ? /(.*)\s*(?:per|\/|a|each)\s*(?:real\s+)?s(?:ec(?:ond)?)?s?$/.exec(step) : null;
  const perSecond = rate ? findDuration(rate[1]) : null;
  if (perSecond && perSecond.hours > 0) {
    return plan(`set the playback speed to ${span(perSecond.hours)} per second`, async (ctx) => {
      const r = await ctx.run('setRate', { secondsPerSecond: perSecond.hours * 3600 });
      return `Playback speed: ${span((num(r, 'rateSimSecondsPerSecond') ?? NaN) / 3600)} of simulated time per second.`;
    });
  }
  const change = /^(faster|speed up|slower|slow down)$/.exec(step);
  if (change) {
    const up = /faster|up/.test(change[1]);
    return plan(up ? 'double the playback speed' : 'halve the playback speed', async (ctx) => {
      const s = await ctx.state();
      const current = num(s, 'rateSimSecondsPerSecond');
      if (current === undefined) throw new Halt('The current playback speed is not available.');
      const r = await ctx.run('setRate', { secondsPerSecond: Math.max(1, up ? current * 2 : current / 2) });
      return `Playback speed: ${span((num(r, 'rateSimSecondsPerSecond') ?? NaN) / 3600)} of simulated time per second.`;
    });
  }
  return null;
};

const timeShift: Intent = (step) => {
  const m = /^(?:(go|move|jump|skip|step|advance|rewind|fast[- ]?forward|wind|scrub|set (?:the )?(?:time|clock))\s+)?(?:(?:the )?(?:time|clock)\s+)?(?:(forward|ahead|back|backward|backwards)\s+)?(?:by\s+)?(?:(\+|plus\s|-|minus\s)\s*)?(.+?)\s*(later|earlier|forward|back|ahead|ago|backwards?|from now|before)?$/.exec(step);
  if (!m) return null;
  const d = findDuration(m[4]);
  if (!d || d.match.length !== m[4].trim().length) return null;
  const words = [m[1], m[2], m[3], m[5]].filter(Boolean).join(' ');
  const backward = /back|rewind|earlier|ago|before|-|minus/.test(words);
  const forward = /forward|ahead|later|advance|skip|fast|from now|\+|plus/.test(words);
  if (!backward && !forward) return null;
  const offsetHours = (backward ? -1 : 1) * Math.abs(d.hours);
  return plan(`move the clock ${span(offsetHours)} ${backward ? 'back' : 'forward'}`, async (ctx) => {
    const r = await ctx.run('setTime', { offsetHours });
    return `Moved the clock ${span(offsetHours)} ${backward ? 'back' : 'forward'}: it is now ${utc(str(r, 'timeUtc'))}.`;
  });
};

const FILLER = /^(?:(?:set|change|move|go|jump|switch|take me|scrub|show)\s+)?(?:(?:the\s+)?(?:time|date|clock|simulation|simulated time)\s+)?(?:to|at|on|=|is)?$/;

const timeSet: Intent = (step) => {
  if (/^(?:(?:set|go|jump|move|reset|back)\s+)?(?:(?:the\s+)?(?:time|clock|date)\s+)?(?:to\s+)?(now|today|the present|current time|real time|right now)$/.test(step)) {
    return plan('set the clock to the current real time', async (ctx) => {
      const r = await ctx.run('setTime', { utc: isoUtc(ctx.now()) });
      return `Clock set to now: ${utc(str(r, 'timeUtc'))}.`;
    });
  }
  const dt = findDateTime(step);
  if (!dt) return null;
  if (!FILLER.test(step.replace(dt.match, '').trim())) return null;
  return plan(`set the clock to ${utc(dt.utc)}`, async (ctx) => {
    const r = await ctx.run('setTime', { utc: dt.utc });
    return `Clock set to ${utc(str(r, 'timeUtc'))}.`;
  });
};

const mission: Intent = (step) => {
  const mast = /\bmast(?:\s+height)?\s*(?:to|of|=|at|is)?\s*(\d+(?:\.\d+)?)\s*(?:m|metres?|meters?)?$/.exec(step) ?? /^(?:set |use |try )?(?:a |an )?(\d+(?:\.\d+)?)\s*(?:m|metres?|meters?)\s+mast$/.exec(step);
  if (mast && !/^(what|how|why|is|does)\b/.test(step)) {
    const metres = Number(mast[1]);
    return plan(`set the mast height to ${metres} m`, async (ctx) => {
      const r = await ctx.run('setMastHeight', { metres });
      return `Mast height set to ${num(r, 'mastHeightM') ?? metres} m above the local terrain.`;
    });
  }

  if (/\b(mission )?window\b|\bmission (length|duration)\b|^(arrive|arrival|land|landing|touch ?down)\b/.test(step) && !/^(what|how|why|is|does|when)\b/.test(step)) {
    const dt = findDateTime(step);
    const fromNow = /\b(start\w*|begin\w*|from)\s+(at\s+|from\s+)?(now|here|the current time|the simulated time)\b/.test(step);
    // "Real" now is the scrubber's "Now" button: the computer's clock, not the simulated time.
    const fromRealNow = /\b(real[- ]?time|real now|actual time|today|the real date|right now in the real world)\b/.test(step) && /\b(start\w*|begin\w*|from|at|now)\b/.test(step);
    const atLanding = /\b(start\w*|begin\w*|from|at|on)\s+(the\s+)?(landing|touchdown)\b/.test(step);
    const rest = dt ? step.replace(dt.match, ' ') : step;
    const d = /\b(window|length|duration|for|lasting|long)\b/.test(rest) ? findDuration(rest) : null;
    if (!dt && !fromNow && !fromRealNow && !atLanding && !d) return null;
    const params: Json = {};
    if (dt) params.startUtc = dt.utc;
    else if (atLanding) params.startUtc = 'landing';
    else if (fromRealNow) Object.assign(params, { startUtc: 'real-now', moveClock: true });
    else if (fromNow) params.startUtc = 'now';
    if (d && d.hours > 0) params.durationH = d.hours;
    return plan('set the mission window', async (ctx) => {
      const r = await ctx.run('setMissionWindow', params);
      return `Mission window: starts ${utc(str(r, 'windowStartUtc'))} and lasts ${hours(num(r, 'windowDurationH'))}${num(r, 'delayH') ? `, with an arrival delay of ${hours(num(r, 'delayH'))}` : ''}.`;
    });
  }

  const slope = /^(?:set |use |change )?(?:the )?(?:(?:max(?:imum)?|allowed|acceptable) slope|slope (?:limit|threshold|max(?:imum)?))\s*(?:to|of|=|at|is|under|below)?\s*(\d+(?:\.\d+)?)(?: deg(?:rees?)?)?$/.exec(step);
  if (slope) {
    const degreesValue = Number(slope[1]);
    return plan(`set the slope limit to ${degreesValue}°`, async (ctx) => {
      const r = await ctx.run('setSlopeLimit', { degrees: degreesValue });
      return `Slope limit for nearby alternatives set to ${degrees(num(r, 'slopeLimitDeg'))}.`;
    });
  }

  if (/\bearth([- ]visibility)? gap\b/.test(step) && /^(set|limit|allow|require|tolerate|max|maximum|no|remove|clear|drop|any)\b/.test(step)) {
    const none = /^(no|remove|clear|drop|any)\b/.test(step);
    const d = none ? null : findDuration(step);
    if (!none && !d) return null;
    return plan(none ? 'remove the Earth-gap requirement' : `set the largest tolerated Earth gap to ${hours(d!.hours)}`, async (ctx) => {
      const r = await ctx.run('setMaxEarthGap', none ? {} : { hours: d!.hours });
      const h = num(r, 'maxEarthGapH');
      return h === undefined ? 'The Earth-gap requirement is removed.' : `Largest tolerated gap with Earth's centre hidden set to ${hours(h)}.`;
    });
  }

  if (/\b(sun|solar)\b.*\b(elevation|band|angle|requirement)\b|<\s*(a|alpha|el|elevation)\s*</.test(step) && !/^(what|how|why|is|does|where)\b/.test(step) && !/\b(overlay|map|show|hide)\b/.test(step)) {
    const values = findNumbers(step);
    if (values.length !== 2) return null;
    const [minDeg, maxDeg] = [Math.min(values[0], values[1]), Math.max(values[0], values[1])];
    return plan(`require a solar elevation between ${minDeg}° and ${maxDeg}°`, async (ctx) => {
      const r = await ctx.run('setSunBand', { minDeg, maxDeg });
      return `Required solar elevation band set to ${degrees(num(r, 'sunElMinDeg'))} to ${degrees(num(r, 'sunElMaxDeg'))}.`;
    });
  }
  return null;
};

// ---------------------------------------------------------------- overlays, missions, lighting

const OVERLAY_NOTE: Record<string, string> = {
  off: 'Overlay hidden.',
  'sun-band': 'Overlay: where the Sun is inside the required elevation band at the simulated time (smooth Moon, terrain not included).',
  'avg-illumination': 'Overlay: average illumination, a published multi-year average for the polar regions. It is not the dated geometry of your mission window.',
  'avg-earth-visibility': 'Overlay: average Earth visibility, a published multi-year average for the polar regions. It is not the dated geometry of your mission window, and it is geometric line of sight only.',
};

const overlays: Intent = (step) => {
  const display = /^(show|display|turn on|enable|overlay|open|switch on|set (the )?overlay( to)?|colou?r|highlight|use)\b|\b(overlay|map|heat ?map|layer)$/.test(step);
  let mode: string | undefined;
  if (/^(hide|remove|clear|turn off|disable|no|switch off)\b.*\b(overlay|heat ?map|colou?rs?|map layer|layer)s?\b/.test(step) || /^overlay off$/.test(step)) mode = 'off';
  else if (!display) return null;
  else if (/\b(average|avg|mean|long[- ]term)\b.*\bearth\b|\bearth[- ]visibility\b/.test(step)) mode = 'avg-earth-visibility';
  else if (/\b(average|avg|mean|long[- ]term)\b.*\b(illumination|sunlight|sun|light)\b|\b(illumination|sunlight)\b/.test(step)) mode = 'avg-illumination';
  else if (/\b(sun[- ]?band|solar band|optimal landing|best landing|landing areas?|sun elevation|solar elevation)\b/.test(step)) mode = 'sun-band';
  if (!mode) return null;
  return plan(mode === 'off' ? 'hide the overlay' : `show the ${mode} overlay`, async (ctx) => {
    const r = await ctx.run('setOverlay', { mode });
    return OVERLAY_NOTE[str(r, 'overlay') ?? mode!] ?? `Overlay set to ${str(r, 'overlay')}.`;
  });
};

const missions: Intent = (step) => {
  const toggle = /^(show|display|hide|remove|turn on|turn off|enable|disable)\s+(?:the\s+|all\s+)?(?:previous |past |old |historic(?:al)? |earlier )?(?:missions?|landings?|landing sites|markers?)$/.exec(step);
  if (toggle) {
    const show = /show|display|on|enable/.test(toggle[1]);
    return plan(`${show ? 'show' : 'hide'} the previous missions`, async (ctx) => {
      const r = await ctx.run('showMissions', { show });
      return r.showMissions === true ? 'Previous landings are shown on the globe.' : 'Previous landings are hidden.';
    });
  }
  const filtered = (r: Json) => `Showing ${num(r, 'shown') ?? '?'} of ${num(r, 'total') ?? '?'} catalogued landings.`;
  if (/^(reset|clear|remove)\s+(the\s+|all\s+)?(mission\s+|landing\s+)?filters?$/.test(step) || /^show (all|every) (missions?|landings?)$/.test(step)) {
    return plan('show every catalogued landing', async (ctx) => filtered(await ctx.run('setFilters', { reset: true })));
  }
  const only = /^(?:show\s+)?(?:only|just)\s+(?:the\s+)?(.+?)$/.exec(step) ?? /^(?:filter|limit|restrict)\s+(?:the\s+)?(?:missions?|landings?)?\s*(?:to|by)\s+(.+)$/.exec(step) ?? /^(?:missions?|landings?)\s+(from .+|after .+|before .+|since .+|in \d{4}.*)$/.exec(step);
  if (!only) return null;
  const what = only[1].replace(/\s+(missions?|landings?|sites?|programs?|programmes?)$/, '').trim();
  const params: Json = { reset: true };
  const years = findNumbers(what).filter((y) => y >= 1950 && y <= 2100);
  if (/^(crewed|manned|human)$/.test(what)) params.type = 'crewed';
  else if (/^(robotic|uncrewed|unmanned|robot)$/.test(what)) params.type = 'robotic';
  else if (/^(from|between)\b/.test(what) && years.length === 2) Object.assign(params, { fromYear: Math.min(...years), toYear: Math.max(...years) });
  else if (/^(after|since|from)\b/.test(what) && years.length === 1) params.fromYear = years[0];
  else if (/^(before|until|up to)\b/.test(what) && years.length === 1) params.toYear = years[0];
  else if (/^in\b/.test(what) && years.length === 1) Object.assign(params, { fromYear: years[0], toYear: years[0] });
  else if (years.length || !what) return null;
  else {
    const names = what.split(/\s*(?:,|\band\b|&)\s*/).map((n) => n.trim()).filter(Boolean);
    return plan(`show only ${names.join(', ')} landings`, async (ctx) => {
      // The names may be programs or countries: the action knows which exist, and says so when neither fits.
      const byProgram = await ctx.api.run('setFilters', { reset: true, programs: names });
      if (byProgram.ok && isObject(byProgram.result)) return filtered(byProgram.result);
      const byCountry = await ctx.api.run('setFilters', { reset: true, countries: names });
      if (byCountry.ok && isObject(byCountry.result)) return filtered(byCountry.result);
      throw new Halt(`${byProgram.ok ? '' : byProgram.error} ${byCountry.ok ? '' : byCountry.error}`.trim());
    });
  }
  return plan('filter the catalogued landings', async (ctx) => filtered(await ctx.run('setFilters', params)));
};

const lighting: Intent = (step) => {
  if (/^(what|how|why|is|does|where)\b/.test(step)) return null;
  const even = /\b(even|flat|uniform|full)\s+(sun)?(light|lighting|illumination)\b|\blight everything\b/.test(step);
  const real = /\b(real|true|actual|realistic|natural)\s*(sun)?(light|lighting|illumination)\b/.test(step);
  if (even !== real) {
    return plan(even ? 'light the Moon evenly' : 'use the real sunlight', async (ctx) => {
      const r = await ctx.run('setLightMode', { mode: even ? 'even' : 'real' });
      return r.lightMode === 'even' ? 'Even lighting is on: every site is lit for readability. This is not the real sunlight, and the clock is paused.' : "The Moon is lit from the Sun's true direction at the simulated time.";
    });
  }
  const detail = /^(show|hide|turn on|turn off|enable|disable)\s+(?:the\s+)?(?:generated |synthetic |artificial )?(?:details?|rocks|boulders)$/.exec(step);
  if (detail) {
    const on = /show|on|enable/.test(detail[1]);
    return plan(`${on ? 'show' : 'hide'} generated surface detail`, async (ctx) => {
      const r = await ctx.run('setGeneratedDetail', { on });
      return r.generatedDetail === true ? 'Generated detail (rocks, sub-metre texture) is shown. It is not measured data.' : 'Generated detail is hidden: only measured terrain is shown.';
    });
  }
  return null;
};

// ---------------------------------------------------------------- views and cameras

const SURFACE = '(?:the\\s+)?(?:lunar\\s+)?(?:surface|ground|street)(?:[- ]?level)?(?:\\s+view)?';

const views: Intent = (step) => {
  if (new RegExp(`^(?:enter|open|show|switch to|go (?:down )?to|drop (?:down )?(?:to|into|onto)|step (?:down )?(?:to|into|onto|on)|stand on|land on|descend to|walk on|view from|see|put me on|get me (?:on|to))\\s+${SURFACE}(?:\\s+(?:here|there|at (?:the|this) (?:site|pin)))?$`).test(step) || /^(surface|street|ground)([- ]level)? view$/.test(step) || /^(land|stand|go down|step down|descend|drop down) (here|there)$/.test(step)) {
    return plan('enter the surface view', async (ctx) => {
      const r = await ctx.run('enterSurface');
      return `You are standing on the surface at ${siteText(r.site)}.`;
    });
  }
  if (/^(back|return|go back|switch|go|zoom out|exit|up)\s+to\s+(the\s+)?(globe|orbit|globe view|moon view|map)$/.test(step) || new RegExp(`^(?:exit|leave|close|quit)\\s+${SURFACE}$`).test(step) || /^(globe|globe view|orbit view)$/.test(step)) {
    return plan('return to the globe', async (ctx) => {
      const r = await ctx.run('exitSurface');
      return `Back on the globe${r.site ? `, with ${str(r, 'site.name') ?? 'the site'} still selected` : ''}.`;
    });
  }
  const panel = /^(show|open|unfold|expand|hide|close|fold|collapse)\s+(?:the\s+)?(site (?:details|card)|details|filters?(?: panel| sheet)?|site science section|science section)$/.exec(step) ?? /^(unfold|expand|hide|close|fold|collapse)\s+(?:the\s+)?(site science)$/.exec(step);
  if (panel) {
    const open = /show|open|unfold|expand/.test(panel[1]);
    const which = panel[2].startsWith('filter') ? 'filters' : /science/.test(panel[2]) ? 'site-science' : 'site-details';
    return plan(`${open ? 'open' : 'close'} the ${which === 'filters' ? 'filters panel' : 'site details'}`, async (ctx) => {
      const r = await ctx.run('showPanel', { panel: which, open });
      const name = which === 'filters' ? 'The filters panel' : which === 'site-science' ? 'The site science section' : 'The site details';
      return `${name} ${r.open === true ? 'are open' : 'are folded away'}.`.replace(/(panel|section) are/, '$1 is');
    });
  }
  if (/^(clear|remove|delete|deselect|unselect|forget)\s+(the\s+|this\s+|my\s+)?(site|pin|selection|marker)$/.test(step) || /^(deselect|unselect)$/.test(step)) {
    return plan('clear the selected site', async (ctx) => {
      await ctx.run('clearSite');
      return 'The site is deselected and the whole Moon is shown.';
    });
  }
  return null;
};

/** The field-of-view range an action accepts, from its own schema. */
/**
 * The point the globe view is on: where it was last asked to centre (getState
 * globeDisplay.viewTarget, exactly as asked, also while the camera is still flying there), else
 * the centre drawn now (globeCenter: mid-flight a point on the way, and over a pole 0.1° short).
 * viewTarget is null once the globe was turned by hand; the drawn centre is then the view.
 */
function viewPoint(s: Json): { lat?: number; lon?: number } {
  const t = at(s, 'globeDisplay.viewTarget');
  if (isObject(t) && num(t, 'latDeg') !== undefined && num(t, 'lonDegEast') !== undefined) return { lat: num(t, 'latDeg'), lon: num(t, 'lonDegEast') };
  return { lat: num(s, 'globeCenter.latDeg'), lon: num(s, 'globeCenter.lonDegEast') };
}

function fovRange(ctx: Ctx, action: string): [number, number] {
  const p = ctx.api.def(action)?.params.properties.fovDeg;
  return [p && 'minimum' in p && typeof p.minimum === 'number' ? p.minimum : 20, p && 'maximum' in p && typeof p.maximum === 'number' ? p.maximum : 90];
}

const look: Intent = (step) => {
  const dir = new RegExp(`^(?:look|face|turn|point|pan|rotate)\\s+(?:due\\s+)?(?:(?:to|toward|towards|at)\\s+)?(?:the\\s+)?${COMPASS_WORD}$`).exec(step);
  if (dir) {
    const azDeg = compassAzimuth(dir[1]);
    if (azDeg === null) return null;
    return plan(`look ${dir[1]}`, async (ctx) => {
      const r = await ctx.run('lookAt', { azDeg });
      return `Looking towards azimuth ${degrees(num(r, 'look.azDeg') ?? azDeg)} (${dir[1]}).`;
    });
  }
  const az = /^(?:look|face|turn|point|pan|rotate)\b.*?\baz(?:imuth)?\s*(?:of|=|to)?\s*(-?\d+(?:\.\d+)?)(?:.*?\bel(?:evation)?\s*(?:of|=|to)?\s*(-?\d+(?:\.\d+)?))?/.exec(step);
  if (az) {
    const params: Json = { azDeg: Number(az[1]), ...(az[2] !== undefined ? { elDeg: Number(az[2]) } : {}) };
    return plan(`look towards azimuth ${az[1]}°`, async (ctx) => {
      const r = await ctx.run('lookAt', params);
      return `Looking towards azimuth ${degrees(num(r, 'look.azDeg'))}, elevation ${degrees(num(r, 'look.elDeg'))}.`;
    });
  }
  const body = /^(?:look|face|turn|point)\s+(?:(?:at|to|toward|towards)\s+)?(?:the\s+)?(sun|earth)$/.exec(step) ?? /^show (?:me )?(?:the\s+)?(sun|earth)$/.exec(step) ?? /^find (?:the\s+)?(sun|earth)$/.exec(step);
  if (body) {
    const which = body[1];
    const name = which === 'sun' ? 'the Sun' : 'Earth';
    return plan(`look at ${name}`, async (ctx) => {
      if (ctx.has('lookAtBody')) {
        const st = await ctx.state();
        if (str(st, 'view') !== 'surface') await ctx.run('enterSurface');
        const outcome = await ctx.api.run('lookAtBody', { body: which });
        if (outcome.ok && isObject(outcome.result)) {
          const r = outcome.result;
          let clearance: number | undefined;
          if (ctx.has('getAnalysis')) clearance = num(await ctx.analysis(), `now.${which}.clearanceDeg`);
          const below = r.belowHorizontal === true ? ' It is below the horizontal, so the view looks at the horizon at its azimuth.' : '';
          return `Facing ${name}: azimuth ${degrees(num(r, 'azDeg'))}, elevation ${degrees(num(r, 'elDeg'))}${clearance !== undefined ? `, its centre ${degrees(Math.abs(clearance), 2)} ${clearance >= 0 ? 'above' : 'below'} the terrain skyline` : ''}.${below}${which === 'earth' ? ` ${EARTH_NOTE}` : ''}`;
        }
        // The sky can be a moment behind a site that has just been entered: fall back to the analysis readout below.
        if (!ctx.has('getAnalysis')) throw new Halt(outcome.ok ? `Could not face ${name}.` : outcome.error);
      }
      if (!ctx.has('getAnalysis')) throw new Halt(`Turning to ${name} needs its direction from the site analysis, which this build does not expose to me. Its azimuth and elevation are shown in the key metrics; you can say "look at azimuth <number>".`);
      const a = await ctx.analysis();
      const azDeg = num(a, `now.${which}.azDeg`), elDeg = num(a, `now.${which}.elDeg`);
      if (azDeg === undefined || elDeg === undefined) throw new Halt(`The analysis does not report where ${name} is at the simulated time.`);
      const st = await ctx.state();
      if (str(st, 'view') !== 'surface') await ctx.run('enterSurface');
      await ctx.run('lookAt', { azDeg, elDeg: Math.max(-85, Math.min(85, elDeg)) });
      const clearance = num(a, `now.${which}.clearanceDeg`);
      return `Looking at ${name}: azimuth ${degrees(azDeg)}, elevation ${degrees(elDeg)}${clearance !== undefined ? `, its centre ${degrees(Math.abs(clearance), 2)} ${clearance >= 0 ? 'above' : 'below'} the terrain skyline` : ''}.${which === 'earth' ? ` ${EARTH_NOTE}` : ''}`;
    });
  }
  const rel = /^(?:look|turn|pan|rotate|face)\s+(left|right|up|down|around|back|behind)$/.exec(step) ?? /^(turn around)$/.exec(step);
  if (rel) {
    const word = rel[1] === 'turn around' ? 'around' : rel[1];
    return plan(`look ${word}`, async (ctx) => {
      const s = await ctx.state();
      const azNow = num(s, 'look.azDeg'), elNow = num(s, 'look.elDeg');
      if (azNow === undefined || elNow === undefined) throw new Halt('Looking around works in the surface view. Enter the surface view first.');
      const azDeg = word === 'left' ? azNow - 45 : word === 'right' ? azNow + 45 : word === 'up' || word === 'down' ? azNow : azNow + 180;
      const elDeg = Math.max(-85, Math.min(85, word === 'up' ? elNow + 15 : word === 'down' ? elNow - 15 : elNow));
      const r = await ctx.run('lookAt', { azDeg: ((azDeg % 360) + 360) % 360, elDeg });
      return `Looking towards azimuth ${degrees(num(r, 'look.azDeg'))}, elevation ${degrees(num(r, 'look.elDeg'))}.`;
    });
  }
  const zoom = /^zoom (in|out)$/.exec(step);
  if (zoom) {
    const inward = zoom[1] === 'in';
    return plan(`zoom ${zoom[1]}`, async (ctx) => {
      const s = await ctx.state();
      if (str(s, 'view') === 'surface') {
        const fov = num(s, 'look.fovDeg'), azDeg = num(s, 'look.azDeg');
        if (fov === undefined || azDeg === undefined) throw new Halt('The current field of view is not available.');
        const want = inward ? fov * 0.7 : fov / 0.7;
        // The surface scene's own zoom (the same as scrolling); older builds only had lookAt.
        const action = ctx.has('setFieldOfView') ? 'setFieldOfView' : 'lookAt';
        const [min, max] = fovRange(ctx, action);
        const fovDeg = Math.round(Math.max(min, Math.min(max, want)) * 10) / 10;
        const r = await ctx.run(action, action === 'setFieldOfView' ? { fovDeg } : { azDeg, fovDeg });
        return `Field of view: ${degrees(num(r, 'look.fovDeg'))}.`;
      }
      const { lat, lon } = viewPoint(s);
      const alt = num(s, 'globeCenter.altitudeKm');
      if (lat === undefined || lon === undefined || alt === undefined) throw new Halt('The current globe camera is not available.');
      const altitudeKm = Math.max(10, Math.min(8 * MOON_RADIUS_KM, inward ? alt / 2 : alt * 2));
      await ctx.run('setGlobeCamera', { lat, lon, altitudeKm });
      return `Globe camera moving to ${Math.round(altitudeKm)} km above the surface.`;
    });
  }
  return null;
};

const globe: Intent = (step) => {
  if (/^(show|see|view|display|zoom out to|back to|go to)?\s*(the\s+)?(whole|entire|full) (moon|globe)$/.test(step) || /^zoom (all the way|fully) out$/.test(step)) {
    return plan('show the whole Moon', async (ctx) => {
      const { lat, lon } = viewPoint(await ctx.state());
      await ctx.run('setGlobeCamera', { lat: lat ?? 0, lon: lon ?? 0, altitudeKm: WHOLE_MOON_ALTITUDE_KM });
      return 'Showing the whole Moon.';
    });
  }
  const place = /^(?:show|see|view|go to|fly to|turn to|rotate to|look at|zoom to|centre on|center on)\s+(?:the\s+)?(?:lunar\s+)?(north pole|south pole|near side|nearside|far side|farside)$/.exec(step);
  if (place) {
    const target = { 'north pole': [90, 0], 'south pole': [-90, 0], 'near side': [0, 0], nearside: [0, 0], 'far side': [0, 180], farside: [0, 180] }[place[1]] as [number, number];
    return plan(`turn the globe to the ${place[1]}`, async (ctx) => {
      await ctx.run('setGlobeCamera', { lat: target[0], lon: target[1] });
      return `The globe is turning to the ${place[1]} (${coordinates(target[0], target[1])}).`;
    });
  }
  if (/^(north up|reset north|point north up|reset (the )?compass|compass)$/.test(step)) {
    return plan('put lunar north up', async (ctx) => {
      await ctx.run('resetNorth');
      return 'Lunar north now points up on screen.';
    });
  }
  const locator = /\b(locator|viewfinder|mini|overview)\s*map\b.*?(\d+(?:\.\d+)?)/.exec(step);
  if (locator) {
    return plan(`zoom the locator map to ${locator[2]}x`, async (ctx) => {
      const r = await ctx.run('setLocatorZoom', { zoom: Number(locator[2]) });
      return `Locator map zoom: ${num(r, 'locatorZoom') ?? locator[2]}x.`;
    });
  }
  const c = findCoordinates(step);
  if (c && /^(turn|rotate|spin|centre|center|point|aim)\b/.test(step)) {
    const altitude = /\b(?:altitude|height|from)\s+(?:of\s+)?(\d+(?:\.\d+)?)\s*km\b/.exec(step);
    return plan(`turn the globe to ${coordinates(c.lat, c.lon)}`, async (ctx) => {
      await ctx.run('setGlobeCamera', { lat: c.lat, lon: c.lon, ...(altitude ? { altitudeKm: Number(altitude[1]) } : {}) });
      return `The globe is turning to ${coordinates(c.lat, c.lon)}${altitude ? `, ${altitude[1]} km above the surface` : ''}. No pin was dropped.`;
    });
  }
  return null;
};

const PIN_FILLER = /^(?:(?:drop|put|place|set|add)\s+(?:a\s+|the\s+|my\s+)?pin\s*(?:at|on|to)?|pin|mark|(?:go|fly|travel|navigate|move|jump|head|take me)\s+to|select|open|show(?: me)?|land (?:at|on)|site at|at)?\s*(?:the\s+)?(?:coordinates?|position|point|location)?\s*(?:of)?$/;

const pin: Intent = (step) => {
  const c = findCoordinates(step);
  if (!c) return null;
  const surface = /\s+(?:(?:and|then)\s+)?(?:on|from|at|in)\s+(?:the\s+)?surface(?:\s+view)?$/.test(step);
  const rest = step.replace(c.match, ' ').replace(/\s+(?:(?:and|then)\s+)?(?:on|from|at|in)\s+(?:the\s+)?surface(?:\s+view)?$/, '').replace(/\s+/g, ' ').trim();
  if (!PIN_FILLER.test(rest)) return null;
  return plan(`drop a pin at ${coordinates(c.lat, c.lon)}`, async (ctx) => {
    const r = await ctx.run('dropPin', { lat: c.lat, lon: c.lon, fly: true });
    const lines = [`Dropped a pin at ${coordinates(num(r, 'site.latDeg') ?? c.lat, num(r, 'site.lonDegEast') ?? c.lon)} and flew there.`];
    if (surface) {
      await ctx.run('enterSurface');
      lines.push('You are standing on the surface there.');
    }
    return lines.join(' ');
  });
};

const exportResults: Intent = (step) => {
  if (!/^(export|download|save)\b.*\b(csv|json|results?|table|data|intervals?)\b/.test(step)) return null;
  const format = /\bjson\b/.test(step) ? 'json' : 'csv';
  return plan(`export the results as ${format.toUpperCase()}`, async (ctx) => {
    const r = await ctx.run('exportResults', { format });
    const size = num(r, 'bytes'), spells = num(r, 'spells');
    return `Downloaded the mission-window results as ${format.toUpperCase()}${str(r, 'filename') ? `: ${str(r, 'filename')}` : ''}${size !== undefined ? ` (${size} bytes${spells !== undefined ? `, ${plural(spells, 'spell')}` : ''})` : ''}.`;
  });
};

// ---------------------------------------------------------------- questions

const questions: Intent = (step) => {
  if (/^(what('s| is) the (time|date)|what time is it|current time|time|date|when is it|what day is it)( now)?$/.test(step)) {
    return plan('say the simulated time', async (ctx) => {
      const s = await ctx.state();
      return `The simulated time is ${utc(str(s, 'timeUtc'))}${s.playing === true ? ', and the clock is running' : ', and the clock is paused'}.`;
    });
  }
  if (/^(where am i|where are we|what('s| is) (selected|shown|on screen|the (current )?(site|pin|state|status|view))|which site( is (this|selected))?|status|state|current (site|state|status)|summary|what is this( site| place)?)$/.test(step)) {
    return plan('describe what is on screen', async (ctx) => stateText(await ctx.state()));
  }
  const body = /\b(sun|earth)\b/.exec(step);
  if (body && /\b(where|position|elevation|azimuth|up|visible|above|below|clearance|angle|high|risen|see)\b/.test(step) && /^(where|what|is|can|how|does|tell|give|show|sun|earth|the)\b/.test(step)) {
    const which = body[1];
    const name = which === 'sun' ? "The Sun's centre" : "Earth's centre";
    return plan(`say where ${which === 'sun' ? 'the Sun' : 'Earth'} is`, async (ctx) => {
      if (!ctx.has('getAnalysis')) throw new Halt(`${name}'s azimuth, elevation and clearance are shown in the key metrics of the surface view. Reading them out here needs the analysis readout, which this build does not expose to me.`);
      const a = await ctx.analysis();
      const azDeg = num(a, `now.${which}.azDeg`), elDeg = num(a, `now.${which}.elDeg`), clearance = num(a, `now.${which}.clearanceDeg`);
      if (azDeg === undefined || elDeg === undefined) throw new Halt(`The analysis does not report where ${name} is at the simulated time.`);
      const t = str(a, 'now.timeUtc');
      return `${name}${t ? ` at ${utc(t)}` : ''}: azimuth ${degrees(azDeg)}, elevation ${degrees(elDeg)}${clearance !== undefined ? `, ${degrees(Math.abs(clearance), 2)} ${clearance >= 0 ? 'above' : 'below'} the terrain skyline (${clearance >= 0 ? 'visible' : 'hidden'})` : ''}.${which === 'earth' ? ` ${EARTH_NOTE}` : ''}`;
    });
  }
  if (/\b(illumination|sunlight|sunlit|how much sun|darkness|blackout|night|earth (visibility|gap|contact|line of sight)|slope|steep|metrics|analysis|numbers|results|viable|viability|how (good|flat|sunny))\b/.test(step) && /^(what|how|is|show|tell|give|list|report|metrics|analysis|results|numbers|illumination|slope|darkness|and)\b/.test(step)) {
    return plan('report the analysis of the current scenario', async (ctx) => {
      const a = await ctx.analysis();
      const s = await ctx.state();
      const lines = [`${str(s, 'site.name') ?? 'The selected site'}, mission window from ${utc(str(s, 'missionWindow.startUtc'))} for ${hours(num(s, 'missionWindow.durationH'))}, mast ${num(s, 'mastHeightM') ?? 'unavailable'} m:`, `${metricsText(a)}.`];
      // Requirements the user set, when the analysis checked them and they are not met.
      const band = at(a, 'requirements.sunElevationBand');
      if (isObject(band)) {
        const lo = num(band, 'windowMinSunElDeg'), hi = num(band, 'windowMaxSunElDeg');
        // The default 0 to 90 deg is no requirement (finding Q-5). From T-46 the core says so itself
        // (`required: false`, with a `note`); before it, it reported that default band as left
        // whenever the Sun went below the horizontal, so the band's values decide there.
        const unset = band.required === false || (band.required === undefined && defaultSunBand(band));
        if (unset) {
          const range = lo !== undefined && hi !== undefined ? ` The Sun's elevation ranges from ${degrees(lo)} to ${degrees(hi)} during the window${lo < 0 ? ', so it goes below the horizontal' : ''}.` : '';
          lines.push(`${str(band, 'note') ?? 'No solar elevation band is set (the Filters default, 0° to 90°, means no requirement).'}${range}`);
        } else if (band.metForWholeWindow === false) {
          lines.push(`The Sun leaves the required elevation band (${degrees(num(band, 'minDeg'))} to ${degrees(num(band, 'maxDeg'))}) during the window: it ranges from ${degrees(lo)} to ${degrees(hi)}.`);
        }
      }
      const gap = at(a, 'requirements.maxEarthGap');
      if (isObject(gap) && gap.met === false) lines.push(`The longest Earth-centre gap (${hours(num(gap, 'longestEarthGapH'))}) is longer than the tolerated ${hours(num(gap, 'limitH'))}.`);
      const dem = at(a, 'provenance.elevationData');
      if (Array.isArray(dem) && dem.some(isObject)) {
        lines.push(`Elevation data, finest first: ${dem.filter(isObject).slice(0, 3).map((d) => `${str(d, 'name') ?? 'unnamed'} (${num(d, 'resolutionM') ?? '?'} m)`).join('; ')}.`);
      }
      const notes = warningsText(a).trim();
      if (notes) lines.push(notes);
      lines.push(EARTH_NOTE);
      return lines.join('\n');
    });
  }
  return null;
};

// ---------------------------------------------------------------- sites (last: the most general pattern)

const SURFACE_TAIL = /\s+(?:(?:and|then)\s+)?(?:on|from|at|in)\s+(?:the\s+)?surface(?:\s+view)?$/;
const LANDING_TAIL = /\s+(?:at|on|for|during)\s+(?:its\s+|the\s+)?(?:landing|touchdown)(?:\s+(?:time|date|day))?$/;

const site: Intent = (step) => {
  const m = /^(?:(?:go|fly|travel|navigate|move|jump|head|take me|bring me|zoom)\s+to|visit|select|open|pick|choose|show(?: me)?|find|see|view|land (?:at|on))\s+(?:the\s+)?(?:(?:landing\s+)?site\s+(?:of\s+)?)?(.+)$/.exec(step);
  if (!m) return null;
  let name = m[1].trim();
  // "... at landing" and "... on the surface" may follow the name, in either order.
  let surface = /^land (at|on)\b/.test(step);
  let atLanding = false;
  for (let i = 0; i < 2; i++) {
    if (SURFACE_TAIL.test(name)) {
      surface = true;
      name = name.replace(SURFACE_TAIL, '');
    }
    if (LANDING_TAIL.test(name)) {
      atLanding = true;
      name = name.replace(LANDING_TAIL, '');
    }
  }
  name = name.replace(/\s+(?:landing\s+)?site$/, '').trim();
  if (!name || name.length > 60) return null;
  return plan(`select the site "${name}"${atLanding ? ' at its landing time' : ''}${surface ? ' and enter the surface view' : ''}`, async (ctx) => {
    if (atLanding && !('atLanding' in (ctx.api.def('selectSite')?.params.properties ?? {}))) {
      throw new Halt('This build cannot go to a landing and its date in one step. Select the site, then set the time yourself.');
    }
    const r = await ctx.run('selectSite', { site: name, ...(atLanding ? { atLanding: true } : {}), ...(surface ? { surface: true } : {}) });
    const when = atLanding && str(r, 'timeUtc') ? ` The clock and the mission window start at touchdown, ${utc(str(r, 'timeUtc'))}.` : '';
    return `Selected ${siteText(r.site)}.${when}${r.view === 'surface' ? ' You are standing on the surface there.' : ' The globe is flying there.'}`;
  });
};

// Order matters: the first match wins. The science queries sit early because their words
// ("ice near here", "average sunlight here") would otherwise read as a nearby scan or as the
// mission-window metrics; walking sits before the clock commands, whose "m" means minutes.
const INTENTS: Intent[] = [
  help, listAll, rawCall, assistantUi,
  later.iceNearest, later.siteScience,
  compareFamily, later.comparePanel, nearby, pickCandidate, blockage, events, delay, clock, mission,
  later.walk,
  timeShift, timeSet,
  later.territory, later.relief, later.coverage, later.iceOutlines,
  overlays, missions, lighting,
  later.skyPaths, later.surfacePanels, later.hudPanels,
  views,
  later.fieldOfView,
  later.tracking, look, globe, pin, exportResults,
  later.surfaceStatus, later.listSites, later.outlook, later.presets, later.flags,
  later.siteRecords, later.realClock,
  questions, site,
];

/** The plan for one step of a request, or null when no intent matches it. */
export function matchIntent(step: string, raw: string): Plan | null {
  for (const intent of INTENTS) {
    const p = intent(step, raw);
    if (p) return p;
  }
  return null;
}
