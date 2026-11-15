import { describe, expect, it } from 'vitest';
import { constrainPanel, PANEL_IDS, PanelLayout } from './panelLayout';
import { fakePanel } from './panelTestHost';

describe('constrainPanel', () => {
  it('keeps the whole panel 8 px inside the window', () => {
    expect(constrainPanel({ x: -50, y: -20, width: 288 }, 300, 1280, 720)).toEqual({ x: 8, y: 8, width: 288 });
    expect(constrainPanel({ x: 1200, y: 600, width: 288 }, 300, 1280, 720)).toEqual({ x: 1280 - 288 - 8, y: 720 - 300 - 8, width: 288 });
    // Wider or taller than the window: as wide as fits, top left kept in.
    expect(constrainPanel({ x: 100, y: 100, width: 2000 }, 900, 1280, 720)).toEqual({ x: 8, y: 8, width: 1264 });
  });
});

describe('panel layout', () => {
  it('names seven panels', () => {
    expect(PANEL_IDS).toEqual(['key-metrics', 'skyline-chart', 'surface-controls', 'time', 'locator-map', 'compare', 'assistant']);
  });

  it('moves a panel inside the window, raises it, and remembers where', () => {
    const layout = new PanelLayout();
    const { host, s } = fakePanel();
    layout.register('key-metrics', host);
    const st = layout.move('key-metrics', { x: 640, y: 5000 });
    expect(s.placed).toEqual({ x: 640, y: 720 - 300 - 8, width: 288 });
    expect(s.raised).toBe(1);
    expect(st).toEqual({ panel: 'key-metrics', title: 'Key metrics', shown: true, folded: false, moved: true, xPx: 640, yPx: 412, widthPx: 288, heightPx: 300 });
    // One coordinate alone keeps the other.
    layout.move('key-metrics', { x: 100 });
    expect(s.placed).toEqual({ x: 100, y: 412, width: 288 });
    expect(layout.position('key-metrics')).toEqual({ x: 100, y: 412, width: 288 });
  });

  it('folds and opens, and keeps a moved panel inside the window when the window shrinks', () => {
    const layout = new PanelLayout();
    const { host, s } = fakePanel();
    layout.register('skyline-chart', host);
    expect(layout.fold('skyline-chart', true)).toMatchObject({ folded: true, heightPx: 40, moved: false });
    layout.move('skyline-chart', { x: 900, y: 400 });
    s.view = { width: 820, height: 600 };
    layout.reflow('skyline-chart');
    expect(s.placed).toEqual({ x: 820 - 288 - 8, y: 400, width: 288 });
    expect(layout.fold('skyline-chart', false).folded).toBe(false);
    // Opened again, the full height must still fit: 600 - 300 - 8.
    expect(s.placed!.y).toBe(292);
  });

  it('resets every panel to its place, open', () => {
    const layout = new PanelLayout();
    const a = fakePanel(), b = fakePanel({ x: 316, y: 507, width: 648, height: 189 });
    layout.register('key-metrics', a.host);
    layout.register('time', b.host);
    layout.move('key-metrics', { x: 600, y: 100 });
    layout.fold('time', true);
    const states = layout.reset();
    expect(a.s.placed).toBeNull();
    expect(b.s.folded).toBe(false);
    expect(states.map((x) => [x.panel, x.moved, x.folded])).toEqual([
      ['key-metrics', false, false],
      ['time', false, false],
    ]);
  });

  it('reports a panel that is not on screen without a box, and refuses one that is not on the page', () => {
    const layout = new PanelLayout();
    layout.register('compare', fakePanel(undefined, false).host);
    expect(layout.state('compare')).toMatchObject({ shown: false, xPx: null, yPx: null, widthPx: null, heightPx: null });
    expect(() => layout.move('assistant', { x: 1 })).toThrow('The Assistant panel is not on this page.');
  });
});
