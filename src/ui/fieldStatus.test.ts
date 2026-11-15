import { describe, expect, it } from 'vitest';
import { showFieldOutcome } from './fieldStatus';

/** As much of an element as the helper touches. */
const field = (title: string) => {
  const attrs: Record<string, string> = {};
  return { title, dataset: {} as Record<string, string | undefined>, attrs, setAttribute: (k: string, v: string) => (attrs[k] = v) } as unknown as HTMLElement & { attrs: Record<string, string> };
};

describe('a field that runs an action', () => {
  it('shows the error, then its own explanation again once a value is accepted', () => {
    // The "Arrival delay" field lost its explanation after the first successful edit.
    const f = field('Explore a late arrival at the same site.');
    showFieldOutcome(f, { ok: true });
    expect(f.title).toBe('Explore a late arrival at the same site.');
    expect(f.attrs['aria-invalid']).toBe('false');
    showFieldOutcome(f, { ok: false, error: 'params.hours must be at most 720' });
    expect(f.title).toBe('params.hours must be at most 720');
    expect(f.attrs['aria-invalid']).toBe('true');
    showFieldOutcome(f, { ok: true });
    expect(f.title).toBe('Explore a late arrival at the same site.');
    expect(f.attrs['aria-invalid']).toBe('false');
  });

  it('a field without an explanation shows nothing once the error is gone', () => {
    const f = field('');
    showFieldOutcome(f, { ok: false, error: 'bad' });
    showFieldOutcome(f, { ok: true });
    expect(f.title).toBe('');
  });
});
