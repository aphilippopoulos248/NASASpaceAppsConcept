import { describe, expect, it } from 'vitest';
import { focusIndexAfterRedraw, focusInHiddenPanel, returnFocusOnClose, type Holder } from './focus';

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

describe('focus in a list drawn again', () => {
  const nearby = ['pin:c1', 'compare-b:c1', 'pin:c2', 'compare-b:c2', 'pin:c3', 'compare-b:c3'];

  it('stays on the same control when it is drawn again (Pin and Compare as B mark the row on screen)', () => {
    expect(focusIndexAfterRedraw(nearby, nearby, 'compare-b:c2')).toBe(3);
    expect(focusIndexAfterRedraw(nearby, [...nearby].reverse(), 'pin:c3')).toBe(1);
  });

  it('goes to the control of the same kind at the same place when its row went away (Delete)', () => {
    const saved = ['load:a', 'delete:a', 'load:b', 'delete:b', 'load:c', 'delete:c'];
    // "b" deleted: the Delete button of the next one, "c".
    expect(focusIndexAfterRedraw(saved, ['load:a', 'delete:a', 'load:c', 'delete:c'], 'delete:b')).toBe(3);
    // The last one deleted: the Delete button of the one before.
    expect(focusIndexAfterRedraw(saved, ['load:a', 'delete:a', 'load:b', 'delete:b'], 'delete:c')).toBe(3);
    // Nothing left: the caller's fallback.
    expect(focusIndexAfterRedraw(['load:a', 'delete:a'], [], 'delete:a')).toBe(-1);
  });
});
