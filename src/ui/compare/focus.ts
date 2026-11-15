// Where keyboard focus goes when the compare panel changes under it (QA finding Q-4). Written
// against "something that can hold a node" rather than DOM types, so it is tested in node.

/** An element, as far as these rules need one. */
export interface Holder {
  contains(node: unknown): boolean;
}

/**
 * True when the focused element sits in a tab panel other than the one about to be shown. The
 * switch hides that panel, and focus would drop to the page body: the panel moves it to the
 * selected tab instead. This happens when a control switches tabs itself, such as "Compare as B"
 * in a row of the nearby list, which brings the A and B tab forward.
 */
export function focusInHiddenPanel(active: unknown, panels: Iterable<readonly [unknown, Holder]>, shownTab: unknown): boolean {
  if (active === null || active === undefined) return false;
  for (const [name, p] of panels) if (name !== shownTab && p.contains(active)) return true;
  return false;
}

/**
 * True when closing the panel hands focus back to its launcher: focus was in the panel, or it had
 * already fallen to the page body (nobody holds it). Focus somewhere else, such as the assistant
 * drawer that closed the panel by an action, stays where it is.
 */
export function returnFocusOnClose(active: unknown, sheet: Holder, body: unknown): boolean {
  return active === null || active === undefined || active === body || sheet.contains(active);
}

/**
 * Which control of a list drawn again gets the focus that one of its controls had (`key` is that
 * control's `data-focus-key`; `before` and `after` are the keys of the old and the new list, in
 * order). The same key when it is still there. When its row went away (a deleted comparison, a
 * new scan), the control of the same kind (the part of the key up to ':') at the same place, or
 * the last one of that kind. -1 when the new list has none.
 */
export function focusIndexAfterRedraw(before: readonly string[], after: readonly string[], key: string): number {
  const same = after.indexOf(key);
  if (same >= 0) return same;
  const kind = key.slice(0, key.indexOf(':') + 1);
  const ofKind: number[] = [];
  after.forEach((k, i) => k.startsWith(kind) && ofKind.push(i));
  if (!ofKind.length) return -1;
  const place = before.filter((k) => k.startsWith(kind)).indexOf(key);
  return ofKind[Math.min(Math.max(place, 0), ofKind.length - 1)];
}

const focusKeys = (box: HTMLElement) => [...box.querySelectorAll<HTMLElement>('[data-focus-key]')];

/**
 * Replaces what `box` shows and keeps the keyboard focus in it: a list is drawn again from the
 * stores after one of its own buttons ran an action (Pin, Compare as B, Load, Delete), and the
 * button that had the focus is gone with the old list, which drops the focus to the page. The
 * control picked by focusIndexAfterRedraw() gets it back; when there is none, `fallback()`, and
 * failing that the dialog the list is in.
 */
export function redrawKeepingFocus(box: HTMLElement, nodes: readonly Node[], fallback?: () => HTMLElement | null): void {
  const active = document.activeElement;
  const key = active instanceof HTMLElement && box.contains(active) ? active.dataset.focusKey : undefined;
  const before = key === undefined ? [] : focusKeys(box).map((n) => n.dataset.focusKey!);
  box.replaceChildren(...nodes);
  if (key === undefined) return;
  const now = focusKeys(box);
  const i = focusIndexAfterRedraw(before, now.map((n) => n.dataset.focusKey!), key);
  (i >= 0 ? now[i] : (fallback?.() ?? box.closest<HTMLElement>('[role="dialog"]')))?.focus();
}
