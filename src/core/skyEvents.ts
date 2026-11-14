// Picking sunrise/sunset/Earthrise/Earthset events from an analysis, for the scrubber and jumpToEvent.
import type { SkyEvent } from '../analysis/types';

/** The next (or previous) event of a type relative to `timeMs`, ignoring events within 30 s of it. */
export function findEvent(events: readonly SkyEvent[], type: SkyEvent['type'], which: 'next' | 'previous', timeMs: number): SkyEvent | null {
  const list = events.filter((e) => e.type === type).sort((a, b) => a.timeMs - b.timeMs);
  const hit = which === 'next' ? list.find((e) => e.timeMs > timeMs + 30_000) : [...list].reverse().find((e) => e.timeMs < timeMs - 30_000);
  return hit ?? null;
}
