import { describe, expect, it } from 'vitest';
import { linkParts } from './links';

describe('assistant source links', () => {
  it('links actual URLs while preserving punctuation and literal text', () => {
    const text = 'NASA (https://www.nasa.gov/article). More: https://example.org/paper_(2025).';
    const parts = linkParts(text);
    expect(parts.map(p => p.text).join('')).toBe(text);
    expect(parts.filter(p => p.href).map(p => p.href)).toEqual(['https://www.nasa.gov/article', 'https://example.org/paper_(2025)']);
  });
  it('does not create script links, parse HTML, or link URLs with embedded credentials', () => {
    const text = '<script>alert(1)</script> javascript:alert(1) https://user:password@example.org/';
    expect(linkParts(text)).toEqual([{ text }]);
  });
});
