// Missions to replay: the presets in public/data/presets.json, read once at boot.
//
// A preset is a site from the landing catalogue, a mission window, a clock time, a view and a
// playback rate: everything needed to put a real, bundled window on screen and play it in one
// step (the loadPreset action, src/core/presetActions.ts). The file is data, so it is checked
// when it is read: a preset that does not parse is refused with a sentence, never half-used.
import { parseUtc } from '../core/time';
import type { ViewMode } from '../core/types';

export interface PresetLook {
  /** The body to face when the surface view opens. */
  towards: 'sun' | 'earth';
  /** Vertical field of view, degrees. */
  fovDeg: number;
  /** Aim this many degrees above (+) or below (-) the body's centre, to place it higher or lower on screen. */
  elOffsetDeg?: number;
}

/** Earth passing in front of the Sun, as the app computes it for the preset's site (to the minute, UTC). */
export interface PresetEclipse {
  partlyCoveredFromMs: number;
  entirelyHiddenFromMs: number;
  entirelyHiddenUntilMs: number;
  clearAgainMs: number;
  /** What was reported for the mission, with its source, in one sentence. */
  reported: string;
}

export interface MissionPreset {
  id: string;
  title: string;
  /** One line: what plays. */
  description: string;
  /** A landing in the catalogue. */
  siteId: string;
  windowStartMs: number;
  windowDurationH: number;
  /** Where the clock starts, inside the window. */
  clockMs: number;
  view: ViewMode;
  look?: PresetLook;
  /** Simulated seconds per real second. */
  rate: number;
  /** Start playing once everything is on screen. */
  play: boolean;
  sunBehindEarth?: PresetEclipse;
  /** What in this replay is uncertain or computed rather than reported, in one sentence: shown on screen with it. */
  caveat?: string;
  /** Where the data comes from, one sentence each. */
  sources: string[];
}

const HOUR_MS = 3_600_000;

/** Checks and converts the file's content. Throws an Error that names the preset and the field. */
export function parsePresets(json: unknown): MissionPreset[] {
  const list = (json as { presets?: unknown })?.presets;
  if (!Array.isArray(list)) throw new Error('presets.json: "presets" must be a list.');
  const seen = new Set<string>();
  return list.map((raw, i) => {
    const p = raw as Record<string, unknown>;
    const where = `presets.json, preset ${typeof p?.id === 'string' ? `"${p.id}"` : i + 1}`;
    const fail = (what: string): never => {
      throw new Error(`${where}: ${what}`);
    };
    const text = (key: string): string => {
      const v = p[key];
      return typeof v === 'string' && v.trim() ? v.trim() : fail(`"${key}" must be text.`);
    };
    const num = (key: string, min: number, max: number, v: unknown = p[key]): number =>
      typeof v === 'number' && Number.isFinite(v) && v >= min && v <= max ? v : fail(`"${key}" must be a number from ${min} to ${max}.`);
    const utc = (key: string, v: unknown = p[key]): number => {
      try {
        if (typeof v === 'string') return parseUtc(v);
      } catch {
        // falls through to the message below
      }
      return fail(`"${key}" must be a UTC time such as 2025-03-14T04:52Z.`);
    };
    if (typeof p !== 'object' || p === null) fail('must be an object.');

    const id = text('id');
    if (!/^[a-z0-9][a-z0-9-]*$/.test(id)) fail('"id" may hold lower-case letters, digits and hyphens only.');
    if (seen.has(id)) fail('this id is used twice.');
    seen.add(id);

    const windowStartMs = utc('windowStartUtc');
    const windowDurationH = num('windowDurationH', 1, 24 * 60);
    const clockMs = utc('clockUtc');
    if (clockMs < windowStartMs || clockMs > windowStartMs + windowDurationH * HOUR_MS) fail('"clockUtc" must lie inside the mission window.');
    const view = p.view === 'globe' || p.view === 'surface' ? p.view : fail('"view" must be "globe" or "surface".');

    let look: PresetLook | undefined;
    if (p.look !== undefined) {
      const l = p.look as Record<string, unknown>;
      if (view !== 'surface') fail('"look" is for the surface view only.');
      if (l?.towards !== 'sun' && l?.towards !== 'earth') fail('"look.towards" must be "sun" or "earth".');
      look = { towards: l.towards as 'sun' | 'earth', fovDeg: num('look.fovDeg', 4, 100, l.fovDeg), ...(l.elOffsetDeg !== undefined && { elOffsetDeg: num('look.elOffsetDeg', -45, 45, l.elOffsetDeg) }) };
    }

    let sunBehindEarth: PresetEclipse | undefined;
    if (p.sunBehindEarth !== undefined) {
      const e = p.sunBehindEarth as Record<string, unknown>;
      const t = (key: string) => utc(`sunBehindEarth.${key}`, e?.[key]);
      sunBehindEarth = {
        partlyCoveredFromMs: t('partlyCoveredFromUtc'),
        entirelyHiddenFromMs: t('entirelyHiddenFromUtc'),
        entirelyHiddenUntilMs: t('entirelyHiddenUntilUtc'),
        clearAgainMs: t('clearAgainUtc'),
        reported: typeof e.reported === 'string' && e.reported.trim() ? e.reported.trim() : fail('"sunBehindEarth.reported" must be text.'),
      };
      const { partlyCoveredFromMs: a, entirelyHiddenFromMs: b, entirelyHiddenUntilMs: c, clearAgainMs: d } = sunBehindEarth;
      if (!(a < b && b < c && c < d)) fail('the four "sunBehindEarth" times must be in order.');
    }

    const sources = Array.isArray(p.sources) && p.sources.length && p.sources.every((s) => typeof s === 'string' && s.trim()) ? (p.sources as string[]).map((s) => s.trim()) : fail('"sources" must list at least one sentence.');

    return {
      id,
      title: text('title'),
      description: text('description'),
      siteId: text('siteId'),
      windowStartMs,
      windowDurationH,
      clockMs,
      view,
      ...(look && { look }),
      rate: num('rateSecondsPerSecond', 1, 31_536_000),
      play: p.play === undefined ? true : typeof p.play === 'boolean' ? p.play : fail('"play" must be true or false.'),
      ...(sunBehindEarth && { sunBehindEarth }),
      ...(p.caveat !== undefined && { caveat: text('caveat') }),
      sources,
    };
  });
}

export async function loadPresets(): Promise<MissionPreset[]> {
  const res = await fetch(`${import.meta.env.BASE_URL}data/presets.json`);
  if (!res.ok) throw new Error(`presets.json: HTTP ${res.status}`);
  return parsePresets(await res.json());
}

let presets: readonly MissionPreset[] = [];
let problem: string | null = null;
const listeners = new Set<() => void>();

/** `why` says why the list is empty when the file could not be read. */
export function setPresets(list: readonly MissionPreset[], why: string | null = null): void {
  presets = [...list];
  problem = why;
  for (const fn of [...listeners]) fn();
}

/** Why no presets are on offer, when the file could not be read; null otherwise. */
export function presetProblem(): string | null {
  return problem;
}

/** The presets on offer, in the file's order (empty until the file has been read). */
export function getPresets(): readonly MissionPreset[] {
  return presets;
}

export function onPresetsChange(fn: () => void): () => void {
  listeners.add(fn);
  return () => listeners.delete(fn);
}
