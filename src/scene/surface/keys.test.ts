import { describe, expect, it } from 'vitest';
import { BUTTON_SELECTOR, FIELD_SELECTOR, focusPlace, surfaceCommand, WIDGET_SELECTOR, type FocusPlace, type FocusProbe } from './keys';

const key = (k: string, code = k, extra: Partial<KeyboardEvent> = {}) => ({ key: k, code, ...extra });
const ARROWS = [
  ['ArrowLeft', -1, 0],
  ['ArrowRight', 1, 0],
  ['ArrowUp', 0, 1],
  ['ArrowDown', 0, -1],
] as const;

describe('surface view keys', () => {
  it('turns the view with the arrow keys from the scene and from a button, without clicking the scene first', () => {
    for (const place of ['scene', 'button'] as FocusPlace[]) {
      for (const [k, dAz, dEl] of ARROWS) expect(surfaceCommand(key(k), place), `${k} on ${place}`).toEqual({ kind: 'look', dAz, dEl });
    }
  });

  it('leaves every key to a text field, selector or slider, Escape included', () => {
    for (const k of ['ArrowLeft', 'ArrowUp', 'Escape', '+', '-']) expect(surfaceCommand(key(k), 'field'), k).toBeNull();
    expect(surfaceCommand(key('w', 'KeyW'), 'field')).toBeNull();
  });

  it('leaves its keys to a widget (the chart, a scrolling table) but still leaves the view on Escape', () => {
    for (const [k] of ARROWS) expect(surfaceCommand(key(k), 'widget'), k).toBeNull();
    expect(surfaceCommand(key('w', 'KeyW'), 'widget')).toBeNull();
    expect(surfaceCommand(key('Escape'), 'widget')).toEqual({ kind: 'exit' });
  });

  it('lets a focused button keep Space and Enter, and nothing else', () => {
    expect(surfaceCommand(key(' ', 'Space'), 'button')).toBeNull();
    expect(surfaceCommand(key('Enter'), 'button')).toBeNull();
    expect(surfaceCommand(key('Enter', 'NumpadEnter'), 'button')).toBeNull();
    expect(surfaceCommand(key('w', 'KeyW'), 'button')).toEqual({ kind: 'walk', code: 'KeyW' });
    // On the scene Space is "rise".
    expect(surfaceCommand(key(' ', 'Space'), 'scene')).toEqual({ kind: 'walk', code: 'Space' });
  });

  it('walks, zooms and leaves from the scene', () => {
    for (const code of ['KeyW', 'KeyA', 'KeyS', 'KeyD', 'KeyQ', 'KeyE', 'ShiftLeft']) expect(surfaceCommand(key(code.slice(3).toLowerCase(), code), 'scene')).toEqual({ kind: 'walk', code });
    expect(surfaceCommand(key('+', 'Equal'), 'scene')).toEqual({ kind: 'zoom', dir: -1 });
    expect(surfaceCommand(key('=', 'Equal'), 'scene')).toEqual({ kind: 'zoom', dir: -1 });
    expect(surfaceCommand(key('-', 'Minus'), 'scene')).toEqual({ kind: 'zoom', dir: 1 });
    expect(surfaceCommand(key('Escape'), 'scene')).toEqual({ kind: 'exit' });
    expect(surfaceCommand(key('Escape'), 'button')).toEqual({ kind: 'exit' });
    expect(surfaceCommand(key('x', 'KeyX'), 'scene')).toBeNull();
  });

  it('takes nothing with a modifier held, nor a key something else has already handled', () => {
    expect(surfaceCommand(key('ArrowLeft', 'ArrowLeft', { ctrlKey: true }), 'scene')).toBeNull();
    expect(surfaceCommand(key('ArrowLeft', 'ArrowLeft', { altKey: true }), 'scene')).toBeNull();
    expect(surfaceCommand(key('ArrowLeft', 'ArrowLeft', { metaKey: true }), 'scene')).toBeNull();
    // The chart closes its explanation on Escape and marks the key as handled: the view stays.
    expect(surfaceCommand(key('Escape', 'Escape', { defaultPrevented: true }), 'widget')).toBeNull();
  });
});

describe('where the focus is', () => {
  const probe = (is: { field?: boolean; button?: boolean; widget?: boolean; scrolls?: boolean; scene?: boolean }): FocusProbe => ({
    scene: Boolean(is.scene),
    scrolls: Boolean(is.scrolls),
    within: (selector) => (selector === FIELD_SELECTOR ? Boolean(is.field) : selector === BUTTON_SELECTOR ? Boolean(is.button) : selector === WIDGET_SELECTOR ? Boolean(is.widget) : false),
  });

  it('puts the scene canvas, the page and no focus at the scene', () => {
    expect(focusPlace(probe({ scene: true, widget: true }))).toBe('scene');
    expect(focusPlace(probe({}))).toBe('scene');
  });

  it('ranks a field above a button above a widget or scroller', () => {
    // A text field inside a focusable panel is a field; a button inside a widget is a button.
    expect(focusPlace(probe({ field: true, widget: true }))).toBe('field');
    expect(focusPlace(probe({ button: true, widget: true }))).toBe('button');
    expect(focusPlace(probe({ widget: true }))).toBe('widget');
    // A panel the browser made focusable because it scrolls keeps the arrow keys for scrolling.
    expect(focusPlace(probe({ scrolls: true }))).toBe('widget');
  });

  it('treats programmatic focus targets (tabindex -1) as part of the page, not as widgets', () => {
    expect(WIDGET_SELECTOR).toContain('[tabindex]:not([tabindex="-1"])');
    expect(FIELD_SELECTOR).toContain('[role="slider"]');
  });
});
