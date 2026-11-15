import { describe, expect, it } from 'vitest';
import { describeExtent, type SiteArea } from './siteAreas';

const area = (extentM: number) => ({ extentM }) as SiteArea;

describe('describeExtent', () => {
  it('words the true size of an explored area', () => {
    expect(describeExtent(area(6025))).toBe('about 6.0 km across');
    expect(describeExtent(area(138))).toBe('about 140 m across');
  });
});
