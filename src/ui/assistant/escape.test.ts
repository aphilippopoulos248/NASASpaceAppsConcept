// F-10: "Escape goes to the layer that holds focus", the drawer's half.
import { describe, expect, it } from 'vitest';
import { escapeClosesDrawer, type Holder } from './escape';

/** A stand-in element holding the given nodes (and itself). */
const holder = (...nodes: unknown[]): Holder & { self: object } => {
  const self = {};
  return { self, contains: (n) => n === self || nodes.includes(n) };
};

describe('escapeClosesDrawer', () => {
  const body = { tag: 'body' }, root = { tag: 'html' };
  const input = { tag: 'textarea' }, sendButton = { tag: 'button' };
  const drawer = holder(input, sendButton);
  const scene = holder({ tag: 'canvas' });
  const compareTab = { tag: 'button.cmp-tab' }, filtersField = { tag: 'input' };
  const page = { drawer, scene, body, root };

  it('closes the drawer when focus is in it', () => {
    expect(escapeClosesDrawer(true, input, page)).toBe(true);
    expect(escapeClosesDrawer(true, sendButton, page)).toBe(true);
    expect(escapeClosesDrawer(true, drawer.self, page)).toBe(true);
  });

  it('closes the drawer when focus is on the page itself: nothing, the body, the root or the 3D scene', () => {
    for (const active of [null, undefined, body, root, scene.self]) expect(escapeClosesDrawer(true, active, page)).toBe(true);
  });

  it('leaves Escape to the layer that holds focus: the compare sheet, a Filters field', () => {
    expect(escapeClosesDrawer(true, compareTab, page)).toBe(false);
    expect(escapeClosesDrawer(true, filtersField, page)).toBe(false);
  });

  it('does nothing while the drawer is closed', () => {
    for (const active of [input, body, scene.self, compareTab]) expect(escapeClosesDrawer(false, active, page)).toBe(false);
  });

  it('works without a scene element on the page', () => {
    expect(escapeClosesDrawer(true, body, { drawer, scene: null, body })).toBe(true);
    expect(escapeClosesDrawer(true, compareTab, { drawer, scene: null, body })).toBe(false);
  });
});
