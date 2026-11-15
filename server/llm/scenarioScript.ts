// The "scenario" script of the scripted test model (LUNYX_LLM_SCRIPT=scenario). NOT a language
// model: a fixed policy that plays the three-step request of the brief the way a model would,
// so the browser test of that scenario (e2e/scenario/scenario.test.mjs) can run the whole
// model path (route, streaming, tool loop, follow-ups) on a machine without an API key:
//
//   "Find a flatter nearby site with a shorter blackout, compare it against this pin for the
//    same dates, then show me the ridge at Earthset."
//
// It reads which parts are asked for from the user's words (all three in one message, or one
// per message as follow-ups), decides every call from the results it is sent back (and, for a
// follow-up, from the results of earlier turns in the conversation), and writes its answer
// only from those results: every number in the text is copied from a result as it came.
import type { WireMessage } from '../../src/assistant/protocol';
import type { Script, ScriptContext, ScriptResult, ScriptStep } from './scripted';

type Json = Record<string, unknown>;
type Row = Record<string, unknown>;
const isObject = (v: unknown): v is Json => typeof v === 'object' && v !== null && !Array.isArray(v);
const n = (v: unknown): number | undefined => (typeof v === 'number' && Number.isFinite(v) ? v : undefined);

function parse(content: string): unknown {
  try {
    return JSON.parse(content);
  } catch {
    return undefined;
  }
}

/** Every successful tool result of the conversation before this turn, oldest first. */
function earlierResults(messages: readonly WireMessage[]): ScriptResult[] {
  let lastUser = -1;
  for (let i = messages.length - 1; i >= 0; i--) if (messages[i].role === 'user') { lastUser = i; break; }
  const out: ScriptResult[] = [];
  for (const m of messages.slice(0, Math.max(0, lastUser))) if (m.role === 'tool') for (const r of m.results) if (r.ok) out.push({ name: r.name, ok: true, value: parse(r.content) });
  return out;
}

/** The candidate the request asks for: flatter and with a shorter blackout than the scanned site, best-ranked first. */
export function pickCandidate(ranked: unknown): { pick: Row | null; reference: Row | null; candidates: Row[] } {
  if (!isObject(ranked)) return { pick: null, reference: null, candidates: [] };
  const reference = isObject(ranked.reference) ? ranked.reference : null;
  const candidates = (Array.isArray(ranked.candidates) ? ranked.candidates : []).filter(isObject);
  if (!reference) return { pick: null, reference, candidates };
  const rs = n(reference.slopeDeg), rd = n(reference.longestDarknessH);
  const pick = candidates.find((c) => n(c.slopeDeg) !== undefined && n(c.longestDarknessH) !== undefined && rs !== undefined && rd !== undefined && n(c.slopeDeg)! < rs && n(c.longestDarknessH)! < rd) ?? null;
  return { pick, reference, candidates };
}

interface Call {
  name: string;
  input: Json;
}

/**
 * The calls of the turn, in order. Each entry is a function of what is known so far (results
 * of this turn by name, and of earlier turns), so a call can use an earlier result. Null skips
 * the entry; a string ends the turn with that sentence (a condition that stops the plan).
 */
type Planned = (known: Known) => Call | string | null;

interface Known {
  /** The latest result of each tool, this turn first, then earlier turns. */
  get(name: string): unknown;
  /** Whether the model was given this tool. */
  has(name: string): boolean;
  /** The id of the site in the state snapshot sent with the user's message. */
  siteOnScreen(): string | undefined;
}

const FIND: Planned[] = [() => ({ name: 'rankNearby', input: {} })];

const COMPARE: Planned[] = [
  // "This pin" is the site that was scanned; put it back on screen if something else is selected now.
  (k) => {
    const { pick, reference } = pickCandidate(k.get('rankNearby'));
    if (!k.get('rankNearby')) return 'There is no earlier scan to compare against: ask for a flatter nearby site first.';
    if (!pick || !reference) return 'No nearby candidate met the conditions, so there is nothing to compare.';
    const site = k.siteOnScreen();
    if (site === reference.id) return null;
    const id = typeof reference.id === 'string' ? reference.id : '';
    return id.startsWith('pin:') || !id ? { name: 'dropPin', input: { lat: reference.latDeg, lon: reference.lonDegEast } } : { name: 'selectSite', input: { site: id, fly: false } };
  },
  () => ({ name: 'saveScenario', input: { slot: 'A' } }),
  (k) => ({ name: 'selectCandidate', input: { rank: n(pickCandidate(k.get('rankNearby')).pick!.rank) ?? 1 } }),
  () => ({ name: 'saveScenario', input: { slot: 'B' } }),
  () => ({ name: 'compare', input: {} }),
  // The scan left the compare panel on its "Nearby sites" tab: show A and B.
  (k) => (k.has('openCompare') ? { name: 'openCompare', input: { tab: 'compare' } } : null),
];

const RIDGE: Planned[] = [
  () => ({ name: 'jumpToEvent', input: { type: 'earthset' } }),
  (k) => (k.has('explainBlockage') ? { name: 'explainBlockage', input: { body: 'earth' } } : { name: 'getAnalysis', input: {} }),
  () => ({ name: 'enterSurface', input: {} }),
  (k) => {
    const b = ridgeOf(k);
    return b.azDeg === undefined ? 'The results did not say where Earth is, so I could not turn the view.' : { name: 'lookAt', input: { azDeg: b.azDeg, ...(b.skylineElDeg !== undefined && { elDeg: Math.max(-85, Math.min(85, b.skylineElDeg)) }) } };
  },
];

/** The terrain under Earth at the simulated time, from explainBlockage or from getAnalysis. */
function ridgeOf(k: Known) {
  const e = k.get('explainBlockage');
  if (isObject(e)) {
    return { azDeg: n(e.bodyAzDeg), elDeg: n(e.bodyElDeg), skylineElDeg: n(e.skylineElDeg), clearanceDeg: n(e.clearanceDeg), distanceM: n(e.ridgeDistanceM), heightM: n(e.ridgeHeightM), demName: typeof e.demName === 'string' ? e.demName : undefined, demResolutionM: n(e.demResolutionM), explanation: typeof e.explanation === 'string' ? e.explanation : undefined };
  }
  const a = k.get('getAnalysis');
  const earth = isObject(a) && isObject(a.now) && isObject(a.now.earth) ? a.now.earth : null;
  const t = earth && isObject(earth.skylineTerrain) ? earth.skylineTerrain : null;
  const km = t ? n(t.distanceKm) : undefined;
  return {
    azDeg: earth ? n(earth.azDeg) : undefined, elDeg: earth ? n(earth.elDeg) : undefined, skylineElDeg: earth ? n(earth.skylineElDeg) : undefined, clearanceDeg: earth ? n(earth.clearanceDeg) : undefined,
    distanceM: km === undefined ? undefined : km * 1000, heightM: t ? n(t.heightM) : undefined, demName: t && typeof t.demName === 'string' ? t.demName : undefined, demResolutionM: t ? n(t.demResolutionM) : undefined,
    explanation: earth && typeof earth.explanation === 'string' ? earth.explanation : undefined,
  };
}

const v = (x: unknown, unit = '') => (x === undefined || x === null ? 'unavailable' : `${x}${unit}`);

function findText(k: Known): string {
  const { pick, reference, candidates } = pickCandidate(k.get('rankNearby'));
  const r = k.get('rankNearby');
  const basis = isObject(r) && typeof r.basis === 'string' ? ` ${r.basis}` : '';
  if (!reference) return 'The scan did not report the values of this pin, so I cannot say which site is better.';
  if (!pick) return `None of the ${candidates.length} best-ranked alternatives is both flatter and darker for less time than this pin (slope ${v(reference.slopeDeg, '°')}, longest darkness ${v(reference.longestDarknessH, ' h')}).${basis}`;
  return (
    `Candidate ${v(pick.rank)} (${v(pick.name)}), ${v(pick.distanceM, ' m')} away at bearing ${v(pick.bearingDeg, '°')}, is flatter and has a shorter blackout: slope ${v(pick.slopeDeg, '°')} against ${v(reference.slopeDeg, '°')} here, longest darkness ${v(pick.longestDarknessH, ' h')} against ${v(reference.longestDarknessH, ' h')}; ` +
    `sunlight ${v(pick.illuminationPct, ' %')} against ${v(reference.illuminationPct, ' %')}, Earth in view ${v(pick.earthVisiblePct, ' %')} against ${v(reference.earthVisiblePct, ' %')}.${basis}`
  );
}

function compareText(k: Known): string {
  const c = k.get('compare');
  if (!isObject(c)) return 'The comparison did not return.';
  const d = isObject(c.diff) ? c.diff : null;
  const side = (x: unknown) => (isObject(x) ? `sunlight ${v(x.illuminationPct, ' %')}, longest darkness ${v(x.longestDarknessH, ' h')}, Earth in view ${v(x.earthVisiblePct, ' %')}, longest Earth gap ${v(x.longestEarthGapH, ' h')}, slope ${v(x.slopeDeg, '°')}` : 'unavailable');
  const sa = isObject(c.scenarioA) ? c.scenarioA : {};
  return [
    `Compared over the same mission window (${v(sa.startUtc)}, ${v(sa.durationH, ' h')}): A = ${v(c.A)}: ${side(c.analysisA)}; B = ${v(c.B)}: ${side(c.analysisB)}.`,
    d ? `B minus A: sunlight ${v(d.illuminationPct, ' points')}, longest darkness ${v(d.longestDarknessH, ' h')}, Earth in view ${v(d.earthVisiblePct, ' points')}, longest Earth gap ${v(d.longestEarthGapH, ' h')}, slope ${v(d.slopeDeg, '°')}.` : `No difference could be computed: ${v(c.error)}`,
  ].join(' ');
}

function ridgeText(k: Known): string {
  const j = k.get('jumpToEvent');
  const b = ridgeOf(k);
  const look = k.get('lookAt');
  const at = isObject(look) && isObject(look.look) ? look.look : null;
  const when = isObject(j) ? `${v(j.timeUtc)}${typeof j.label === 'string' ? ` (${j.label}${typeof j.instant === 'string' ? `: ${j.instant}` : ''})` : ''}` : 'unavailable';
  return (
    `Earthset is at ${when}. There the skyline is formed by terrain ${v(b.distanceM, ' m')} away, ${v(b.heightM, ' m')} above the reference sphere (${v(b.demName)}, ${v(b.demResolutionM, ' m')}); Earth's centre is at ${v(b.elDeg, '°')} elevation against a skyline of ${v(b.skylineElDeg, '°')} (clearance ${v(b.clearanceDeg, '°')}). ` +
    `The surface view faces azimuth ${v(at?.azDeg, '°')}. Earth visibility is geometric line of sight, not a radio link.`
  );
}

export const scenarioScript: Script = (ctx: ScriptContext): ScriptStep => {
  const text = ctx.userText.toLowerCase();
  const parts: { plan: Planned[]; say: (k: Known) => string }[] = [];
  if (/\b(nearby|alternative|flatter|blackout|near here)\b/.test(text)) parts.push({ plan: FIND, say: findText });
  if (/\bcompare\b/.test(text)) parts.push({ plan: COMPARE, say: compareText });
  if (/\bridge\b|\bearthset\b/.test(text)) parts.push({ plan: RIDGE, say: ridgeText });
  if (!parts.length) return { text: 'Scripted test model (scenario script): this script only plays the nearby / compare / ridge-at-Earthset scenario.' };

  const earlier = earlierResults(ctx.messages);
  const tools = new Set(ctx.tools.map((t) => t.name));
  const mine = ctx.results;
  const known: Known = {
    get: (name) => [...mine].reverse().find((r) => r.name === name && r.ok)?.value ?? [...earlier].reverse().find((r) => r.name === name)?.value,
    has: (name) => tools.has(name),
    siteOnScreen: () => (isObject(ctx.state) && isObject(ctx.state.site) && typeof ctx.state.site.id === 'string' ? ctx.state.site.id : undefined),
  };
  const failed = mine.find((r) => !r.ok);
  if (failed) return { text: `Scripted test model: I stopped because ${failed.name} failed: ${failed.error}` };

  // Walk the plan, matching it against the calls already made this turn (in order).
  let i = 0;
  const lines: string[] = [];
  for (const part of parts) {
    for (const step of part.plan) {
      const next = step(known);
      if (next === null) continue;
      if (typeof next === 'string') return { text: `Scripted test model: ${[...lines, next].join('\n')}` };
      if (i < mine.length) {
        i++;
        continue;
      }
      return { text: i === 0 ? 'Scripted test model (scenario script): working on it.' : '', calls: [next] };
    }
    lines.push(part.say(known));
  }
  return { text: `Scripted test model:\n${lines.join('\n')}` };
};
