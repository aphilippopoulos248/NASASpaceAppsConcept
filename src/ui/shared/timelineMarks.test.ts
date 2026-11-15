import { describe, expect, it } from 'vitest';
import { layoutTimelineMarks, TIMELINE_MARK_GAP, TIMELINE_MARK_WIDTH } from './timelineMarks';

describe('timeline event icon layout', () => {
  it('leaves separated events at their time positions', () => {
    expect(layoutTimelineMarks([0.2, 0.5, 0.8], 400)).toEqual({ positions: [{ x: 80, row: 0 }, { x: 200, row: 0 }, { x: 320, row: 0 }], rows: 1 });
  });

  it('centres simultaneous events beside each other and preserves input identity', () => {
    const { positions } = layoutTimelineMarks([0.8, 0.5, 0.5, 0.51], 400);
    expect(positions[0].x).toBe(320);
    expect(positions.slice(1).map(p => p.row)).toEqual([0, 0, 0]);
    expect(positions[2].x - positions[1].x).toBe(32);
    expect(positions[3].x - positions[2].x).toBe(32);
    expect((positions[1].x + positions[3].x) / 2).toBeCloseTo((200 + 200 + 204) / 3);
  });

  it.each([96, 180, 400])('keeps edge clusters and dense sets within a %i px track without overlap', width => {
    for (const fractions of [[0, 0, 0.01], [0.99, 1, 1], Array.from({ length: 30 }, (_, i) => (i % 4) / 3)]) {
      const { positions } = layoutTimelineMarks(fractions, width);
      for (const p of positions) {
        expect(p.x).toBeGreaterThanOrEqual(TIMELINE_MARK_WIDTH / 2);
        expect(p.x).toBeLessThanOrEqual(width - TIMELINE_MARK_WIDTH / 2);
        for (const q of positions) {
          if (q === p || q.row !== p.row) continue;
          expect(Math.abs(q.x - p.x)).toBeGreaterThanOrEqual(TIMELINE_MARK_WIDTH + TIMELINE_MARK_GAP - 1e-9);
        }
      }
    }
  });

  it('fits events back into one row when the track becomes wider', () => {
    const fractions = [0.5, 0.5, 0.5, 0.5];
    expect(layoutTimelineMarks(fractions, 96).rows).toBe(2);
    expect(layoutTimelineMarks(fractions, 400).rows).toBe(1);
    expect(layoutTimelineMarks([], 0)).toEqual({ positions: [], rows: 1 });
  });
});
