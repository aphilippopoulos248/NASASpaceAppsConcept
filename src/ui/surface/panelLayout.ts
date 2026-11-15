// The movable, foldable panels of the surface view (the teammate's design from GitHub main
// 48ffb71): where each one is and whether it is folded. The rules live here, apart from the
// page, so the registered actions (panelActions.ts) and the controls on screen (panels.ts)
// change the layout in one way, and so it can be tested without a browser.

/** The panels, in screen order. `id` is what actions and the assistant use. */
export const SURFACE_PANELS = [
  { id: 'key-metrics', title: 'Key metrics', selector: '.km' },
  { id: 'skyline-chart', title: 'Skyline chart', selector: '.skc' },
  { id: 'surface-controls', title: 'Surface controls', selector: '.surface-hud' },
  { id: 'time', title: 'Time', selector: '.time-scrubber' },
  { id: 'locator-map', title: 'Locator map', selector: '.locator' },
  { id: 'compare', title: 'Compare', selector: '.cmp-sheet' },
  { id: 'assistant', title: 'Assistant', selector: '.assistant-drawer' },
] as const;

export type PanelId = (typeof SURFACE_PANELS)[number]['id'];
export const PANEL_IDS = SURFACE_PANELS.map((p) => p.id) as readonly PanelId[];

export interface Position {
  x: number;
  y: number;
  width: number;
}

/** Margin kept between a panel and the window's edge, CSS px. */
const EDGE = 8;

/** Keep the entire panel within reach, including after resizing or expanding it. */
export function constrainPanel(p: Position, height: number, viewportW: number, viewportH: number): Position {
  const width = Math.min(p.width, Math.max(0, viewportW - 2 * EDGE));
  return {
    width,
    x: Math.max(EDGE, Math.min(p.x, viewportW - width - EDGE)),
    y: Math.max(EDGE, Math.min(p.y, viewportH - Math.min(height, viewportH - 2 * EDGE) - EDGE)),
  };
}

/** What a panel is on the page. panels.ts implements it with the DOM; tests with plain objects. */
export interface PanelHost {
  /** On screen now: the surface view is shown and the panel is open (the compare sheet and the assistant can be closed). */
  shown(): boolean;
  /** Its box on screen, CSS px. */
  box(): { x: number; y: number; width: number; height: number };
  viewport(): { width: number; height: number };
  /** Puts it at a position, or back in its place in the layout (null). */
  place(position: Position | null): void;
  /** Folds it to its title row, or opens it. */
  setFolded(folded: boolean): void;
  /** Whether it is folded now (the key metrics keep this in their own state). */
  folded(): boolean;
  /** Brings it in front of the other panels. */
  raise(): void;
}

/** A panel's state, as the actions report it. */
export interface PanelState {
  panel: PanelId;
  title: string;
  /** On screen now. */
  shown: boolean;
  folded: boolean;
  /** Moved away from its place in the layout (by a drag, the keys or an action). */
  moved: boolean;
  /** Its box on screen, CSS px from the top left of the window; null when it is not on screen. */
  xPx: number | null;
  yPx: number | null;
  widthPx: number | null;
  heightPx: number | null;
}

export class PanelLayout {
  private readonly hosts = new Map<PanelId, PanelHost>();
  private readonly positions = new Map<PanelId, Position>();

  register(id: PanelId, host: PanelHost): void {
    this.hosts.set(id, host);
  }

  has(id: PanelId): boolean {
    return this.hosts.has(id);
  }

  private host(id: PanelId): PanelHost {
    const h = this.hosts.get(id);
    if (!h) throw new Error(`The ${titleOf(id)} panel is not on this page.`);
    return h;
  }

  /** Moves a panel so that its top left corner is at (x, y), kept inside the window. Either coordinate may be left out. */
  move(id: PanelId, to: { x?: number; y?: number }): PanelState {
    const h = this.host(id);
    const box = h.box(), view = h.viewport();
    const from = this.positions.get(id) ?? { x: box.x, y: box.y, width: box.width };
    const p = constrainPanel({ x: to.x ?? from.x, y: to.y ?? from.y, width: from.width }, box.height, view.width, view.height);
    this.positions.set(id, p);
    h.raise();
    h.place(p);
    return this.state(id);
  }

  /** Puts a moved panel back inside the window after the window or the panel changed size. */
  reflow(id: PanelId, width?: number): void {
    const h = this.hosts.get(id), p = this.positions.get(id);
    if (!h || !p || !h.shown()) return;
    const box = h.box(), view = h.viewport();
    const next = constrainPanel({ ...p, ...(width !== undefined && { width }) }, box.height, view.width, view.height);
    if (next.x === p.x && next.y === p.y && next.width === p.width) return;
    this.positions.set(id, next);
    h.place(next);
  }

  fold(id: PanelId, folded: boolean): PanelState {
    const h = this.host(id);
    h.setFolded(folded);
    this.reflow(id);
    return this.state(id);
  }

  /** Every panel back in its place in the layout and open. */
  reset(): PanelState[] {
    for (const [id, h] of this.hosts) {
      this.positions.delete(id);
      h.place(null);
      h.setFolded(false);
    }
    return this.states();
  }

  position(id: PanelId): Position | null {
    return this.positions.get(id) ?? null;
  }

  state(id: PanelId): PanelState {
    const h = this.host(id);
    const shown = h.shown();
    const box = shown ? h.box() : null;
    const r = (v: number | undefined) => (v === undefined ? null : Math.round(v));
    return { panel: id, title: titleOf(id), shown, folded: h.folded(), moved: this.positions.has(id), xPx: r(box?.x), yPx: r(box?.y), widthPx: r(box?.width), heightPx: r(box?.height) };
  }

  states(): PanelState[] {
    return SURFACE_PANELS.filter((p) => this.hosts.has(p.id)).map((p) => this.state(p.id));
  }
}

export function titleOf(id: PanelId): string {
  return SURFACE_PANELS.find((p) => p.id === id)?.title ?? id;
}
