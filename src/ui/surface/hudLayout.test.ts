import { describe, expect, it } from 'vitest';
import { hudLimits } from './hudLayout';

// Boxes as measured in the app at 1280 x 720 (edge 24, panel 288, chart region floor at 612).
const metrics = { top: 24, left: 24, right: 312 };
const strip = { left: 324, right: 1020, floor: 564, height: 108 };
const scrubber = { left: 316, right: 964, top: 578 };

describe('surface HUD layout limits', () => {
  it('ends the metrics above the small chart and leaves the chart on its floor', () => {
    const l = hudLimits({ viewportH: 720, metrics, floor: 612, chart: { left: 24, right: 312, height: 235 }, strip, below: [scrubber] });
    // The chart stands beside the scrubber, not over it.
    expect(l.chartLift).toBe(0);
    // The strip is above the scrubber with room to spare: 564 against 578 - 12.
    expect(l.stripLift).toBe(0);
    // 612 - 235 = 377 is the chart's top; 12 px gap; the panel starts at 24.
    expect(l.metricsMaxH).toBe(377 - 12 - 24);
    expect(l.chartMaxH).toBe(612 - (24 + 46 + 12));
  });

  it('raises the large chart above the scrubber and shrinks the metrics to what is left', () => {
    const l = hudLimits({ viewportH: 720, metrics, floor: 612, chart: { left: 24, right: 784, height: 440 }, strip: null, below: [scrubber] });
    expect(l.chartLift).toBe(612 - (578 - 12));
    const chartTop = 612 - l.chartLift - 440;
    expect(l.metricsMaxH).toBe(chartTop - 12 - 24);
    expect(l.chartMaxH).toBe(612 - l.chartLift - (24 + 46 + 12));
  });

  it('lets the metrics run down to the floor when nothing is under them', () => {
    const l = hudLimits({ viewportH: 720, metrics, floor: 612, chart: null, strip, below: [scrubber] });
    expect(l.metricsMaxH).toBe(612 - 12 - 24);
    expect(l.chartLift).toBe(0);
  });

  it('keeps a gap between the status strip and a scrubber that has grown taller', () => {
    const l = hudLimits({ viewportH: 720, metrics, floor: 612, chart: null, strip, below: [{ ...scrubber, top: 567 }] });
    expect(l.stripLift).toBe(564 - (567 - 12));
  });

  it('counts a chart taller than its limit at the limit, and never leaves the metrics less than their title row', () => {
    const l = hudLimits({ viewportH: 400, metrics, floor: 292, chart: { left: 24, right: 312, height: 900 }, strip: null, below: [] });
    expect(l.chartMaxH).toBe(292 - (24 + 46 + 12));
    // The chart at its limit starts 12 px under the title row: the metrics get exactly that row.
    expect(l.metricsMaxH).toBe(46);
    const tiny = hudLimits({ viewportH: 120, metrics, floor: 100, chart: { left: 24, right: 312, height: 300 }, strip: null, below: [] });
    expect(tiny.metricsMaxH).toBe(46);
    expect(tiny.chartMaxH).toBe(150);
  });

  it('on a phone ends the metrics above the status strip, which lies under them', () => {
    const phone = { top: 12, left: 12, right: 330 };
    const l = hudLimits({ viewportH: 844, metrics: phone, floor: 684, chart: null, strip: { left: 12, right: 378, floor: 676, height: 156 }, below: [{ left: 12, right: 378, top: 700 }] });
    expect(l.stripLift).toBe(0);
    expect(l.metricsMaxH).toBe(676 - 156 - 12 - 12);
    // With the chart open instead (the strip steps aside), the chart stands on its floor: the scrubber is lower.
    const open = hudLimits({ viewportH: 844, metrics: phone, floor: 684, chart: { left: 12, right: 378, height: 240 }, strip: null, below: [{ left: 12, right: 378, top: 700 }] });
    expect(open.chartLift).toBe(0);
    expect(open.metricsMaxH).toBe(684 - 240 - 12 - 12);
    // The assistant's button stands in the chart's and the strip's column on a phone: both keep a gap above it.
    const button = { left: 334, right: 378, top: 640 };
    const withButton = hudLimits({ viewportH: 844, metrics: phone, floor: 684, chart: { left: 12, right: 378, height: 240 }, strip: { left: 12, right: 378, floor: 676, height: 156 }, below: [{ left: 12, right: 378, top: 667 }, button] });
    expect(withButton.chartLift).toBe(684 - (640 - 12));
    expect(withButton.stripLift).toBe(676 - (640 - 12));
    // It is beside the metrics, not under them.
    expect(withButton.metricsMaxH).toBe(684 - withButton.chartLift - 240 - 12 - 12);
    // A scrubber that reaches higher than the chart's floor pushes the chart up.
    const tall = hudLimits({ viewportH: 844, metrics: phone, floor: 684, chart: { left: 12, right: 378, height: 240 }, strip: null, below: [{ left: 12, right: 378, top: 660 }] });
    expect(tall.chartLift).toBe(684 - (660 - 12));
  });
});
