import { describe, expect, it } from 'vitest';
import { focusInHiddenPanel, returnFocusOnClose, type Holder } from './focus';

/** A stand-in element holding the named nodes. */
const holder = (...nodes: string[]): Holder => ({ contains: (n) => typeof n === 'string' && nodes.includes(n) });

describe('focus in the compare panel', () => {
  const panels = [['compare', holder('swap')], ['nearby', holder('compare-as-b', 'scan')], ['windows', holder('table')]] as const;

  it('moves focus when a control switches to another tab and so hides itself ("Compare as B" in the nearby list)', () => {
    expect(focusInHiddenPanel('compare-as-b', panels, 'compare')).toBe(true);
    // A control of the tab being shown keeps its focus; so does a tab button or anything outside the panels.
    expect(focusInHiddenPanel('swap', panels, 'compare')).toBe(false);
    expect(focusInHiddenPanel('tab-button', panels, 'compare')).toBe(false);
    expect(focusInHiddenPanel(null, panels, 'compare')).toBe(false);
  });

  it('gives focus back to the launcher on closing when it was in the panel or had fallen to the page', () => {
    const sheet = holder('sheet', 'tab-button', 'compare-as-b');
    expect(returnFocusOnClose('tab-button', sheet, 'body')).toBe(true);
    expect(returnFocusOnClose('body', sheet, 'body')).toBe(true);
    expect(returnFocusOnClose(null, sheet, 'body')).toBe(true);
    // The assistant drawer closed the panel by an action: its own focus stays.
    expect(returnFocusOnClose('assistant-input', sheet, 'body')).toBe(false);
  });
});
