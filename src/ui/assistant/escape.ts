// Which layer Escape closes while the assistant drawer is open (finding F-10). The joint rule
// with the compare panel (src/ui/compare/panel.ts, @analysis): Escape goes to the layer that
// holds focus. Focus in the drawer closes the drawer; focus in the compare sheet closes the
// compare panel; focus on the page itself (nothing focused, the body, or the 3D scene) closes
// the drawer when it is open, else the compare panel. Written against "something that can hold
// a node" rather than DOM types, so it is tested in node, as src/ui/compare/focus.ts is.

/** An element, as far as this rule needs one. */
export interface Holder {
  contains(node: unknown): boolean;
}

/**
 * True when an Escape key press closes the drawer: the drawer is open, and focus is in it or on
 * the page itself. Focus in any other panel (the compare sheet, a field of the Filters panel,
 * the site card) leaves Escape to that panel's own handling.
 */
export function escapeClosesDrawer(open: boolean, active: unknown, page: { drawer: Holder; scene: Holder | null; body: unknown; root?: unknown }): boolean {
  if (!open) return false;
  if (active === null || active === undefined || active === page.body || (page.root !== undefined && active === page.root)) return true;
  if (page.scene && page.scene.contains(active)) return true;
  return page.drawer.contains(active);
}
