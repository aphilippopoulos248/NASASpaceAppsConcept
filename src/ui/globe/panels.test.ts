import { describe, expect, it } from 'vitest';
import { runAction, toolDefinitions } from '../../core/actions';
import { initPanels, isPanelOpen, onPanelChange, PANEL_NAMES } from './panels';

// No window here, so the screen counts as wide: the Filters panel is always open.
describe('showPanel', () => {
  initPanels();

  it('offers every panel to the assistant', () => {
    const tool = toolDefinitions().find((t) => t.name === 'showPanel')!;
    expect(JSON.stringify(tool)).toContain('site-science');
    expect(PANEL_NAMES).toEqual(['filters', 'site-details', 'site-science']);
  });

  it('folds the site-science section away and brings it back', async () => {
    const seen: [string, boolean][] = [];
    const off = onPanelChange((panel, open) => seen.push([panel, open]));
    expect(isPanelOpen('site-science')).toBe(true);
    expect(await runAction('showPanel', { panel: 'site-science', open: false }, 'test')).toEqual({ ok: true, result: { panel: 'site-science', open: false } });
    expect(isPanelOpen('site-science')).toBe(false);
    expect(isPanelOpen('site-details')).toBe(true);
    await runAction('showPanel', { panel: 'site-science', open: true }, 'test');
    expect(isPanelOpen('site-science')).toBe(true);
    expect(seen).toEqual([['site-science', false], ['site-science', true]]);
    off();
  });

  it('opening the section also opens the card details it sits in', async () => {
    await runAction('showPanel', { panel: 'site-details', open: false }, 'test');
    await runAction('showPanel', { panel: 'site-science', open: false }, 'test');
    const seen: [string, boolean][] = [];
    const off = onPanelChange((panel, open) => seen.push([panel, open]));
    await runAction('showPanel', { panel: 'site-science', open: true }, 'test');
    expect(isPanelOpen('site-details')).toBe(true);
    expect(isPanelOpen('site-science')).toBe(true);
    expect(seen).toEqual([['site-science', true], ['site-details', true]]);
    off();
  });

  it('folding the details keeps the section setting', async () => {
    await runAction('showPanel', { panel: 'site-details', open: false }, 'test');
    expect(isPanelOpen('site-science')).toBe(true);
    await runAction('showPanel', { panel: 'site-details', open: true }, 'test');
  });

  it('refuses a panel that does not exist', async () => {
    const r = await runAction('showPanel', { panel: 'nowhere', open: true } as never, 'test');
    expect(r.ok).toBe(false);
  });
});
