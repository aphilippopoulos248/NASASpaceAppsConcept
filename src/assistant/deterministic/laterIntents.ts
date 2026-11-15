// Commands for the actions the app gained after the first grammar (intents.ts): how the globe
// is drawn (relief, elevation-data coverage, ice-target outlines), the site-science readouts
// (Deep Space Network stations, long-term averages, mapped ice targets, Diviner annual
// temperatures, ShadowCam mosaics), the surface view (field of view, walking, sky paths, what
// the view is built from), the landing catalogue and the compare panel (saved comparisons,
// swapping and emptying the slots, its tabs).
//
// Same rules as intents.ts: an intent matches one step; its plan runs registered actions only,
// through ctx.run, so a build without the action says so instead of approximating it; and
// every number in a reply is read from an action result. Where the app's result carries its
// own sentence (a caveat, a source, an explanation), the reply uses that sentence.
import { Halt } from './context';
import { at, bearing, coordinates, degrees, distance, isObject, num, percent, plural, span, str, utc, UNAVAILABLE, type Json } from './format';
import { compassAzimuth } from './parse';
import { EARTH_NOTE, plan, siteText, type Intent } from './plan';

const QUESTION = /^(what|how|why|is|are|does|do|which|when|where|can)\b/;
const SHOW = /^(show|display|turn on|enable|outline|draw|mark|add)\b/;
const HIDE = /^(hide|remove|turn off|disable|clear)\b/;
const HERE = /\b(here|at (this|the) (site|pin|spot|place)|for (this|the) (site|pin))$/;

/** The bounds a parameter of an action accepts, read from its schema (so a reply never asks for more than the action takes). */
function bounds(ctx: { api: { def(name: string): { params: { properties: Record<string, unknown> } } | undefined } }, action: string, param: string, fallback: [number, number]): [number, number] {
  const p = ctx.api.def(action)?.params.properties[param];
  const min = isObject(p) && typeof p.minimum === 'number' ? p.minimum : fallback[0];
  const max = isObject(p) && typeof p.maximum === 'number' ? p.maximum : fallback[1];
  return [min, max];
}

const clamp = (v: number, [min, max]: [number, number]) => Math.max(min, Math.min(max, v));
const round1 = (v: number) => Math.round(v * 10) / 10;

// ---------------------------------------------------------------- how the globe is drawn

/**
 * Words about the landings' areas and territories. Since T-67 there is no territory size setting
 * (the whole Moon is coloured by the country of the nearest landing shown, with showMissions), so
 * these words only keep a request like "territory size exaggeration 25" from being read as the relief.
 */
const TERRITORY = /\b(territor(?:y|ies)|explored areas?|landing areas?)\b/;

export const relief: Intent = (step) => {
  const about = /\b(relief|exaggerat\w*)\b/.test(step) || /\bsmooth (sphere|globe|moon)\b/.test(step);
  if (!about || QUESTION.test(step) || TERRITORY.test(step)) return null;
  let factor: number | undefined;
  if (/\b(true|real)[- ]scale\b|\bno exaggeration\b|\bexaggerat\w*\b.*\b(off|none)\b|^(remove|turn off|disable|stop|undo)\b.*\bexaggerat/.test(step)) factor = 1;
  else if (/\bsmooth (sphere|globe|moon)\b|\bno relief\b|\brelief\b.*\b(off|none)\b|^(hide|remove|turn off|disable|flatten)\b.*\brelief\b/.test(step)) factor = 0;
  else {
    const n = /(?:\b(?:times|factor(?: of)?|to|by|at)\s*|[x×=]\s*)(\d+(?:\.\d+)?)\b/.exec(step) ?? /\b(\d+(?:\.\d+)?)\s*(?:[x×]|times)(?=\s|$)/.exec(step) ?? /\b(?:relief|exaggeration)\s+(\d+(?:\.\d+)?)$/.exec(step);
    if (n) factor = Number(n[1]);
  }
  if (factor === undefined) return null;
  const f = factor;
  return plan(f === 0 ? 'turn the globe relief off' : f === 1 ? 'draw the globe relief at true scale' : `exaggerate the globe relief ×${f}`, async (ctx) => {
    const r = await ctx.run('setReliefExaggeration', { factor: f });
    const chosen = num(r, 'reliefExaggeration') ?? f;
    if (chosen === 0) return 'Relief is off: the globe is drawn as a smooth sphere. The analysis never uses the drawn relief.';
    if (chosen === 1) return 'Relief is drawn at true scale (×1).';
    const drawn = num(r, 'reliefDrawnNow');
    const rule = str(r, 'reliefRule');
    return `Relief exaggeration set to ×${chosen}${drawn !== undefined ? `; drawn at ×${drawn} at the present camera altitude` : ''}.${rule ? ` ${rule}` : ''} The analysis never uses the exaggeration.`;
  });
};

export const coverage: Intent = (step) => {
  const m =
    /^(show|display|turn on|enable|outline|draw|hide|remove|turn off|disable)\s+(?:the\s+)?(?:(?:elevation|terrain|dem|lola)\s+)?(?:data\s+)?coverage(?:\s+(?:outlines?|map|squares?|areas?))?$/.exec(step) ??
    /^(?:(?:elevation|terrain|dem)\s+)?(?:data\s+)?coverage\s+(on|off)$/.exec(step) ??
    /^(show|hide)\s+where\s+(?:the\s+)?elevation data (?:is|exists)$/.exec(step);
  if (!m) return null;
  const show = !/hide|remove|off|disable/.test(m[1]);
  return plan(`${show ? 'show' : 'hide'} the elevation-data coverage outlines`, async (ctx) => {
    const r = await ctx.run('showCoverage', { show });
    return r.coverageShown === true
      ? 'The globe now outlines where each class of elevation data exists: the bundled south-polar grids and the windows around the catalogued landing sites (the legend under Filters names them).'
      : 'The elevation-data coverage outlines are hidden.';
  });
};

export const iceOutlines: Intent = (step) => {
  const m = /^(show|display|turn on|enable|outline|draw|mark|hide|remove|turn off|disable)\s+(?:the\s+)?(?:mapped\s+)?(?:water[- ])?ice(?:[- ]bearing)?(?:\s+(?:targets?|outlines?|regions?|deposits?|areas?|layer|psrs?))*(?:\s+on the globe)?$/.exec(step);
  if (!m) return null;
  const show = !/hide|remove|off|disable/.test(m[1]);
  return plan(`${show ? 'outline' : 'hide'} the mapped ice targets on the globe`, async (ctx) => {
    const r = await ctx.run('showIceTargets', { show });
    return r.iceTargetsShown === true
      ? 'Outlined the mapped ice-bearing permanently shaded regions on the globe (south polar region only: regions of interest, not confirmed deposits). Ask "nearest ice targets" for distances from the site.'
      : 'The ice-target outlines are hidden.';
  });
};

// ---------------------------------------------------------------- site science

function iceRow(t: Json): string {
  const km = num(t, 'distanceKm');
  const where = t.insideOutline === true ? 'inside its mapped outline' : `${str(t, 'distanceText') ?? (km === undefined ? UNAVAILABLE : distance(km * 1000))}, bearing ${bearing(num(t, 'bearingDeg'))}`;
  return `${str(t, 'label') ?? str(t, 'id') ?? 'unnamed region'}: ${where}`;
}

function iceText(r: unknown, heading: string): string {
  if (!isObject(r)) return `${heading}: not part of this result.`;
  if (r.available === false) return `${heading}: ${str(r, 'reason') ?? 'not available'}.`;
  const rows = (Array.isArray(r.nearest) ? r.nearest : []).filter(isObject);
  if (!rows.length) return `${heading}: ${str(r, 'note') ?? 'none listed nearby.'}`;
  const lines = [`${heading}:`, ...rows.map((t, i) => `${i + 1}. ${iceRow(t)}.`)];
  for (const k of ['distanceMeaning', 'whatTheseAre'] as const) if (str(r, k)) lines.push(str(r, k)!);
  if (str(r, 'credit')) lines.push(`Source: ${str(r, 'credit')}`);
  return lines.join('\n');
}

export const iceNearest: Intent = (step) => {
  if (!/\bice\b/.test(step) || /^(compare|rank)\b/.test(step)) return null;
  if (!/\b(nearest|closest|how far|distances?|near (here|this|the site|the pin|me|it)|nearby|close by|around here|within)\b/.test(step)) return null;
  const count = /\b(\d+)\s+(?:nearest|closest)\b/.exec(step) ?? /\b(?:nearest|closest)\s+(\d+)\b/.exec(step);
  const within = /\bwithin\s+(\d+(?:\.\d+)?)\s*km\b/.exec(step);
  const params: Json = { ...(count && { count: Number(count[1]) }), ...(within && { maxKm: Number(within[1]) }) };
  return plan('list the nearest mapped ice targets', async (ctx) => {
    const r = await ctx.run('nearestIceTargets', params);
    if (r.available === false) throw new Halt(str(r, 'reason') ?? 'The mapped ice targets are not available.');
    return iceText(r, `Nearest mapped ice targets from ${coordinates(num(r, 'from.latDeg'), num(r, 'from.lonDegEast'))}`);
  });
};

function contactText(c: unknown): string {
  const pct = num(c, 'pctOfWindow'), gap = num(c, 'longestGapH');
  const gapText = gap === undefined ? UNAVAILABLE : gap < 0.05 ? 'none' : `${span(gap)}${isObject(c) && c.gapRunsIntoWindowEdge === true ? ' or more (it runs into an edge of the window)' : ''}`;
  return `in view ${percent(pct)} of the window, longest gap ${gapText}`;
}

function dsnText(d: unknown): string {
  if (!isObject(d)) return 'Deep Space Network stations: not part of this result.';
  if (d.available !== true) return `Deep Space Network stations: ${str(d, 'reason') ?? 'not available'}`;
  const stations = (Array.isArray(d.stations) ? d.stations : []).filter(isObject);
  const limit = num(stations[0], 'receiveLimitDeg');
  const lines = [
    `Deep Space Network stations over the mission window ${utc(str(d, 'windowStartUtc'))} to ${utc(str(d, 'windowEndUtc'))} (receiving: the site above the station's ${limit === undefined ? '' : `${limit}° `}limit and the station above this site's terrain skyline):`,
    ...stations.map((s) => `- ${str(s, 'name') ?? str(s, 'id') ?? 'station'}${str(s, 'complex') ? ` (${str(s, 'complex')})` : ''}: ${contactText(s.receive)}`),
    `- any station: ${contactText(at(d, 'anyStation.receive'))}`,
  ];
  if (str(d, 'meaning')) lines.push(str(d, 'meaning')!);
  return lines.join('\n');
}

function averagesText(a: unknown): string {
  if (!isObject(a)) return 'Long-term averages: not part of this result.';
  if (str(a, 'reason') && !isObject(a.sunlight)) return `Long-term averages: ${str(a, 'reason')}`;
  const value = (x: unknown): string | null => {
    if (!isObject(x) || x.available !== true) return null;
    const pct = num(x, 'pctOfTime'), cell = num(x, 'cellM');
    if (pct === undefined) return null;
    return `${x.neverInModel === true ? 'never (0 %)' : `${pct} % of the time`}${cell !== undefined ? `, ${cell} m cell` : ''}`;
  };
  const sun = value(a.sunlight), earth = value(a.earthVisibility);
  if (!sun && !earth) return `Long-term averages: ${str(a, 'sunlight.text') ?? 'no published average map covers this site (polar regions only).'}`;
  const lines = [`Long-term averages at the site (${str(a, 'kind') ?? 'a multi-year average, not the geometry of your mission window'}):`];
  lines.push(`- any sunlight: ${sun ?? 'not mapped here'}`);
  lines.push(`- any part of Earth's disc in view: ${earth ?? 'not mapped here'}`);
  if (str(a, 'citation')) lines.push(`Source: ${str(a, 'citation')}`);
  return lines.join('\n');
}

const notIncluded = (r: Json, word: RegExp, fallback: string) =>
  (Array.isArray(r.notIncluded) ? r.notIncluded : []).find((s): s is string => typeof s === 'string' && word.test(s)) ?? fallback;

function temperatureText(t: unknown, r: Json): string {
  if (!isObject(t)) return `Surface temperature: ${notIncluded(r, /diviner|temperature/i, 'Diviner temperatures are not part of this build.')}`;
  if (str(t, 'reason') && t.status === undefined) return `Surface temperature: ${str(t, 'reason')}`;
  if (t.status === 'ok') {
    const max = num(t, 'annualMaxK'), mean = num(t, 'annualMeanK'), cell = num(t, 'cellM');
    return [
      `Surface temperature (LRO Diviner, annual values for the ${cell ?? '?'} m cell${str(t, 'measuredOver') ? `, measured ${str(t, 'measuredOver')}` : ''}): annual maximum ${max === undefined ? UNAVAILABLE : `${max} K`}, annual mean ${mean === undefined ? UNAVAILABLE : `${mean} K`}.`,
      str(t, 'kind') ?? 'Not the temperature at the simulated date.',
    ].join(' ');
  }
  return `Surface temperature (LRO Diviner): ${str(t, 'text') ?? (t.status === 'outside' ? 'the maps cover only latitudes poleward of 80°.' : 'the published map has no value for this cell.')}`;
}

function shadowCamText(c: unknown, r: Json): string {
  if (!isObject(c)) return `ShadowCam: ${notIncluded(r, /shadowcam/i, 'ShadowCam mosaics are not part of this build.')}`;
  if (str(c, 'reason') && !Array.isArray(c.mosaics)) return `ShadowCam: ${str(c, 'reason')}`;
  const mosaics = (Array.isArray(c.mosaics) ? c.mosaics : []).filter(isObject);
  if (!mosaics.length) {
    const n = num(c, 'mosaicsInIndex');
    return `ShadowCam: ${n !== undefined ? `none of the ${n} controlled mosaics in the index covers this point.` : (str(c, 'text') ?? 'no mosaic covers this point.')}`;
  }
  const lines = [`ShadowCam mosaics covering this point (${mosaics.length}, newest images first):`];
  for (const m of mosaics.slice(0, 3)) {
    const from = str(m, 'imagesFrom'), to = str(m, 'imagesTo'), px = num(m, 'pixelScaleM');
    const dates = from && to ? (from === to ? `images of ${from}` : `images of ${from} to ${to}`) : 'image dates not stated';
    lines.push(`- ${str(m, 'label') ?? str(m, 'id') ?? 'mosaic'} (${dates}${px !== undefined ? `, ${px} m per pixel` : ''}): ${str(m, 'url') ?? 'no link'}`);
  }
  if (mosaics.length > 3) lines.push(`and ${plural(mosaics.length - 3, 'more')}.`);
  lines.push('The images are not part of the app: each link opens the product in the ShadowCam PDS archive.');
  if (str(c, 'credit')) lines.push(`Credit: ${str(c, 'credit')}.`);
  return lines.join('\n');
}

type SciencePart = 'dsn' | 'longTermAverages' | 'iceTargets' | 'surfaceTemperature' | 'shadowCam';
const PART_WORDS: Record<SciencePart, string> = {
  dsn: 'Deep Space Network stations',
  longTermAverages: 'long-term averages',
  iceTargets: 'nearest ice targets',
  surfaceTemperature: 'Diviner annual temperatures',
  shadowCam: 'ShadowCam mosaics',
};
const PART_TEXT: Record<SciencePart, (part: unknown, all: Json) => string> = {
  dsn: (p) => dsnText(p),
  longTermAverages: (p) => averagesText(p),
  iceTargets: (p) => iceText(p, 'Nearest mapped ice targets'),
  surfaceTemperature: (p, all) => temperatureText(p, all),
  shadowCam: (p, all) => shadowCamText(p, all),
};

const DSN_WORDS = /\b(dsn|deep space network|deep[- ]space (?:stations?|antennas?|network)|ground stations?|goldstone|canberra|madrid|tidbinbilla|robledo)\b/;
const TEMPERATURE_WORDS = /\b(temperatures?|how (?:cold|hot|warm)|diviner)\b/;
const SHADOWCAM_WORDS = /\bshadow ?cam\b/;
const AVERAGE_WORDS = /\b(long[- ]term|18\.6[- ]years?|multi[- ]year|pgda)\b/;

export const siteScience: Intent = (step) => {
  if (/^(compare|rank|find|search|set|go|select)\b/.test(step)) return null;
  // Folding the card's section is the panel command (showPanel), not the readout.
  if (/^(fold|unfold|collapse|expand|hide|close)\b/.test(step) || /\bscience section$/.test(step)) return null;
  const whole = /^(?:(?:show|read|give|tell|list|report|what (?:is|are|does))\s+)?(?:me\s+)?(?:the\s+)?(?:site\s+)?science(?:\s+(?:readouts?|layers?|data|section))?(?:\s+(?:here|for (?:this|the) (?:site|pin)|at (?:this|the) (?:site|pin)))?(?:\s+say)?$/.test(step);
  const parts: SciencePart[] = [];
  if (DSN_WORDS.test(step)) parts.push('dsn');
  if (TEMPERATURE_WORDS.test(step)) parts.push('surfaceTemperature');
  if (SHADOWCAM_WORDS.test(step)) parts.push('shadowCam');
  // The long-term averages as a reading at the site. "Show the average sunlight (map)" is the
  // globe overlay of the same data and is left to the overlay command.
  const averages =
    (AVERAGE_WORDS.test(step) && /\b(averages?|mean|sunlight|illumination|earth|visibility)\b/.test(step)) ||
    (/\baverage (sunlight|illumination|earth visibility|earth)\b/.test(step) && (QUESTION.test(step) || HERE.test(step)));
  const overlay = /\b(overlay|map|layer|heat ?map|colou?rs?)\b/.test(step) || ((SHOW.test(step) || HIDE.test(step)) && /\b(sunlight|illumination|sun|light|earth|visibility)\b/.test(step) && !HERE.test(step));
  if (averages && !overlay) parts.push('longTermAverages');
  if (!whole && !parts.length) return null;
  const wanted: SciencePart[] = whole ? ['dsn', 'longTermAverages', 'iceTargets', 'surfaceTemperature', 'shadowCam'] : parts;
  return plan(`read the ${whole ? 'site science' : wanted.map((p) => PART_WORDS[p]).join(' and ')} for the site`, async (ctx) => {
    const r = await ctx.run('getSiteScience');
    const lines = [`Site science for ${siteText(r.site)}:`];
    for (const p of wanted) lines.push(PART_TEXT[p](r[p], r));
    if (wanted.includes('dsn') || wanted.includes('longTermAverages')) lines.push(EARTH_NOTE);
    return lines.join('\n');
  });
};

// ---------------------------------------------------------------- surface view

export const fieldOfView: Intent = (step) => {
  const m =
    /^(?:set\s+|change\s+)?(?:the\s+)?(?:vertical\s+)?(?:field of view|fov|view angle)\s*(?:to|of|=|at)?\s*(\d+(?:\.\d+)?)\s*(?:deg(?:rees?)?)?$/.exec(step) ??
    /^zoom\s+(?:in\s+)?to\s+(?:a\s+)?(\d+(?:\.\d+)?)\s*deg(?:rees?)?(?:\s+(?:field of view|fov|view))?$/.exec(step);
  if (!m) return null;
  const fovDeg = Number(m[1]);
  return plan(`set the field of view to ${fovDeg}°`, async (ctx) => {
    if (ctx.has('setFieldOfView')) {
      const r = await ctx.run('setFieldOfView', { fovDeg: clamp(fovDeg, bounds(ctx, 'setFieldOfView', 'fovDeg', [4, 100])) });
      return `Field of view: ${degrees(num(r, 'look.fovDeg'))} (70° is the normal view; the Sun and Earth are drawn at true size).`;
    }
    const s = await ctx.state();
    const azDeg = num(s, 'look.azDeg');
    if (azDeg === undefined) throw new Halt('The field of view is set in the surface view. Enter the surface view first.');
    const r = await ctx.run('lookAt', { azDeg, fovDeg: clamp(fovDeg, bounds(ctx, 'lookAt', 'fovDeg', [20, 90])) });
    return `Field of view: ${degrees(num(r, 'look.fovDeg'))}.`;
  });
};

const LENGTH = '(\\d+(?:\\.\\d+)?)\\s*(m|km|metres?|meters?|kilometres?|kilometers?)';
const DIRECTION = '(north[- ]?east|north[- ]?west|south[- ]?east|south[- ]?west|north|south|east|west|ne|nw|se|sw|n|s|e|w)';
const metres = (value: string, unit: string) => Number(value) * (/^k/.test(unit) ? 1000 : 1);

/** "320 m east and 40 m south of the site". */
function offsetText(eastM: number | undefined, northM: number | undefined): string {
  if (eastM === undefined || northM === undefined) return 'position unavailable';
  return `${distance(Math.abs(eastM))} ${eastM >= 0 ? 'east' : 'west'} and ${distance(Math.abs(northM))} ${northM >= 0 ? 'north' : 'south'} of the site`;
}

/** "2.0 m", "45 m": the eye height as the HUD writes it. */
const eyeText = (m: number | undefined) => (m === undefined ? UNAVAILABLE : `${m < 10 ? m.toFixed(1) : Math.round(m)} m`);

type Move = { kind: 'home' } | { kind: 'by'; eastM: number; northM: number } | { kind: 'ahead'; metres: number } | { kind: 'to'; eastM: number; northM: number } | { kind: 'lift'; liftM: number; relative: boolean };

function parseMove(step: string): Move | null {
  // Not a bare "go back": that could mean the globe or the clock.
  const home = '(?:the\\s+)?(?:landing\\s+)?(?:site|pin|start(?:ing point)?)';
  if (new RegExp(`^(?:walk|come)\\s+back(?:\\s+to\\s+${home})?$|^(?:go|head|move|return)\\s+back\\s+to\\s+${home}$|^return\\s+to\\s+${home}$`).test(step)) return { kind: 'home' };
  const by = new RegExp(`^(?:walk|move|go|head|step|stroll|drive)\\s+${LENGTH}\\s+(?:to the\\s+|towards?\\s+(?:the\\s+)?)?${DIRECTION}(?:wards?)?$`).exec(step);
  if (by) {
    const az = compassAzimuth(by[3]);
    if (az === null) return null;
    const d = metres(by[1], by[2]);
    return { kind: 'by', eastM: d * Math.sin((az * Math.PI) / 180), northM: d * Math.cos((az * Math.PI) / 180) };
  }
  // "forward" / "back" only with a walking verb: "go back 30 m" could mean the clock (30 min).
  const ahead = new RegExp(`^(?:walk|step|stroll)\\s+${LENGTH}\\s+(forward|forwards|ahead|on|back|backwards?)$`).exec(step) ?? new RegExp(`^(?:walk|step|stroll)\\s+(forward|forwards|ahead|on|back|backwards?)\\s+${LENGTH}$`).exec(step);
  if (ahead) {
    const [value, unit, word] = /^\d/.test(ahead[1]) ? [ahead[1], ahead[2], ahead[3]] : [ahead[2], ahead[3], ahead[1]];
    return { kind: 'ahead', metres: metres(value, unit) * (/back/.test(word) ? -1 : 1) };
  }
  if (/^(?:walk|go|move|head)\s+to\s+/.test(step)) {
    const parts = [...step.matchAll(new RegExp(`(-?\\d+(?:\\.\\d+)?)\\s*(m|km|metres?|meters?|kilometres?|kilometers?)\\s+(north|south|east|west)\\b`, 'g'))];
    const rest = step.replace(/^(?:walk|go|move|head)\s+to\s+/, '').replace(new RegExp(`(-?\\d+(?:\\.\\d+)?)\\s*(m|km|metres?|meters?|kilometres?|kilometers?)\\s+(north|south|east|west)\\b`, 'g'), '').replace(/\b(and|of the site|of the pin|from the site)\b|,/g, '').trim();
    if (parts.length && parts.length <= 2 && !rest) {
      let eastM = 0, northM = 0;
      for (const p of parts) {
        const v = metres(p[1], p[2]);
        if (p[3] === 'east') eastM = v;
        else if (p[3] === 'west') eastM = -v;
        else if (p[3] === 'north') northM = v;
        else northM = -v;
      }
      return { kind: 'to', eastM, northM };
    }
  }
  const lift = /^(?:rise|go up|climb|fly up|ascend|lift(?: me)?(?: up)?|raise\s+(?:the\s+|my\s+)?(?:viewpoint|view|eye|camera))\s+(by\s+|to\s+)?(\d+(?:\.\d+)?)\s*(?:m|metres?|meters?)(?:\s+(?:up|higher|above the ground))?$/.exec(step);
  if (lift) return { kind: 'lift', liftM: Number(lift[2]), relative: lift[1]?.trim() !== 'to' };
  if (/^(?:come|go|get|climb|fly)\s+(?:back\s+)?down(?:\s+to\s+the\s+ground)?$|^(?:stand|back)\s+on\s+the\s+ground$|^descend\s+to\s+the\s+ground$/.test(step)) return { kind: 'lift', liftM: 0, relative: false };
  return null;
}

export const walk: Intent = (step) => {
  const move = parseMove(step);
  if (!move) return null;
  const does =
    move.kind === 'home' ? 'walk back to the site' : move.kind === 'lift' ? (move.liftM === 0 && !move.relative ? 'come back down to standing height' : `raise the viewpoint ${move.relative ? 'by' : 'to'} ${move.liftM} m`) : move.kind === 'to' ? `walk to ${offsetText(move.eastM, move.northM)}` : move.kind === 'ahead' ? `walk ${distance(Math.abs(move.metres))} ${move.metres < 0 ? 'back' : 'ahead'}` : `walk ${distance(Math.hypot(move.eastM, move.northM))}`;
  return plan(does, async (ctx) => {
    // The HUD's "Return to site" button is walkTo { eastM: 0, northM: 0 }; the same here.
    let params: Json;
    if (move.kind === 'home') {
      params = { eastM: 0, northM: 0 };
    } else {
      const v = await ctx.run('getSurfaceView');
      if (v.active !== true) throw new Halt('Walking works in the surface view. Enter it first ("enter the surface").');
      const e0 = num(v, 'position.eastM') ?? 0, n0 = num(v, 'position.northM') ?? 0, eye = num(v, 'position.eyeHeightM');
      // Keep the present lift above standing height (the mast height) unless the request changes it.
      const st = await ctx.state();
      const stand = num(st, 'mastHeightM');
      const lift0 = eye !== undefined && stand !== undefined ? Math.max(0, eye - Math.max(0.2, stand)) : 0;
      const keepLift = lift0 > 0.5 ? { liftM: round1(lift0) } : {};
      const range = bounds(ctx, 'walkTo', 'eastM', [-30000, 30000]);
      if (move.kind === 'lift') {
        const liftM = clamp(move.relative ? lift0 + move.liftM : move.liftM, bounds(ctx, 'walkTo', 'liftM', [0, 500]));
        params = { eastM: round1(e0), northM: round1(n0), liftM: round1(liftM) };
      } else if (move.kind === 'to') {
        params = { eastM: clamp(move.eastM, range), northM: clamp(move.northM, range), ...keepLift };
      } else if (move.kind === 'ahead') {
        const az = num(st, 'look.azDeg');
        if (az === undefined) throw new Halt('The direction the view faces is not available.');
        params = { eastM: clamp(round1(e0 + move.metres * Math.sin((az * Math.PI) / 180)), range), northM: clamp(round1(n0 + move.metres * Math.cos((az * Math.PI) / 180)), range), ...keepLift };
      } else {
        params = { eastM: clamp(round1(e0 + move.eastM), range), northM: clamp(round1(n0 + move.northM), range), ...keepLift };
      }
    }
    const r = await ctx.run('walkTo', params);
    const p = r.position;
    const away = num(p, 'distanceFromSiteM');
    const where = away !== undefined && away < 1 ? 'at the site' : `${offsetText(num(p, 'eastM'), num(p, 'northM'))}${away !== undefined ? ` (${distance(away)} from it)` : ''}`;
    const eye = num(p, 'eyeHeightM');
    return [
      `Now ${where}${eye !== undefined ? `, eye ${eyeText(eye)} above the ground` : ''}.`,
      r.clamped === true ? 'That is as far as the walkable area goes, so the viewer stopped at its edge.' : '',
      'The Sun, Earth and the mission-window figures stay those of the site.',
    ].filter(Boolean).join(' ');
  });
};

export const skyPaths: Intent = (step) => {
  const m = /^(show|display|turn on|enable|draw|hide|remove|turn off|disable)\s+(?:the\s+)?(?:(sky|sun and earth|sun's|earth's|sun|earth)\s+)?(paths?|tracks?|trails?|labels?|annotations?)(?:\s+and\s+(?:the\s+)?(paths?|tracks?|labels?))?(?:\s+in the sky)?$/.exec(step);
  if (!m) return null;
  const on = !/hide|remove|off|disable/.test(m[1]);
  const words = `${m[3]} ${m[4] ?? ''}`;
  // "Sky paths" is the HUD button: it switches the tracks and the labels together.
  const both = (m[2] === 'sky' && /path/.test(m[3]) && !m[4]) || /annotation/.test(words) || (/path|track|trail/.test(words) && /label/.test(words));
  const params: Json = both ? { tracks: on, labels: on } : /label/.test(words) ? { labels: on } : { tracks: on };
  return plan(`${on ? 'show' : 'hide'} the ${both ? 'sky paths and labels' : /label/.test(words) ? 'Sun and Earth labels' : 'Sun and Earth tracks'}`, async (ctx) => {
    const r = await ctx.run('setSkyAnnotations', params);
    const tracks = r.tracks === true, labels = r.labels === true;
    const every = isObject(r.markEvery) ? `One mark per ${span(num(r, 'markEvery.sunH'))} for the Sun and per ${span(num(r, 'markEvery.earthH'))} for Earth over the mission window; filled marks are above the skyline as drawn, hollow ones behind terrain.` : '';
    return `Sun and Earth tracks ${tracks ? 'shown' : 'hidden'}, labels ${labels ? 'shown' : 'hidden'}.${tracks && every ? ` ${every}` : ''}`;
  });
};

export const surfaceStatus: Intent = (step) => {
  if (
    !/^(?:what (?:is|does) the (?:surface|ground)(?: view)? (?:show(?:ing)?|made (?:of|from)|built (?:of|from)|drawn from)|what is the ground (?:made|built|drawn) (?:of|from)|(?:describe the |show the )?surface view (?:status|details|info|information)|describe the surface view|where am i standing|how far am i from the (?:landing )?(?:site|pin)|what am i looking at|which elevation data (?:is|are) (?:the ground|this) (?:built |drawn )?(?:from|on))$/.test(step)
  ) return null;
  return plan('describe the surface view', async (ctx) => {
    const r = await ctx.run('getSurfaceView');
    if (r.active !== true) throw new Halt('The surface view is not on screen. Enter it first ("enter the surface").');
    const look = isObject(r.look) ? r.look : {};
    const pos = isObject(r.position) ? r.position : {};
    const away = num(pos, 'distanceFromSiteM');
    const lines = [
      `Surface view at ${siteText(r.site)}: facing azimuth ${degrees(num(look, 'azDeg'))}, elevation ${degrees(num(look, 'elDeg'))}, field of view ${degrees(num(look, 'fovDeg'))}; standing ${away !== undefined && away < 1 ? 'at the site' : offsetText(num(pos, 'eastM'), num(pos, 'northM'))}, eye ${eyeText(num(pos, 'eyeHeightM'))} above the ground.`,
    ];
    const g = r.ground;
    if (isObject(g)) {
      if (str(g, 'summary')) lines.push(`Ground: ${str(g, 'summary')}.`);
      const bands = (Array.isArray(g.bands) ? g.bands : []).filter(isObject).slice(0, 5);
      for (const b of bands) lines.push(`- ${distance(num(b, 'fromM'))} to ${distance(num(b, 'toM'))}: ${str(b, 'product') ?? 'no product named'}${num(b, 'productResolutionM') !== undefined ? ` (${num(b, 'productResolutionM')} m)` : ''}${b.interpolated === true ? ', interpolated' : ''}`);
      if (g.generatedDetailShown === true && str(g, 'generated')) lines.push(`Generated, not measured: ${str(g, 'generated')}`);
      else if (g.generatedDetailShown === false) lines.push('Generated detail is off: only measured (or interpolated) terrain is drawn.');
    }
    const sky = r.sky;
    if (isObject(sky)) {
      lines.push(
        `Sun: azimuth ${degrees(num(sky, 'sun.azDeg'), 2)}, elevation ${degrees(num(sky, 'sun.elDeg'), 2)}, ${num(sky, 'sun.discAboveDrawnTerrainPct') ?? UNAVAILABLE} % of its disc above the terrain as drawn. ` +
          `Earth: azimuth ${degrees(num(sky, 'earth.azDeg'), 2)}, elevation ${degrees(num(sky, 'earth.elDeg'), 2)}, ${num(sky, 'earth.litPct') ?? UNAVAILABLE} % lit, centre ${at(sky, 'earth.centreBehindDrawnTerrain') === true ? 'behind' : 'above'} the terrain as drawn (${str(sky, 'directions') ?? 'directions'}${str(sky, 'timeUtc') ? `, ${utc(str(sky, 'timeUtc'))}` : ''}).`,
      );
      if (str(sky, 'note')) lines.push(str(sky, 'note')!);
    }
    return lines.join('\n');
  });
};

// ---------------------------------------------------------------- the surface HUD: chart, key metrics, explanation

// ---------------------------------------------------------------- tracking the Sun or Earth (PR #2)

/** "Track the Sun" keeps the view on it as the clock runs (the HUD's Track toggles); "face the Sun" turns to it once (lookAtBody). */
export const tracking: Intent = (step) => {
  const on = /^(?:track|follow|keep (?:facing|looking at|the view on)|lock (?:the view )?on(?:to)?)\s+(?:the\s+)?(sun|earth)(?:\s+as (?:the )?(?:clock|time) (?:runs|moves|passes))?$/.exec(step);
  const off = /^(?:stop|end|cancel|turn off)\s+(?:tracking|following)(?:\s+(?:the\s+)?(sun|earth))?$|^untrack(?:\s+(?:the\s+)?(sun|earth))?$/.exec(step);
  if (!on && !off) return null;
  if (on) {
    const body = on[1] as 'sun' | 'earth';
    const name = body === 'sun' ? 'the Sun' : 'Earth';
    return plan(`keep facing ${name} as the clock runs`, async (ctx) => {
      const r = await ctx.run('setBodyTracking', { body, on: true });
      const look = isObject(r.look) ? ` Facing azimuth ${degrees(num(r, 'look.azDeg'))}, elevation ${degrees(num(r, 'look.elDeg'))} now.` : '';
      return `The view now keeps facing ${name} as simulated time changes.${look} Dragging the view or the arrow keys stop the tracking.`;
    });
  }
  const named = (off![1] ?? off![2]) as 'sun' | 'earth' | undefined;
  return plan(named ? `stop tracking ${named === 'sun' ? 'the Sun' : 'Earth'}` : 'stop tracking', async (ctx) => {
    let body = named;
    if (!body) {
      // Which one is tracked is in the surface view's state.
      const v = await ctx.run('getSurfaceView');
      const t = str(v, 'trackingBody');
      if (t !== 'sun' && t !== 'earth') return 'Neither the Sun nor Earth is being tracked.';
      body = t;
    }
    const r = await ctx.run('setBodyTracking', { body, on: false });
    const still = str(r, 'tracking');
    return still && still !== body ? `${body === 'sun' ? 'The Sun' : 'Earth'} was not being tracked; ${still === 'sun' ? 'the Sun' : 'Earth'} still is.` : `Tracking stopped: the view stays where it is now.`;
  });
};

// ---------------------------------------------------------------- the surface view's movable panels (T-65)

/** Panel words to the ids of setSurfacePanel (src/ui/surface/panelLayout.ts). The key metrics keep their own fold (showKeyMetrics). */
const PANEL_WORDS: [RegExp, string][] = [
  [/^(?:skyline )?chart$/, 'skyline-chart'],
  [/^(?:surface )?controls$/, 'surface-controls'],
  [/^(?:time|time slider|scrubber|clock)$/, 'time'],
  [/^(?:locator(?: map)?|map)$/, 'locator-map'],
  [/^(?:compare|comparison)$/, 'compare'],
  [/^(?:assistant|chat)$/, 'assistant'],
  [/^key metrics$/, 'key-metrics'],
];
const PANEL_NAME = '((?:skyline )?chart|(?:surface )?controls|time slider|time|scrubber|clock|locator map|locator|map|compare|comparison|assistant|chat|key metrics)';
const panelId = (word: string): string | undefined => PANEL_WORDS.find(([re]) => re.test(word))?.[1];

/** "Time: on screen, folded, moved to 300, 200 px (412 × 96 px)". */
function panelLine(p: Json): string {
  const where = p.shown !== true ? 'not on screen' : `on screen, ${p.folded === true ? 'folded' : 'open'}, ${p.moved === true ? 'moved' : 'in its place'}`;
  const box = num(p, 'xPx') !== undefined ? `, top left at ${num(p, 'xPx')}, ${num(p, 'yPx')} px (${num(p, 'widthPx')} × ${num(p, 'heightPx')} px)` : '';
  return `${str(p, 'title') ?? str(p, 'panel') ?? 'panel'}: ${where}${box}`;
}

export const surfacePanels: Intent = (step) => {
  if (/^(?:reset|restore|tidy(?: up)?)\s+(?:all\s+)?(?:the\s+)?(?:surface\s+)?panels(?:\s+(?:positions?|layout))?$|^panels? reset$/.test(step)) {
    return plan('put every surface panel back in its place', async (ctx) => {
      const r = await ctx.run('resetSurfacePanels');
      const n = Array.isArray(r.panels) ? r.panels.length : 0;
      return `Every surface panel is back in its place and open${n ? ` (${plural(n, 'panel')})` : ''}.`;
    });
  }
  if (/^(?:list|show me|where are|which are|what are)\s+(?:all\s+)?(?:the\s+)?(?:surface\s+)?panels$|^surface panels$/.test(step)) {
    return plan('list the surface panels', async (ctx) => {
      const r = await ctx.run('getSurfacePanels');
      const list = Array.isArray(r.panels) ? r.panels.filter(isObject) : [];
      const head = r.surfaceView === true ? 'Surface panels (the surface view is shown):' : 'Surface panels (they move and fold in the surface view only; it is not shown now):';
      return [head, ...list.map((p) => `- ${panelLine(p)}`)].join('\n');
    });
  }
  // Folding needs the word "panel": "fold the key metrics" and "expand the chart" keep their own actions.
  const fold = new RegExp(`^(fold|collapse|unfold|open|reopen)\\s+(?:the\\s+)?${PANEL_NAME}\\s+panel$`).exec(step);
  const moveTo = new RegExp(`^(?:move|put|drag|place)\\s+(?:the\\s+)?${PANEL_NAME}(?:\\s+panel)?\\s+(?:to|at)\\s+(?:x\\s*=?\\s*)?(-?\\d+)(?:\\s*(?:px|pixels))?\\s*(?:,|and)?\\s*(?:y\\s*=?\\s*)?(-?\\d+)(?:\\s*(?:px|pixels))?$`).exec(step);
  const moveBy = new RegExp(`^(?:move|nudge|shift|drag)\\s+(?:the\\s+)?${PANEL_NAME}(?:\\s+panel)?\\s+(left|right|up|down)(?:\\s+by)?\\s+(\\d+)\\s*(?:px|pixels)?$`).exec(step);
  const word = fold?.[2] ?? moveTo?.[1] ?? moveBy?.[1];
  if (!word) return null;
  const panel = panelId(word);
  if (!panel || (fold && panel === 'key-metrics')) return null;
  if (fold) {
    const folded = /^(fold|collapse)$/.test(fold[1]);
    return plan(`${folded ? 'fold' : 'open'} the ${word} panel`, async (ctx) => {
      const r = await ctx.run('setSurfacePanel', { panel, folded });
      return `The ${str(r, 'title') ?? word} panel is ${r.folded === true ? 'folded to its title row' : 'open'}.`;
    });
  }
  return plan(`move the ${word} panel`, async (ctx) => {
    let xPx: number, yPx: number;
    if (moveTo) {
      xPx = Number(moveTo[2]);
      yPx = Number(moveTo[3]);
    } else {
      // Relative to where it is now, as the grip's arrow keys move it.
      const now = await ctx.run('getSurfacePanels');
      const p = (Array.isArray(now.panels) ? now.panels.filter(isObject) : []).find((x) => str(x, 'panel') === panel);
      if (!p || num(p, 'xPx') === undefined) throw new Halt(`The ${word} panel is not on screen${now.surfaceView === true ? '' : ': the panels move in the surface view only'}.`);
      const d = Number(moveBy![3]);
      const dir = moveBy![2];
      xPx = num(p, 'xPx')! + (dir === 'left' ? -d : dir === 'right' ? d : 0);
      yPx = num(p, 'yPx')! + (dir === 'up' ? -d : dir === 'down' ? d : 0);
    }
    const r = await ctx.run('setSurfacePanel', { panel, xPx, yPx });
    const kept = num(r, 'xPx') !== xPx || num(r, 'yPx') !== yPx ? ' (kept inside the window)' : '';
    return `The ${str(r, 'title') ?? word} panel is now at ${num(r, 'xPx') ?? '?'}, ${num(r, 'yPx') ?? '?'} px, its top left corner from the top left of the window${kept}.`;
  });
};

export const hudPanels: Intent = (step) => {
  if (QUESTION.test(step)) return null;
  const chartWords = /\b(skyline )?chart\b/;
  if (chartWords.test(step)) {
    const params: Json = {};
    if (/^(hide|close|remove|turn off)\b/.test(step)) params.show = false;
    else if (/\b(expand|enlarge|bigger|larger|full[- ]size|maximi[sz]e)\b/.test(step)) params.expanded = true;
    else if (/\b(shrink|smaller|collapse|minimi[sz]e|compact)\b/.test(step)) params.expanded = false;
    if (/\b(against|over|versus|vs) time\b|\btime (chart|mode|view|plot)\b|\bchart (of|by) time\b/.test(step)) params.mode = 'time';
    else if (/\bskyline (mode|view|plot)\b|\bchart (of|by) azimuth\b|\bagainst azimuth\b/.test(step)) params.mode = 'skyline';
    if (/\bas (a )?table\b|\btable (view|mode)\b/.test(step)) params.table = !/^(hide|close)\b.*\btable\b/.test(step);
    if (/\b(full circle|whole circle|all azimuths|0 to 360)\b/.test(step)) params.azimuthRange = 'full';
    else if (/\b(tracks only|only the tracks|where the tracks are|fit the tracks)\b/.test(step)) params.azimuthRange = 'tracks';
    if (!Object.keys(params).length) {
      if (!/^(show|open|display|turn on)\b/.test(step)) return null;
      params.show = true;
    }
    return plan('change the skyline chart', async (ctx) => {
      const r = await ctx.run('setChart', params);
      if (r.chart === 'hidden') return 'The skyline chart is hidden.';
      const what = r.mode === 'time' ? 'elevation and clearance of the Sun and Earth against time' : 'the terrain skyline around the compass with the Sun and Earth samples over the mission window';
      return `The skyline chart is ${r.chart === 'expanded' ? 'expanded' : 'shown at its small size'}: ${what}${r.table === true ? ', as a table' : ''}${r.azimuthRange === 'tracks' && r.mode !== 'time' ? ', only the azimuths the tracks cross' : ''}.`;
    });
  }
  const metrics = /^(show|open|unfold|expand|hide|close|fold|collapse)\s+(?:the\s+)?key metrics(?: panel)?$/.exec(step);
  if (metrics) {
    const open = /show|open|unfold|expand/.test(metrics[1]);
    return plan(`${open ? 'open' : 'fold'} the key metrics`, async (ctx) => {
      const r = await ctx.run('showKeyMetrics', { open });
      return r.keyMetricsOpen === true ? 'The key metrics are open: the Sun and Earth now, the countdowns to the next rise and set, and the mission-window figures.' : 'The key metrics are folded: only their title shows.';
    });
  }
  if (/^(close|dismiss|hide|remove|clear)\s+(?:the\s+)?(?:ridge |blockage |blocking |terrain )?explanation$/.test(step)) {
    return plan('close the blockage explanation', async (ctx) => {
      await ctx.run('dismissBlockageExplanation');
      return 'The blockage explanation is closed.';
    });
  }
  return null;
};

// ---------------------------------------------------------------- the landing catalogue

export const listSites: Intent = (step) => {
  if (
    !/^(?:list|name|what are|which are)\s+(?:all\s+)?(?:of\s+)?(?:the\s+)?(?:catalogued\s+|known\s+|available\s+|previous\s+)?(?:landing sites|landings|lunar landings|sites|missions|landing catalogue|catalogue)(?:\s+(?:in the catalogue|you know|there are|i can (?:choose|select|pick|visit)))?$/.test(step) &&
    !/^which (?:landing )?sites (?:are there|can i (?:choose|select|pick|visit)|do you know|are in the catalogue)$/.test(step)
  ) return null;
  return plan('list the catalogued landing sites', async (ctx) => {
    const r = await ctx.run('listSites');
    const sites = (Array.isArray(r.sites) ? r.sites : []).filter(isObject);
    const total = num(r, 'total'), shown = num(r, 'shown');
    const head = `${total ?? sites.length} catalogued landings${shown !== undefined && shown !== total ? ` (${shown} shown by the current mission filters)` : ''}${r.markersOnGlobe === false ? '; the markers are hidden on the globe' : ''}, oldest first:`;
    const rows = sites.map((s) => `- ${str(s, 'name') ?? str(s, 'id')} (${[str(s, 'program'), str(s, 'country'), str(s, 'landedUtc') ? utc(str(s, 'landedUtc')).slice(0, 10) : null, s.crewed === true ? 'crewed' : null].filter(Boolean).join(', ')})${s.shown === false ? ', hidden by the filters' : ''}`);
    return [head, ...rows, 'Say "go to <name>" to select one, or "show <name> at its landing time".'].join('\n');
  });
};

// ---------------------------------------------------------------- the compare panel

const nameFrom = (raw: string, pattern: RegExp): string | null => {
  const m = pattern.exec(raw.trim().replace(/[.!?]+$/, '').replace(/^["“]|["”]$/g, ''));
  const name = m?.[1]?.trim().replace(/^["“'‘]|["”'’]$/g, '').trim();
  return name ? name : null;
};

function labelsText(r: Json): string {
  return `A: ${str(r, 'A') ?? 'empty'}; B: ${str(r, 'B') ?? 'empty'}.`;
}

export const comparePanel: Intent = (step, raw) => {
  if (/^(?:swap|switch|exchange|flip|reverse)\s+(?:the\s+)?(?:a and b|a\/b|b and a|sides|slots|scenarios|comparison(?: sides)?|a with b)$/.test(step)) {
    return plan('swap scenarios A and B', async (ctx) => {
      const r = await ctx.run('swapComparison');
      return `Swapped A and B, so the differences (B minus A) change sign. ${labelsText(r)}`;
    });
  }
  const slot = /^(?:clear|empty|remove)\s+(?:the\s+)?(?:comparison\s+)?(?:slot|scenario)\s+([ab])$/.exec(step);
  if (slot || /^(?:clear|empty|reset)\s+(?:the\s+|both\s+)?(?:comparison(?:\s+slots)?|slots|both slots|comparison slots)$/.test(step)) {
    const which = slot ? slot[1].toUpperCase() : null;
    return plan(which ? `empty comparison slot ${which}` : 'empty both comparison slots', async (ctx) => {
      const r = await ctx.run('clearComparison', which ? { slot: which } : {});
      return `${which ? `Slot ${which} is empty now` : 'Both comparison slots are empty now'}. ${labelsText(r)} Saved comparisons are kept.`;
    });
  }
  if (/^(?:list|show|which are)\s+(?:the\s+|my\s+)?saved comparisons$|^saved comparisons$|^which comparisons are saved$|^what comparisons (?:are|have i) saved$/.test(step)) {
    return plan('list the saved comparisons', async (ctx) => {
      const r = await ctx.run('listComparisons');
      const list = (Array.isArray(r.comparisons) ? r.comparisons : []).filter(isObject);
      const where = r.keptInBrowserStorage === false ? ' (this browser gives the page no storage: they last until the page is closed)' : ' (kept in this browser)';
      if (!list.length) return `No comparison is saved yet${where}. Say "save this comparison as <name>".`;
      return [`${plural(list.length, 'saved comparison')}${where}, newest first:`, ...list.map((c) => `- "${str(c, 'name')}", saved ${utc(str(c, 'savedUtc'))}: A = ${str(c, 'A') ?? '?'}; B = ${str(c, 'B') ?? '?'}`)].join('\n');
    });
  }
  if (/^(?:save|keep|store|bookmark)\s+(?:this\s+|the\s+|my\s+)?comparison\b/.test(step)) {
    const name = nameFrom(raw, /^\s*(?:save|keep|store|bookmark)\s+(?:this\s+|the\s+|my\s+)?comparison\s+(?:as|under|named|called)\s+(.+)$/i);
    if (name === null && !/^(?:save|keep|store|bookmark)\s+(?:this\s+|the\s+|my\s+)?comparison$/.test(step)) return null;
    return plan(name ? `save the comparison as "${name}"` : 'save the comparison', async (ctx) => {
      const r = await ctx.run('saveComparison', name ? { name } : {});
      const saved = isObject(r.saved) ? r.saved : {};
      return [
        `Saved the comparison as "${str(saved, 'name') ?? name ?? '?'}" (${r.replaced === true ? 'it replaces the one saved under that name' : `${plural(num(r, 'count') ?? 1, 'saved comparison')} now`}), with the simulated clock and the requirements.`,
        str(r, 'droppedOldest') ? `The oldest one, "${str(r, 'droppedOldest')}", was dropped to make room.` : '',
        str(r, 'note') ?? '',
      ].filter(Boolean).join(' ');
    });
  }
  const load = nameFrom(raw, /^\s*(?:load|open|restore|bring back)\s+(?:the\s+)?(?:saved\s+)?comparison\s+(?:called\s+|named\s+)?(.+)$/i);
  if (load && /^(?:load|open|restore|bring back)\b/.test(step)) {
    return plan(`load the saved comparison "${load}"`, async (ctx) => {
      const r = await ctx.run('loadComparison', { name: load });
      const clock = str(r, 'restored.clockUtc');
      return `Loaded "${str(r, 'loaded') ?? load}" (saved ${utc(str(r, 'savedUtc'))})${clock ? `; the clock is back at ${utc(clock)}, paused` : ''}. ${labelsText(r)}`;
    });
  }
  const del = nameFrom(raw, /^\s*(?:delete|remove|forget)\s+(?:the\s+)?(?:saved\s+)?comparison\s+(?:called\s+|named\s+)?(.+)$/i);
  if (del && /^(?:delete|remove|forget)\b/.test(step)) {
    return plan(`delete the saved comparison "${del}"`, async (ctx) => {
      const r = await ctx.run('deleteComparison', { name: del });
      return `Deleted the saved comparison "${str(r, 'deleted') ?? del}"; ${plural(num(r, 'count') ?? 0, 'saved comparison')} left. Slots A and B are not touched.`;
    });
  }
  const tab = /^(?:open|show|switch to)\s+(?:the\s+)?(nearby(?: sites)?|a and b|compare|comparison|window table|windows|outlook)\s+tab$/.exec(step) ?? /^(?:open|show)\s+(?:the\s+)?(window table)$/.exec(step);
  if (tab || /^(?:open|show)\s+(?:the\s+)?(?:compare|comparison)\s+panel$/.test(step)) {
    const word = tab?.[1] ?? '';
    const which = !tab ? undefined : word.startsWith('nearby') ? 'nearby' : word.startsWith('window') ? 'windows' : word === 'outlook' ? 'outlook' : 'compare';
    const title: Record<string, string> = { compare: 'A and B', nearby: 'Nearby sites', windows: 'Window table', outlook: 'Outlook' };
    return plan(`open the compare panel${which ? ` on its "${title[which]}" tab` : ''}`, async (ctx) => {
      const r = await ctx.run('openCompare', which ? { tab: which } : {});
      const empty = Array.isArray(r.emptySlots) && r.emptySlots.length ? ` Empty: slot ${r.emptySlots.join(' and ')}.` : '';
      return `The compare panel is open on its "${title[str(r, 'tab') ?? 'compare'] ?? str(r, 'tab')}" tab. ${labelsText(r)}${empty}`;
    });
  }
  return null;
};

// ---------------------------------------------------------------- the seasonal outlook

function arrivalText(a: unknown): string {
  if (!isObject(a)) return UNAVAILABLE;
  return `${utc(str(a, 'arrivalUtc'))}: score ${num(a, 'score') ?? UNAVAILABLE}, sunlight ${percent(num(a, 'illuminationPct'))}, Earth's centre in view ${percent(num(a, 'earthVisiblePct'))}, longest darkness ${num(a, 'longestDarknessH') === undefined ? UNAVAILABLE : span(num(a, 'longestDarknessH'))}`;
}

export const outlook: Intent = (step) => {
  const asks = /\b(seasonal )?outlook\b/.test(step) || /^(?:what is |what's |when is |show (?:me )?)?the (best|worst) (?:arrival|time to arrive|landing date)\b/.test(step) || /\bwhat (?:does|would) a slip\b/.test(step);
  if (!asks || /\btab$/.test(step) || /^(compare|hide|close)\b/.test(step)) return null;
  const months = /\b(\d+)\s*(?:lunar\s+)?months?\b/.exec(step);
  const params: Json = months ? { months: Number(months[1]) } : {};
  return plan(`show the seasonal outlook${months ? ` over ${months[1]} lunar months` : ''}`, async (ctx) => {
    const r = await ctx.run('showOutlook', params);
    const sp = isObject(r.span) ? r.span : {};
    const lines = [`Seasonal outlook for ${str(r, 'scenario.label') ?? 'the scenario on screen'} over ${num(r, 'months') ?? '?'} lunar months (${utc(str(sp, 'startUtc'))} to ${utc(str(sp, 'endUtc'))}), for a ${num(r, 'missionH') === undefined ? '' : `${span(num(r, 'missionH'))} `}mission:`];
    lines.push(`- planned arrival ${arrivalText(r.planned)}`);
    lines.push(`- best arrival ${arrivalText(r.best)}`);
    lines.push(`- worst arrival ${arrivalText(r.worst)}`);
    const slips = (Array.isArray(r.slips) ? r.slips : []).filter(isObject);
    if (slips.length) lines.push(`Slips: ${slips.map((x) => `${num(x, 'slipDays') ?? '?'} d: score ${num(x, 'scoreChange') ?? '?'} (sunlight ${num(x, 'illuminationChangePct') ?? '?'} points, Earth's centre in view ${num(x, 'earthVisibleChangePct') ?? '?'} points)`).join('; ')}.`);
    if (isObject(r.longestDarkness)) lines.push(`Longest darkness in the span: ${span(num(r, 'longestDarkness.hours'))} from ${utc(str(r, 'longestDarkness.startUtc'))}${r.longestDarkness.endFound === false ? ', its end not found in the span' : ''}.`);
    if (str(r, 'scoring')) lines.push(`Scoring: ${str(r, 'scoring')}.`);
    const notes = [...(Array.isArray(r.highlights) ? r.highlights : []), ...(Array.isArray(r.assumptions) ? r.assumptions.slice(0, 2) : [])].filter((x): x is string => typeof x === 'string');
    if (notes.length) lines.push(notes.join(' '));
    lines.push('The outlook is on the "Outlook" tab of the compare panel.');
    return lines.join('\n');
  });
};

// ---------------------------------------------------------------- mission presets and flags

const wordsOf = (text: string) => text.toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim().split(' ').filter((w) => w && !['the', 'mission', 'preset', 'of', 'at', 'a', 'replay'].includes(w));

export const presets: Intent = (step) => {
  if (/^(?:list|show|which are|what are)\s+(?:the\s+|all\s+)?(?:mission\s+)?(?:presets|replays|missions to replay|missions i can replay)$|^(?:which|what)\s+missions?\s+can\s+i\s+replay$|^what can i replay$/.test(step)) {
    return plan('list the missions that can be replayed', async (ctx) => {
      const r = await ctx.run('listPresets');
      const list = (Array.isArray(r.presets) ? r.presets : []).filter(isObject);
      if (!list.length) return 'No mission presets are loaded in this build.';
      return [
        `${plural(list.length, 'mission')} can be replayed from bundled data${str(r, 'loaded') ? ` (on screen now: ${str(r, 'loaded')})` : ''}:`,
        ...list.map((x) => `- ${str(x, 'title') ?? str(x, 'id')} (say "replay ${str(x, 'id')}"): ${utc(str(x, 'missionWindow.startUtc'))} for ${span(num(x, 'missionWindow.durationH'))}, clock from ${utc(str(x, 'clockStartsUtc'))}, ${str(x, 'view') === 'surface' ? 'surface view' : 'globe view'}${str(x, 'caveat') ? `. Caveat: ${str(x, 'caveat')!.replace(/\.$/, '')}` : ''}`),
      ].join('\n');
    });
  }
  const m = /^(?:replay|play back|load)\s+(?:the\s+)?(?:mission\s+)?(?:preset\s+)?(.+?)(?:\s+preset)?$/.exec(step) ?? /^play\s+(?:the\s+)?(eclipse.*|.+\s+(?:landing|preset))$/.exec(step);
  if (!m || /^(the\s+)?(clock|time|simulation|animation|playback)$/.test(m[1]) || /^comparison\b/.test(m[1])) return null;
  const wanted = m[1];
  return plan(`replay the mission "${wanted}"`, async (ctx) => {
    if (!ctx.has('loadPreset')) throw new Halt('This build of Lunyx has no mission presets to replay.');
    const list = ((await ctx.run('listPresets')).presets as unknown[] | undefined ?? []).filter(isObject);
    const w = wordsOf(wanted);
    const byId = list.filter((x) => (str(x, 'id') ?? '') === wanted.trim() || w.every((t) => wordsOf(str(x, 'id') ?? '').includes(t)));
    const byTitle = list.filter((x) => w.every((t) => wordsOf(`${str(x, 'title') ?? ''} ${str(x, 'description') ?? ''}`).includes(t)));
    const hits = byId.length ? byId : byTitle;
    if (hits.length !== 1) {
      const names = list.map((x) => `"${str(x, 'id')}" (${str(x, 'title')})`).join(', ');
      throw new Halt(hits.length ? `"${wanted}" fits ${hits.length} presets: ${hits.map((x) => str(x, 'id')).join(', ')}. Say which.` : `No preset matches "${wanted}". Presets: ${names}.`);
    }
    const r = await ctx.run('loadPreset', { id: str(hits[0], 'id')! });
    // What is uncertain or computed rather than reported, as the preset list says it on screen (T-67).
    const caveats = [str(r, 'caveat'), str(r, 'sunBehindEarth.reported')].filter((x): x is string => Boolean(x));
    return `Replaying ${str(r, 'preset.title') ?? str(hits[0], 'title')}: ${siteText(r.site)}, clock at ${utc(str(r, 'timeUtc'))}${r.playing === true ? `, running at ${span((num(r, 'rateSimSecondsPerSecond') ?? NaN) / 3600)} per second` : ', paused'}, ${str(r, 'view') === 'surface' ? 'in the surface view' : 'on the globe'}; mission window ${utc(str(r, 'missionWindow.startUtc'))} to ${utc(str(r, 'missionWindow.endUtc'))}.${caveats.length ? ` ${caveats.join(' ')}` : ''}`;
  });
};

export const flags: Intent = (step) => {
  const m = /^(show|display|turn on|enable|hide|remove|turn off|disable)\s+(?:the\s+)?(?:country\s+|national\s+)?flags(?:\s+on the (?:markers|globe|landings))?$/.exec(step);
  if (!m) return null;
  const show = !/hide|remove|off|disable/.test(m[1]);
  return plan(`${show ? 'show' : 'hide'} the country flags on the landing markers`, async (ctx) => {
    const r = await ctx.run('showFlags', { show });
    if (r.showFlags !== true) return 'The country flags are hidden.';
    // The flags ride on the landing markers: none is drawn while previous missions are hidden
    // (flagsShown from T-67 on; before it, getState.showMissions).
    const drawn = typeof r.flagsShown === 'boolean' ? r.flagsShown : (await ctx.state()).showMissions !== false;
    if (!drawn) return `Country flags are switched on, but no flag is drawn ${await notDrawnWhy(ctx)}. ${FLAG_RULE}`;
    return `Each landing marker now carries the flag of the state its hardware belongs to (GCAT catalogue; USSR hardware is shown as Russia). ${FLAG_RULE}`;
  });
};

/**
 * Why a layer that is switched on is not drawn: the landing markers are hidden, or the mission
 * filters let no landing through (T-67: territoriesShown and flagsShown are false in both cases).
 */
async function notDrawnWhy(ctx: { state(): Promise<Json> }): Promise<string> {
  const st = await ctx.state();
  if (st.showMissions === false) return 'while previous missions are hidden (say "show previous missions" to see them)';
  if (num(st, 'missionsShown.shown') === 0) return 'while the mission filters hide every landing (say "reset the filters" to see them)';
  return 'now';
}

/** Said with the flags: they are about the hardware, not the ground. */
const FLAG_RULE = 'A flag names who the hardware belongs to, not a claim to the ground: no country owns lunar ground.';
/** Said with the territories until a result gives its own territoryRule (T-67). */
const TERRITORY_WORDS = 'It shows who landed nearest, not ownership: no country owns lunar ground.';

export const territories: Intent = (step) => {
  const m = /^(show|display|turn on|enable|hide|remove|turn off|disable)\s+(?:the\s+)?(?:country\s+)?territor(?:y|ies)(?:\s+(?:colours?|colors?|colouring|coloring))?(?:\s+on the globe)?$/.exec(step);
  if (!m) return null;
  const show = !/hide|remove|off|disable/.test(m[1]);
  return plan(`${show ? 'show' : 'hide'} the country territories on the globe`, async (ctx) => {
    const r = await ctx.run('showTerritories', { show });
    if (r.showTerritories !== true) return 'The country territories are hidden.';
    const rule = str(r, 'territoryRule') ?? TERRITORY_WORDS;
    // Drawn only while previous missions are shown (globeView: showMissions && showTerritories; the checkbox is disabled otherwise).
    const drawn = typeof r.territoriesShown === 'boolean' ? r.territoriesShown : (await ctx.state()).showMissions !== false;
    return drawn
      ? `The globe is coloured by the country of the nearest landing shown. ${rule}`
      : `Country territories are switched on, but nothing is drawn ${await notDrawnWhy(ctx)}. ${rule}`;
  });
};

// ---------------------------------------------------------------- the site card's records, the real clock

const THIS_SITE = '(?:\\s+(?:it|this|this site|the site|this landing|the landing|here|this lander|the lander|this hardware|the hardware))?';

/**
 * The card's "Belongs to", "Owner" and "Explored" rows, read from getState's site (T-44: the
 * GCAT record and the explored area, with their sources). The current site only: a name in the
 * question is not looked up, so the answer is never about a different site than the card's.
 */
export const siteRecords: Intent = (step) => {
  const owner = new RegExp(`^(?:who\\s+(?:owns|operates|built|landed|is responsible for)${THIS_SITE}|who\\s+does${THIS_SITE}\\s+belong to|(?:what|which)\\s+(?:country|state|nation)\\s+(?:does${THIS_SITE}\\s+belong to|(?:owns|is responsible for)${THIS_SITE}|is${THIS_SITE}\\s+from)|whose\\s+(?:site|lander|hardware|landing)(?:\\s+is\\s+(?:this|it))?|(?:ownership|owner)(?:\\s+of${THIS_SITE})?)$`).test(step);
  const explored = /^(?:how (?:big|large|wide) is the explored area|(?:what is |show )?the explored area|explored area|how much (?:was|has been|is) explored(?: here)?|how far did (?:it|they) (?:go|explore|travel))$/.test(step);
  if (!owner && !explored) return null;
  return plan(owner ? 'say who the hardware at this site belongs to' : 'say how big the explored area at this site is', async (ctx) => {
    const s = await ctx.state();
    const site = s.site;
    if (!isObject(site)) throw new Halt('No site is selected. Select a landing site first.');
    const name = str(site, 'name') ?? 'This site';
    if (str(site, 'kind') !== 'landing') throw new Halt(`${name} is not a catalogued landing, so it has no ownership record and no explored area.`);
    if (owner) {
      const o = site.ownership;
      if (o === undefined) throw new Halt('This build does not report who a site belongs to.');
      if (!isObject(o)) return `No ownership record is available for ${name}.`;
      return [
        `${name} belongs to ${str(o, 'state') ?? UNAVAILABLE}${str(o, 'stateCode') ? ` (GCAT state code ${str(o, 'stateCode')})` : ''}; owner: ${str(o, 'owner') ?? UNAVAILABLE}${str(o, 'gcatId') ? `, GCAT id ${str(o, 'gcatId')}` : ''}.`,
        ...(str(o, 'note') ? [str(o, 'note')!] : []),
        ...(str(o, 'source') ? [`Source: ${str(o, 'source')}.`] : []),
      ].join(' ');
    }
    const a = site.exploredArea;
    if (a === undefined) throw new Halt('This build does not report the explored area of a site.');
    if (!isObject(a)) return `The explored area of ${name} is not available.`;
    return [
      `The explored area at ${name}: ${str(a, 'description') ?? UNAVAILABLE}${num(a, 'areaM2') !== undefined ? `, ${Math.round(num(a, 'areaM2')!).toLocaleString('en-GB')} m²` : ''} (true size).`,
      ...(a.located === false ? ['The lander has not been found in LRO images: this is the lander alone at the catalogue\'s approximate position.'] : []),
      ...(str(a, 'note') ? [str(a, 'note')!] : []),
      ...(str(a, 'source') ? [`Source: ${str(a, 'source')}.`] : []),
    ].join(' ');
  });
};

/** The real date and time on the user's computer (getState.wallClockUtc, T-44), next to the simulated clock. */
export const realClock: Intent = (step) => {
  if (!/^(?:what(?:'s| is) the (?:real|actual|current real|real-world|wall[- ]clock) (?:time|date)(?: now)?|what (?:time|date|day) is it (?:really|in the real world|actually|for real)|real (?:time|date|clock)|wall[- ]?clock|what is today's date)$/.test(step)) return null;
  return plan('say the real date and time', async (ctx) => {
    const s = await ctx.state();
    const real = str(s, 'wallClockUtc');
    if (!real) throw new Halt('This build does not report the real clock. The simulated time is on the time slider.');
    return `The real date and time on this computer is ${utc(real)}. The simulated clock shows ${utc(str(s, 'timeUtc'))}${s.playing === true ? ' and is running' : ' and is paused'}. "Start the mission window now in real time" starts the window at the real time.`;
  });
};

/** For the help text: one example per group, shown only when the build has the action. */
export const LATER_HELP: [needs: string[], text: string][] = [
  [['setReliefExaggeration'], 'Globe drawing: "relief x5", "true scale relief", "relief off", "show elevation coverage", "show the ice targets"'],
  [['getSiteScience'], 'Site science: "dsn stations", "long-term averages here", "temperature", "shadowcam", "site science"'],
  [['nearestIceTargets'], 'Ice targets: "nearest ice targets", "how far is the nearest ice"'],
  [['walkTo'], 'Walking (surface): "walk 200 m north", "walk to 100 m east 50 m north", "rise 20 m", "return to the site"'],
  [['setFieldOfView'], 'Surface view: "face the sun", "field of view 10", "hide the sky paths", "what is the ground made of"'],
  [['setChart'], 'Surface HUD: "show the skyline chart", "expand the chart", "chart against time", "show the chart as a table", "fold the key metrics", "close the explanation"'],
  [['setBodyTracking'], 'Tracking (surface): "track the sun", "follow earth", "stop tracking"'],
  [['setSurfacePanel'], 'Surface panels: "fold the time panel", "move the locator map to 300, 200", "move the compare panel left by 100", "reset the panels", "list the surface panels"'],
  [['listSites'], 'Catalogue: "list the landing sites"'],
  [['saveComparison'], 'Saved comparisons: "save this comparison as Baseline", "list saved comparisons", "load comparison Baseline", "swap A and B", "clear slot B"'],
  [['showOutlook'], 'Outlook: "show the seasonal outlook", "outlook for 6 months", "show the window table", "export the results as csv"'],
  [['loadPreset'], 'Replays: "list the presets", "replay the eclipse", "replay IM-2 landing"'],
  [['showFlags'], 'Flags: "show country flags", "hide the flags"'],
  [['showTerritories'], 'Territories: "show territories", "hide territory colours"'],
  [['getState'], 'Site records and the real clock: "who owns this site", "how big is the explored area", "what is the real time"'],
];
