// The pieces every deterministic intent shares: what a plan is, how an intent is written, and
// the sentences and site wording that several intents use, so replies say them the same way.
import type { Ctx } from './context';
import { coordinates, isObject, num, str, utc } from './format';

export interface Plan {
  /** What the plan will do, in a few words (shown when another part of the request was not understood). */
  does: string;
  run(ctx: Ctx): Promise<string>;
}

/** Matches one step of a request (normalised, and as typed) and returns its plan, or null. */
export type Intent = (step: string, raw: string) => Plan | null;

export const plan = (does: string, run: Plan['run']): Plan => ({ does, run });

export const EARTH_NOTE = "Earth figures are geometric line of sight to Earth's centre over the terrain, not a guarantee of a working radio link.";

/** "IM-2 Athena (latitude -84.7900°, longitude 29.2000° (east-positive), landed 2025-03-06 17:28 UTC)". */
export function siteText(site: unknown): string {
  if (!isObject(site)) return 'no site';
  const name = str(site, 'name') ?? 'the site';
  const where = coordinates(num(site, 'latDeg'), num(site, 'lonDegEast'));
  const landed = str(site, 'landedUtc');
  return `${name} (${where}${landed ? `, landed ${utc(landed)}` : ''})`;
}
