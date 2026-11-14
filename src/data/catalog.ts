// The catalogue of landing sites, loaded once at boot and shared by the globe, the
// actions and the assistant. Lookups accept an id ("apollo-11") or a name ("Apollo 11").
import type { SiteRef } from '../core/types';
import type { Landing } from './landings';

let landings: readonly Landing[] = [];

export function setLandings(list: readonly Landing[]): void {
  landings = [...list].sort((a, b) => a.date.localeCompare(b.date));
}

/** Every catalogued landing, oldest first. */
export function getLandings(): readonly Landing[] {
  return landings;
}

const norm = (s: string) => s.toLowerCase().normalize('NFKD').replace(/[^a-z0-9]/g, '');

/** Finds a landing by id, by exact name, or by a loose name ("apollo 11", "Chang'e-4", "chandrayaan 3"). */
export function findLanding(query: string, list: readonly Landing[] = landings): Landing | undefined {
  const q = query.trim();
  const n = norm(q);
  if (!n) return undefined;
  return (
    list.find((l) => l.id === q) ??
    list.find((l) => l.name.toLowerCase() === q.toLowerCase()) ??
    list.find((l) => norm(l.id) === n || norm(l.name) === n) ??
    // "Luna 17" matches "Luna 17 / Lunokhod 1"; "Lunokhod 2" matches "Luna 21 / Lunokhod 2".
    list.find((l) => l.name.split('/').some((part) => norm(part) === n))
  );
}

export function landingSite(l: Landing): SiteRef {
  return { id: l.id, name: l.name, kind: 'landing', lat: l.lat, lon: l.lon };
}
