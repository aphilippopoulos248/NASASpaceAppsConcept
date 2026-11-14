import { describe, expect, it } from 'vitest';
import { parseDeepLink } from './deepLink';

describe('deep links', () => {
  it('reads site, view, light and time', () => {
    expect(parseDeepLink('?site=apollo-11&view=surface&light=landing')).toEqual({ site: 'apollo-11', view: 'surface', light: 'landing', t: null });
    expect(parseDeepLink('?site=pin:-89.45000,136.70000&t=2025-03-14T06:00Z&view=bogus')).toEqual({ site: 'pin:-89.45000,136.70000', view: null, light: null, t: '2025-03-14T06:00Z' });
    expect(parseDeepLink('')).toEqual({ site: null, view: null, light: null, t: null });
  });
});
