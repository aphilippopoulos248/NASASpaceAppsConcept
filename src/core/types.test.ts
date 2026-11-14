import { describe, expect, it } from 'vitest';
import { pinId, wrapLon } from './types';

describe('wrapLon', () => {
  it('keeps east-positive longitudes inside -180..180', () => {
    expect(wrapLon(0)).toBe(0);
    expect(wrapLon(190)).toBe(-170);
    expect(wrapLon(-190)).toBe(170);
    expect(wrapLon(360 + 23.5)).toBeCloseTo(23.5, 10);
    expect(wrapLon(180)).toBe(180);
    expect(wrapLon(-180)).toBe(-180);
  });
});

describe('pinId', () => {
  it('is stable for a coordinate', () => {
    expect(pinId(-89.45, 136.7)).toBe('pin:-89.45000,136.70000');
  });
});
