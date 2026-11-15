// Which state each lander belongs to, from GCAT (see scripts/fetch-gcat-landers.mjs and
// docs/DATA_SOURCES.md). Read-only: this module only loads and formats the downloaded record;
// it never changes landings.json.

export interface Ownership {
  landing: string;
  jcat: string;
  piece: string;
  name: string;
  owner: string;
  ownerName: string | null;
  state: string;
  stateName: string | null;
  stateFullName: string | null;
  stateExisted: { from: string; to: string } | null;
}

interface OwnershipFile {
  source: string;
  sourceUrl: string;
  catalogVersion: string | null;
  licence: string;
  retrieved: string;
  records: Ownership[];
}

export interface OwnershipIndex {
  byLanding: Map<string, Ownership>;
  source: string;
  sourceUrl: string;
  catalogVersion: string | null;
  retrieved: string;
}

/**
 * States that no longer exist are shown as their successor today, which holds their obligations
 * for the hardware. The records themselves (GCAT and landings.json) keep the original state.
 */
const SUCCESSORS: Record<string, { name: string; flag: string; was: string }> = {
  SU: { name: 'Russia', flag: 'RU', was: 'USSR' },
};
/** Country labels in landings.json that name a state shown under its successor. */
const LABEL_SUCCESSORS: Record<string, string> = { USSR: 'Russia' };

/** Our own country labels as GCAT writes them, so the two can be compared. */
const LABEL_TO_STATE: Record<string, string> = { USSR: 'SU', USA: 'US', China: 'CN', India: 'IN', Japan: 'J' };

export async function loadOwnership(): Promise<OwnershipIndex | null> {
  try {
    const res = await fetch(`${import.meta.env.BASE_URL}data/sources/gcat-landers.json`);
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const file = (await res.json()) as OwnershipFile;
    return {
      byLanding: new Map(file.records.map((r) => [r.landing, r])),
      source: file.source,
      sourceUrl: file.sourceUrl,
      catalogVersion: file.catalogVersion,
      retrieved: file.retrieved,
    };
  } catch (err) {
    console.warn('Ownership record unavailable', err);
    return null;
  }
}

/** Name to show for the state an object belongs to: "Russia (launched by the USSR)", "China", ... */
export function stateLabel(o: Ownership): string {
  const successor = SUCCESSORS[o.state];
  return successor ? `${successor.name} (launched by the ${successor.was})` : (o.stateName ?? o.state);
}

/** Short name only, without the note: "Russia", "China", ... */
export function stateShortName(o: Ownership): string {
  return SUCCESSORS[o.state]?.name ?? o.stateName ?? o.state;
}

/** Which flag to draw for the state an object belongs to. */
export function flagCode(o: Ownership): string {
  return SUCCESSORS[o.state]?.flag ?? o.state;
}

/** One of our own country labels as it should be shown ("USSR" is shown as "Russia"). */
export function displayCountry(label: string): string {
  return LABEL_SUCCESSORS[label] ?? label;
}

/** True when our own country label names a different state from the GCAT record. */
export function labelDisagrees(ourLabel: string, o: Ownership): boolean {
  const code = LABEL_TO_STATE[ourLabel];
  return code !== undefined ? code !== o.state : true;
}
