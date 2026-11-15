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
