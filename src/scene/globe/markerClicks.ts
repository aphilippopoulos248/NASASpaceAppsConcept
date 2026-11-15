// What clicks on the globe's landing markers do (lunyx-experience Q-9).
//
// - A click shows a landing's details: the nearest marker under the pointer, or, where markers
//   overlap and one of them is the landing already shown, the next one in turn (slower repeated
//   clicks take turns: Apollo 12 / Surveyor 3, Apollo 11 / Surveyor 5 from far out).
// - A double-click opens the surface view of the landing whose details are shown.
//
// The first click of a double-click cannot be told from a slower click when it happens. So a
// click on the landing already shown, where others overlap it, waits out the double-click time
// before taking the next one's turn: a second click within that time opens the shown landing
// instead, and the first click never moves the cycle on.

/** Two clicks this close in time (ms) and place (px) make a double-click. */
export const DOUBLE_CLICK_MS = 500;
export const DOUBLE_CLICK_PX = 5;

export type MarkerClickAction =
  /** Select the landing (the camera stays) and show its details. */
  | { kind: 'show'; id: string }
  /** Open the surface view of the landing. */
  | { kind: 'surface'; id: string };

export interface MarkerClickOptions {
  /** Carries out what a click decided. */
  act: (action: MarkerClickAction) => void;
  /** The landing whose details are shown now (the selected site's id), or null. */
  shown: () => string | null;
  /** Timers, replaceable in tests. */
  schedule?: (fn: () => void, ms: number) => unknown;
  cancel?: (handle: unknown) => void;
}

export class MarkerClicks {
  /** The last click on a marker, which a second click can turn into a double-click on `id`. */
  private last: { id: string; x: number; y: number; time: number } | null = null;
  /** A turn to the next overlapping landing, waiting for the double-click time to pass. */
  private pending: unknown = null;
  private readonly opts: Required<MarkerClickOptions>;

  constructor(options: MarkerClickOptions) {
    this.opts = {
      schedule: (fn, ms) => setTimeout(fn, ms),
      cancel: (handle) => clearTimeout(handle as ReturnType<typeof setTimeout>),
      ...options,
    };
  }

  /**
   * A click (a press and release without a drag) on the markers `ids`, nearest first, at client
   * position x, y and time `time` (ms, as Event.timeStamp).
   */
  click(ids: readonly string[], x: number, y: number, time: number): void {
    if (!ids.length) return this.reset();
    const prev = this.last;
    this.cancelPending();
    if (prev && time - prev.time < DOUBLE_CLICK_MS && Math.hypot(x - prev.x, y - prev.y) <= DOUBLE_CLICK_PX && ids.includes(prev.id)) {
      this.last = null;
      this.opts.act({ kind: 'surface', id: prev.id });
      return;
    }
    const shown = this.opts.shown();
    const at = shown === null ? -1 : ids.indexOf(shown);
    if (at < 0) {
      // None of these is shown yet: show the nearest at once.
      this.last = { id: ids[0], x, y, time };
      this.opts.act({ kind: 'show', id: ids[0] });
      return;
    }
    // On the landing already shown: perhaps the first click of a double-click on it.
    this.last = { id: shown!, x, y, time };
    if (ids.length === 1) {
      this.opts.act({ kind: 'show', id: shown! });
      return;
    }
    const next = ids[(at + 1) % ids.length];
    this.pending = this.opts.schedule(() => {
      this.pending = null;
      // Only if nothing else changed the selection meanwhile.
      if (this.opts.shown() !== shown) return;
      this.opts.act({ kind: 'show', id: next });
    }, DOUBLE_CLICK_MS);
  }

  /** A drag, a click on empty ground or leaving the globe: no double-click spans it, and no turn is still to come. */
  reset(): void {
    this.cancelPending();
    this.last = null;
  }

  private cancelPending(): void {
    if (this.pending !== null) this.opts.cancel(this.pending);
    this.pending = null;
  }
}
