// What a key press does in the surface view, given where the keyboard focus is. Pure, so the
// rules can be tested without a browser; controller.ts feeds it real key events.
//
// The view listens on the whole document, so a keyboard user can look around (arrow keys),
// walk (W A S D, E / Q) and zoom (+ / -) without clicking the scene first. Keys are left
// alone where they mean something else: in a text field, a selector or a slider every key
// belongs to it; a focused widget with keys of its own (the skyline chart, a scrolling table)
// keeps everything but Escape; a button that was just pressed keeps only Space and Enter.
// Escape leaves the view unless something on the way has already handled it.

export type FocusPlace =
  /** The scene canvas, the page itself, or nothing in particular. */
  | 'scene'
  /** A button, link or summary. */
  | 'button'
  /** A text field, selector, slider or anything editable. */
  | 'field'
  /** Another focusable element with keys of its own, or one that scrolls. */
  | 'widget';

export type SurfaceCommand =
  | { kind: 'look'; dAz: number; dEl: number }
  | { kind: 'walk'; code: string }
  /** -1 zooms in (narrower field of view), +1 out. */
  | { kind: 'zoom'; dir: -1 | 1 }
  | { kind: 'exit' };

export interface KeyLike {
  key: string;
  code: string;
  ctrlKey?: boolean;
  metaKey?: boolean;
  altKey?: boolean;
  defaultPrevented?: boolean;
}

export const WALK_KEYS: ReadonlySet<string> = new Set(['KeyW', 'KeyA', 'KeyS', 'KeyD', 'KeyQ', 'KeyE', 'Space', 'ShiftLeft', 'ShiftRight']);
export const LOOK_KEYS: Readonly<Record<string, readonly [number, number]>> = { ArrowLeft: [-1, 0], ArrowRight: [1, 0], ArrowUp: [0, 1], ArrowDown: [0, -1] };

/** The command for a key press at a focus place, or null when the key is not the view's to take. */
export function surfaceCommand(e: KeyLike, place: FocusPlace): SurfaceCommand | null {
  if (e.ctrlKey || e.metaKey || e.altKey || e.defaultPrevented) return null;
  if (place === 'field') return null;
  if (e.key === 'Escape') return { kind: 'exit' };
  if (place === 'widget') return null;
  if (place === 'button' && (e.code === 'Space' || e.code === 'Enter' || e.code === 'NumpadEnter')) return null;
  const look = LOOK_KEYS[e.code];
  if (look) return { kind: 'look', dAz: look[0], dEl: look[1] };
  if (WALK_KEYS.has(e.code)) return { kind: 'walk', code: e.code };
  if (e.key === '+' || e.key === '=') return { kind: 'zoom', dir: -1 };
  if (e.key === '-' || e.key === '_') return { kind: 'zoom', dir: 1 };
  return null;
}

export const FIELD_SELECTOR =
  'input, select, textarea, [contenteditable]:not([contenteditable="false"]), [role="slider"], [role="textbox"], [role="combobox"], [role="spinbutton"], [role="searchbox"]';
export const BUTTON_SELECTOR = 'button, a[href], summary, [role="button"], [role="link"], [role="checkbox"], [role="switch"], [role="tab"], [role="menuitem"]';
export const WIDGET_SELECTOR = '[tabindex]:not([tabindex="-1"]), [role="application"], [role="grid"], [role="listbox"], [role="tree"], [role="menu"], [role="tablist"]';

/** What the classifier needs to know about the focused element. */
export interface FocusProbe {
  /** No element, the scene canvas, or the page body. */
  scene: boolean;
  /** Whether the element or one of its ancestors matches a selector. */
  within(selector: string): boolean;
  /** The element scrolls (its content is larger than its box and overflow allows scrolling). */
  scrolls: boolean;
}

/** Where the focus is: the first of field, button, widget that applies, else the scene. */
export function focusPlace(p: FocusProbe): FocusPlace {
  if (p.scene) return 'scene';
  if (p.within(FIELD_SELECTOR)) return 'field';
  if (p.within(BUTTON_SELECTOR)) return 'button';
  if (p.within(WIDGET_SELECTOR) || p.scrolls) return 'widget';
  return 'scene';
}

/** The probe for a real element (browser only). */
export function probeElement(target: EventTarget | null, scene: Element): FocusProbe {
  const el = target instanceof Element ? target : null;
  const doc = el?.ownerDocument;
  const isScene = !el || el === scene || el === doc?.body || el === doc?.documentElement;
  return {
    scene: isScene,
    within: (selector) => Boolean(el?.closest(selector)),
    get scrolls() {
      if (!el || isScene) return false;
      const style = getComputedStyle(el);
      const can = (o: string) => o === 'auto' || o === 'scroll';
      return (can(style.overflowY) && el.scrollHeight > el.clientHeight + 1) || (can(style.overflowX) && el.scrollWidth > el.clientWidth + 1);
    },
  };
}
