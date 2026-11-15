import { beforeEach, describe, expect, it } from 'vitest';
import { listActions, registerActions, resetActions, runAction, toolDefinitions } from '../../core/actions';
import { createPanelActions } from './panelActions';
import { PanelLayout } from './panelLayout';
import { fakePanel } from './panelTestHost';

let layout: PanelLayout;
let surface = true;
let metrics: ReturnType<typeof fakePanel>, compare: ReturnType<typeof fakePanel>;

beforeEach(() => {
  resetActions();
  layout = new PanelLayout();
  metrics = fakePanel();
  compare = fakePanel({ x: 100, y: 100, width: 600, height: 500 }, false);
  layout.register('key-metrics', metrics.host);
  layout.register('compare', compare.host);
  surface = true;
  registerActions(createPanelActions({ layout, isSurface: () => surface }));
});

const run = async (name: string, params: unknown = {}) => {
  const r = await runAction<any>(name, params, 'test');
  if (!r.ok) throw new Error(r.error);
  return r.result;
};

describe('surface panel actions', () => {
  it('registers move/fold, reset and a query, described for an LLM', () => {
    expect(listActions().map((a) => a.name).sort()).toEqual(['getSurfacePanels', 'resetSurfacePanels', 'setSurfacePanel']);
    const set = toolDefinitions().find((t) => t.name === 'setSurfacePanel')!;
    expect(set.input_schema.required).toEqual(['panel']);
    expect(set.description).toMatch(/"key-metrics" \(Key metrics\).*"assistant" \(Assistant\)/);
    expect(toolDefinitions().find((t) => t.name === 'getSurfacePanels')!.description).toMatch(/\(Read-only\.\)$/);
  });

  it('setSurfacePanel moves and folds a panel and returns its state', async () => {
    expect(await run('setSurfacePanel', { panel: 'key-metrics', xPx: 640, yPx: 100 })).toEqual({ panel: 'key-metrics', title: 'Key metrics', shown: true, folded: false, moved: true, xPx: 640, yPx: 100, widthPx: 288, heightPx: 300 });
    expect(await run('setSurfacePanel', { panel: 'key-metrics', folded: true })).toMatchObject({ folded: true, heightPx: 40, xPx: 640 });
    expect(metrics.s.folded).toBe(true);
    // Folding and moving in one call.
    expect(await run('setSurfacePanel', { panel: 'key-metrics', folded: false, yPx: 9999 })).toMatchObject({ folded: false, yPx: 720 - 300 - 8 });
  });

  it('setSurfacePanel says why it cannot act', async () => {
    const fail = async (params: unknown) => {
      const r = await runAction('setSurfacePanel', params, 'test');
      expect(r.ok).toBe(false);
      return r.ok ? '' : r.error;
    };
    expect(await fail({ panel: 'key-metrics' })).toMatch(/Give `folded`, or `xPx` and\/or `yPx`/);
    expect(await fail({ panel: 'compare', folded: true })).toBe('The Analysis panel is not on screen. Open Analysis first.');
    expect(await fail({ panel: 'assistant', folded: true })).toBe('The Assistant panel is not on this page.');
    layout.register('surface-controls', fakePanel(undefined, false).host);
    expect(await fail({ panel: 'surface-controls', xPx: 300 })).toBe('The Surface controls panel is not on screen. It gives way while the skyline chart is expanded: shrink the chart first (setChart with expanded false).');
    expect(await fail({ panel: 'chart', folded: true })).toMatch(/panel/);
    surface = false;
    expect(await fail({ panel: 'key-metrics', folded: true })).toMatch(/surface view only/);
  });

  it('lets the assistant move and fold on the globe while other panels still require surface view', async () => {
    surface = false;
    layout.register('assistant', fakePanel({ x: 900, y: 10, width: 380, height: 600 }).host);
    expect(await run('setSurfacePanel', { panel: 'assistant', xPx: 300, yPx: 60 })).toMatchObject({ moved: true, xPx: 300, yPx: 60 });
    expect(await run('setSurfacePanel', { panel: 'assistant', folded: true })).toMatchObject({ folded: true });
    expect((await runAction('setSurfacePanel', { panel: 'key-metrics', xPx: 100 }, 'test')).ok).toBe(false);
  });

  it('resetSurfacePanels puts everything back; getSurfacePanels reports it', async () => {
    await run('setSurfacePanel', { panel: 'key-metrics', xPx: 500, folded: true });
    const reset = await run('resetSurfacePanels');
    expect(reset.panels.map((p: any) => [p.panel, p.moved, p.folded])).toEqual([
      ['key-metrics', false, false],
      ['compare', false, false],
    ]);
    expect(metrics.s.placed).toBeNull();
    const q = await run('getSurfacePanels');
    expect(q.surfaceView).toBe(true);
    expect(q.panels.find((p: any) => p.panel === 'compare')).toMatchObject({ shown: false, xPx: null });
  });
});
