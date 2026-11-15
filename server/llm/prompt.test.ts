// The system prompt carries NASA's rules for AI applications (docs/lunyx/AI-USE.md F1) and the
// wording rules for Earth figures and rise and set times (the T-31 contract, section 4).
import { describe, expect, it } from 'vitest';
import { SYSTEM_PROMPT } from './prompt';

describe('system prompt', () => {
  it('forbids attributing answers to NASA and asks for the dataset as the source', () => {
    expect(SYSTEM_PROMPT).toContain('Never write "according to NASA" or anything like it');
    expect(SYSTEM_PROMPT).toContain('never suggest that NASA reviewed, approved or endorsed a result or the app');
    expect(SYSTEM_PROMPT).toContain("Attribute what you report to Lunyx's own computation, and name the dataset it rests on as the data source");
    expect(SYSTEM_PROMPT).toContain('"PGDA product 69, Mazarico et al. 2011"');
  });

  it('asks for the definition of Earth figures and the instant of every rise and set', () => {
    expect(SYSTEM_PROMPT).toContain('"Earth\'s centre in view"');
    expect(SYSTEM_PROMPT).toContain('("Sun fully set 19:30 UTC", not "sunset 19:30")');
  });

  it('stays one constant string (so the provider can cache it)', () => {
    expect(typeof SYSTEM_PROMPT).toBe('string');
    expect(SYSTEM_PROMPT).not.toMatch(/\$\{/);
  });
});
