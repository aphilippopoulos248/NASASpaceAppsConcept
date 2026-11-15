import { describe, expect, it } from 'vitest';
import type { DeepLink } from '../../core/deepLink';
import { isDestinationDeepLink, readPhase, setPhase, shouldShowIntro } from './phase';

const empty: DeepLink = { site: null, view: null, light: null, t: null, preset: null };

describe('intro presentation phase', () => {
  it('treats site, preset and surface view as destination deep links', () => {
    expect(isDestinationDeepLink(empty)).toBe(false);
    expect(isDestinationDeepLink({ ...empty, t: '2025-03-14T06:00Z' })).toBe(false);
    expect(isDestinationDeepLink({ ...empty, site: 'apollo-11' })).toBe(true);
    expect(isDestinationDeepLink({ ...empty, preset: 'eclipse-2025-03-14' })).toBe(true);
    expect(isDestinationDeepLink({ ...empty, view: 'surface' })).toBe(true);
    expect(isDestinationDeepLink({ ...empty, view: 'globe' })).toBe(false);
  });

  it('skips the intro for reduced motion, destinations and skipIntro=1', () => {
    expect(shouldShowIntro(empty, { reducedMotion: false })).toBe(true);
    expect(shouldShowIntro(empty, { reducedMotion: true })).toBe(false);
    expect(shouldShowIntro({ ...empty, site: 'apollo-11' }, { reducedMotion: false })).toBe(false);
    expect(shouldShowIntro(empty, { reducedMotion: false, search: '?skipIntro=1' })).toBe(false);
    expect(shouldShowIntro(empty, { reducedMotion: false, search: '?t=2025-03-14T06:00Z' })).toBe(true);
  });

  it('reads and writes data-phase without touching data-view', () => {
    const body = { dataset: { view: 'globe' } as DOMStringMap } as HTMLElement;
    expect(readPhase(body)).toBe('app');
    setPhase('intro', body);
    expect(body.dataset.phase).toBe('intro');
    expect(body.dataset.view).toBe('globe');
    setPhase('app', body);
    expect(readPhase(body)).toBe('app');
    expect(body.dataset.view).toBe('globe');
  });
});
