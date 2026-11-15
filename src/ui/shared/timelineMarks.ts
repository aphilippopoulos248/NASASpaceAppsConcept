// Keep timeline event buttons distinct without changing the times they jump to.
export const TIMELINE_MARK_WIDTH = 28;
export const TIMELINE_MARK_GAP = 4;
export const TIMELINE_MARK_ROW_HEIGHT = 28;

export interface TimelineMarkPosition { x: number; row: number }

/** Place close events beside one another, centred on their group, within the track. */
export function layoutTimelineMarks(fractions: readonly number[], width: number): { positions: TimelineMarkPosition[]; rows: number } {
  if (!fractions.length) return { positions: [], rows: 1 };
  const available = Math.max(TIMELINE_MARK_WIDTH, width);
  const step = TIMELINE_MARK_WIDTH + TIMELINE_MARK_GAP;
  const half = TIMELINE_MARK_WIDTH / 2;
  const capacity = Math.max(1, Math.floor((available + TIMELINE_MARK_GAP) / step));
  const sorted = fractions.map((f, index) => ({ index, x: Math.max(0, Math.min(1, f)) * available })).sort((a, b) => a.x - b.x);
  const positions: TimelineMarkPosition[] = new Array(fractions.length);
  for (let offset = 0; offset < sorted.length; offset += capacity) {
    const row = Math.floor(offset / capacity);
    type Group = { items: typeof sorted; sum: number; left: number };
    const groups: Group[] = [];
    const align = (g: Group) => {
      const span = (g.items.length - 1) * step;
      g.left = Math.max(half, Math.min(available - half - span, g.sum / g.items.length - span / 2));
    };
    for (const item of sorted.slice(offset, offset + capacity)) {
      const group: Group = { items: [item], sum: item.x, left: 0 };
      align(group);
      while (groups.length) {
        const previous = groups[groups.length - 1];
        if (previous.left + previous.items.length * step <= group.left) break;
        groups.pop();
        group.items = [...previous.items, ...group.items];
        group.sum += previous.sum;
        align(group);
      }
      groups.push(group);
    }
    for (const group of groups) {
      group.items.forEach((item, i) => { positions[item.index] = { x: group.left + i * step, row }; });
    }
  }
  return { positions, rows: Math.ceil(sorted.length / capacity) };
}
