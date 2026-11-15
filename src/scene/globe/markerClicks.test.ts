import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { DOUBLE_CLICK_MS, MarkerClicks, type MarkerClickAction } from './markerClicks';

/** Clicks on markers with a selection that follows what they show, as in the app. */
function setup(initial: string | null = null) {
  let shown = initial;
  const acts: MarkerClickAction[] = [];
  const clicks = new MarkerClicks({
    act: (a) => {
      acts.push(a);
      if (a.kind === 'show') shown = a.id;
    },
    shown: () => shown,
  });
  return { clicks, acts, select: (id: string | null) => (shown = id), shown: () => shown };
}

const OVERLAP = ['apollo-11', 'surveyor-5'];

describe('clicks on landing markers (Q-9)', () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it('a click shows the nearest landing at once; a double-click opens it', () => {
    const { clicks, acts } = setup();
    clicks.click(OVERLAP, 100, 100, 1000);
    expect(acts).toEqual([{ kind: 'show', id: 'apollo-11' }]);
    clicks.click(OVERLAP, 101, 100, 1200);
    expect(acts).toEqual([{ kind: 'show', id: 'apollo-11' }, { kind: 'surface', id: 'apollo-11' }]);
    vi.advanceTimersByTime(2000);
    expect(acts).toHaveLength(2);
  });

  it('click, read the card, then double-click: the surface view of the landing shown, never the next one', () => {
    const { clicks, acts } = setup();
    clicks.click(OVERLAP, 100, 100, 1000);
    vi.advanceTimersByTime(1200); // reading the card
    // The double-click: its first click must not move on to Surveyor 5.
    clicks.click(OVERLAP, 100, 100, 3000);
    expect(acts).toEqual([{ kind: 'show', id: 'apollo-11' }]);
    clicks.click(OVERLAP, 100, 100, 3150);
    vi.advanceTimersByTime(2000);
    expect(acts).toEqual([{ kind: 'show', id: 'apollo-11' }, { kind: 'surface', id: 'apollo-11' }]);
  });

  it('slower repeated clicks on overlapping markers still take turns, once the double-click time has passed', () => {
    const { clicks, acts, shown } = setup();
    clicks.click(OVERLAP, 100, 100, 1000);
    clicks.click(OVERLAP, 100, 100, 2000);
    vi.advanceTimersByTime(DOUBLE_CLICK_MS - 1);
    expect(shown()).toBe('apollo-11');
    vi.advanceTimersByTime(1);
    expect(shown()).toBe('surveyor-5');
    clicks.click(OVERLAP, 100, 100, 3000);
    vi.advanceTimersByTime(DOUBLE_CLICK_MS);
    expect(acts.map((a) => `${a.kind} ${a.id}`)).toEqual(['show apollo-11', 'show surveyor-5', 'show apollo-11']);
    // And a double-click after a turn opens the landing that turn showed.
    clicks.click(OVERLAP, 100, 100, 4000);
    clicks.click(OVERLAP, 100, 100, 4200);
    vi.advanceTimersByTime(2000);
    expect(acts.at(-1)).toEqual({ kind: 'surface', id: 'apollo-11' });
  });

  it('a landing on its own: a click shows it again at once, a double-click opens it', () => {
    const { clicks, acts } = setup('apollo-11');
    clicks.click(['apollo-11'], 50, 50, 1000);
    expect(acts).toEqual([{ kind: 'show', id: 'apollo-11' }]);
    clicks.click(['apollo-11'], 50, 52, 1300);
    expect(acts.at(-1)).toEqual({ kind: 'surface', id: 'apollo-11' });
  });

  it('two clicks too slow or too far apart are not a double-click', () => {
    const { clicks, acts } = setup();
    clicks.click(['luna-9'], 10, 10, 1000);
    clicks.click(['luna-9'], 10, 10, 1000 + DOUBLE_CLICK_MS);
    clicks.click(['luna-9'], 30, 10, 1000 + DOUBLE_CLICK_MS + 100);
    expect(acts.every((a) => a.kind === 'show')).toBe(true);
  });

  it('a drag, a click on the ground or another selection in the meantime cancels the waiting turn', () => {
    const { clicks, acts, select, shown } = setup('apollo-11');
    clicks.click(OVERLAP, 100, 100, 1000);
    clicks.reset(); // a drag or a pin dropped on empty ground
    vi.advanceTimersByTime(2000);
    expect(acts).toEqual([]);
    clicks.click(OVERLAP, 100, 100, 5000);
    select('luna-9'); // chosen from the landing list meanwhile
    vi.advanceTimersByTime(2000);
    expect(acts).toEqual([]);
    expect(shown()).toBe('luna-9');
    // No double-click across a reset.
    clicks.click(OVERLAP, 100, 100, 9000);
    clicks.reset();
    clicks.click(OVERLAP, 100, 100, 9100);
    expect(acts).toEqual([{ kind: 'show', id: 'apollo-11' }]);
  });
});
