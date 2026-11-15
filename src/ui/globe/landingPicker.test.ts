import { describe, expect, it } from 'vitest';
import { ALL_MISSIONS } from '../../core/missionFilter';
import type { Landing } from '../../data/landings';
import { pickerOptions, pickerPrompt } from './landingPicker';

const L = (id: string, name: string, program: string, date: string, crewed = false) => ({ id, name, program, country: 'c', date, time: '12:00', lat: 0, lon: 0, crewed, region: 'r', summary: 's' }) as Landing;
const LANDINGS = [L('luna-9', 'Luna 9', 'Luna', '1966-02-03'), L('apollo-11', 'Apollo 11', 'Apollo', '1969-07-20', true), L('im-2', 'IM-2 Athena', 'Commercial (CLPS)', '2025-03-06')];

describe('Go to a landing site', () => {
  it('lists every landing the filters show, oldest first, with its landing date', () => {
    expect(pickerOptions(LANDINGS, ALL_MISSIONS)).toEqual([
      { value: 'luna-9', text: 'Luna 9, 1966-02-03' },
      { value: 'apollo-11', text: 'Apollo 11, 1969-07-20' },
      { value: 'im-2', text: 'IM-2 Athena, 2025-03-06' },
    ]);
    expect(pickerOptions(LANDINGS, { ...ALL_MISSIONS, type: 'crewed' }).map((o) => o.value)).toEqual(['apollo-11']);
    expect(pickerOptions(LANDINGS, { ...ALL_MISSIONS, programs: [] })).toEqual([]);
  });

  it('says what the list holds, and why it is empty', () => {
    expect(pickerPrompt(28, 28)).toBe('Choose one of 28 landings…');
    expect(pickerPrompt(1, 28)).toBe('Choose one of 1 landing (of 28, as filtered)…');
    expect(pickerPrompt(0, 28)).toBe('No landing matches the mission filters');
  });
});
