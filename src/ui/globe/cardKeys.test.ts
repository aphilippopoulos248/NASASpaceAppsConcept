import { describe, expect, it } from 'vitest';
import type { ViewMode } from '../../core/types';
import { bindCardKeys, type CardKeyCommand, type KeyPress, type KeySource } from './cardKeys';

/**
 * A window as far as key presses go: listeners on it run in the order a browser runs them for
 * a press on something inside the page, capture-phase listeners first, then the others, each
 * group in the order it was added.
 */
class FakeWindow implements KeySource {
  private readonly listeners: { fn: (e: KeyPress) => void; capture: boolean }[] = [];
  addEventListener(_type: 'keydown', fn: (e: KeyPress) => void, capture = false): void {
    this.listeners.push({ fn, capture });
  }
  press(key: string, target: unknown = 'body'): KeyPress {
    const e: KeyPress = {
      key,
      target,
      defaultPrevented: false,
      preventDefault() {
        this.defaultPrevented = true;
      },
    };
    for (const phase of [true, false]) for (const l of this.listeners) if (l.capture === phase) l.fn(e);
    return e;
  }
}

/** The app as far as these keys go: a view, a selected site, and the log of what ran. */
function app(view: ViewMode = 'globe', site = true) {
  const state = { view, site };
  const ran: string[] = [];
  const win = new FakeWindow();
  const exitSurface = () => {
    state.view = 'globe';
    ran.push('exitSurface');
  };
  const card = () =>
    bindCardKeys(win, {
      view: () => state.view,
      hasSite: () => state.site,
      isTyping: (t) => t === 'input',
      act: (c: CardKeyCommand) => {
        ran.push(c);
        if (c === 'clearSite') state.site = false;
      },
    });
  return { state, ran, win, card, exitSurface };
}

describe('site card keys', () => {
  it('Escape in the globe view closes the card; the arrows step through the landings', () => {
    const a = app();
    a.card();
    a.win.press('ArrowRight');
    a.win.press('ArrowLeft');
    const e = a.win.press('Escape');
    expect(a.ran).toEqual(['next', 'previous', 'clearSite']);
    expect(e.defaultPrevented).toBe(true);
    expect(a.state.site).toBe(false);
  });

  it('Escape in the surface view only leaves the surface: the site stays selected', () => {
    // The surface view listens on the same window, was added first, and switches the view back
    // to the globe before the card's handler runs. It does not claim the event here: the card
    // must get this right on its own.
    const a = app('surface');
    a.win.addEventListener('keydown', (e) => {
      if (a.state.view === 'surface' && e.key === 'Escape') a.exitSurface();
    });
    a.card();
    a.win.press('Escape');
    expect(a.ran).toEqual(['exitSurface']);
    expect(a.state).toEqual({ view: 'globe', site: true });
    // The next press is a new one, in the globe view: now it closes the card.
    a.win.press('Escape');
    expect(a.ran).toEqual(['exitSurface', 'clearSite']);
  });

  it('the same holds when the surface listener is added after the card', () => {
    const a = app('surface');
    a.card();
    a.win.addEventListener('keydown', (e) => {
      if (a.state.view === 'surface' && e.key === 'Escape') a.exitSurface();
    });
    a.win.press('Escape');
    expect(a.ran).toEqual(['exitSurface']);
    expect(a.state.site).toBe(true);
  });

  it('leaves alone a press another handler has claimed', () => {
    const a = app();
    // For example the locator map, which turns the globe with the arrow keys.
    a.win.addEventListener('keydown', (e) => e.preventDefault());
    a.card();
    a.win.press('ArrowRight');
    a.win.press('Escape');
    expect(a.ran).toEqual([]);
  });

  it('does nothing without a site, while typing, or for other keys', () => {
    const none = app('globe', false);
    none.card();
    expect(none.win.press('Escape').defaultPrevented).toBe(false);
    expect(none.ran).toEqual([]);

    const a = app();
    a.card();
    a.win.press('Escape', 'input');
    a.win.press('ArrowRight', 'input');
    expect(a.win.press('a').defaultPrevented).toBe(false);
    expect(a.ran).toEqual([]);
  });

  it('in the surface view the arrows are not the card\'s', () => {
    const a = app('surface');
    a.card();
    a.win.press('ArrowRight');
    a.win.press('ArrowLeft');
    expect(a.ran).toEqual([]);
  });
});
