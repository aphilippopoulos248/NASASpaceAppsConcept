// Test-only: a surface panel as plain data, for panelLayout and panelActions tests.
import type { PanelHost, Position } from './panelLayout';

/** A panel as plain data: a box, a window, a position and a fold. */
export function fakePanel(box = { x: 24, y: 24, width: 288, height: 300 }, shown = true) {
  const s = { box: { ...box }, placed: null as Position | null, folded: false, raised: 0, shown, view: { width: 1280, height: 720 } };
  const host: PanelHost = {
    shown: () => s.shown,
    box: () => {
      const height = s.folded ? 40 : s.box.height;
      return s.placed ? { x: s.placed.x, y: s.placed.y, width: s.placed.width, height } : { ...s.box, height };
    },
    viewport: () => s.view,
    place: (p) => {
      s.placed = p;
    },
    setFolded: (f) => {
      s.folded = f;
    },
    folded: () => s.folded,
    raise: () => {
      s.raised++;
    },
  };
  return { host, s };
}
