// Deterministic mode and the newest results (T-1 batch 4): both ends of each rise and set (D-8,
// T-47), Earth by its centre and by any part of its disc, the default solar band (finding Q-5,
// T-46), the view's target (getState.globeDisplay.viewTarget), the card's ownership and
// explored-area rows and the real clock (T-44). Against the stand-in app, which gives the same
// result shapes as src/core (docs/lunyx/handover/T-47-event-spans-ui.md).
import { beforeEach, describe, expect, it } from 'vitest';
import { actionLog } from '../../core/actions';
import { ALL_ACTIONS, installFakeApp, T0, type FakeState } from '../testing/fakeApp';
import { DeterministicEngine } from './engine';

const H = 3_600_000, MIN = 60_000;
const noWait = () => Promise.resolve();
const engine = () => new DeterministicEngine(undefined, { wait: noWait, now: () => Date.UTC(2026, 10, 14, 9, 30) });
const lastSeq = () => actionLog().at(-1)?.seq ?? 0;
const ranSince = (from: number) => actionLog().filter((e) => e.origin === 'assistant' && e.seq > from).map((e) => ({ name: e.name, params: e.params as Record<string, unknown>, result: e.result as Record<string, any> }));
const lastResult = (name: string) => actionLog().filter((e) => e.name === name && e.ok).at(-1)?.result as Record<string, any>;

describe('deterministic mode: both ends of each rise and set (D-8, T-47)', () => {
  let state: FakeState;
  beforeEach(() => {
    state = installFakeApp(ALL_ACTIONS);
  });

  it('gives the whole sunset with the jump: "starts setting ... and is fully set ..."', async () => {
    const e = engine();
    await e.reply('go to IM-2');
    const r = await e.reply('jump to next sunset');
    expect(r.text).toContain(
      "Moved the clock to the next sunset: Sun fully set 2026-03-02 08:00 UTC (the last part of the Sun's disc goes behind the terrain skyline), at azimuth 268.9°. The Sun starts setting 2026-03-02 07:10 and is fully set 08:00 UTC. Rise and set times are measured against the terrain skyline.",
    );
    // Both times are the result's own.
    const span = lastResult('jumpToEvent').span;
    expect([span.start.timeUtc, span.end.timeUtc]).toEqual(['2026-03-02T07:10Z', '2026-03-02T08:00Z']);
  });

  it('jumps to the start or the end of a passage, by its name or its label', async () => {
    const e = engine();
    await e.reply('go to IM-2');
    let from = lastSeq();
    let r = await e.reply('jump to the start of the next sunset');
    expect(ranSince(from).map((x) => [x.name, x.params])).toEqual([['jumpToEvent', { type: 'sunset', which: 'next', instant: 'start' }]]);
    expect(state.timeMs).toBe(T0 + 19 * H + 10 * MIN);
    expect(r.text).toContain("Moved the clock to the start of the next sunset: Sun starts setting 2026-03-02 07:10 UTC (the terrain skyline starts to cut into the Sun's disc), at azimuth 268.0°. The Sun starts setting 2026-03-02 07:10 and is fully set 08:00 UTC.");

    state.timeMs = T0;
    from = lastSeq();
    r = await e.reply('go to when earth is fully set');
    expect(ranSince(from).map((x) => x.params)).toEqual([{ type: 'earthset', which: 'next', instant: 'end' }]);
    expect(state.timeMs).toBe(T0 + 9 * H + 50 * MIN);
    expect(r.text).toContain("Moved the clock to the end of the next Earthset: Earth fully set 2026-03-01 21:50 UTC (the last part of Earth's disc goes behind the terrain skyline)");
    expect(r.text).toContain('Earth starts setting 2026-03-01 20:10 (its centre sets 21:00) and is fully set 21:50 UTC.');

    // A sunrise is its first limb and a sunset its last: those ends are the events themselves.
    state.timeMs = T0;
    from = lastSeq();
    await e.reply('jump to when the sun starts rising');
    await e.reply('jump to sun fully set');
    await e.reply('end of the next sunrise');
    await e.reply('earth starts rising');
    expect(ranSince(from).map((x) => x.params)).toEqual([
      { type: 'sunrise', which: 'next' },
      { type: 'sunset', which: 'next' },
      // From the sunset (08:00 on 2 March) there is no later sunrise in the stand-in: refused, and said so.
      { type: 'sunrise', which: 'next', instant: 'end' },
      { type: 'earthrise', which: 'next', instant: 'start' },
    ]);
  });

  it('answers "when" with both ends, and Earth\'s centre in between', async () => {
    const e = engine();
    await e.reply('go to IM-2');
    const r = await e.reply('when is the next earthset?');
    expect(r.text).toContain("The next Earthset: Earth's centre sets 2026-03-01 21:00 UTC (the centre of Earth's disc goes behind the terrain skyline), azimuth 348.4° (against the terrain skyline). Earth starts setting 2026-03-01 20:10 (its centre sets 21:00) and is fully set 21:50 UTC.");
  });

  it('calls a graze "partly hidden ..., never fully set" when no sunset is left in the window', async () => {
    const e = engine();
    await e.reply('go to IM-2');
    state.timeMs = T0 + 21 * H;
    const r = await e.reply('when is the next sunset?');
    expect(r.text).toBe(
      'There is no sunset after the simulated time inside the analysed mission window. Next passage of the Sun through the skyline: the Sun is partly hidden from 2026-03-02 10:00 until its whole disc is clear again 11:00 UTC; it never fully sets.',
    );
  });

  it('names the body once when the next passage ends outside the window', async () => {
    const e = engine();
    await e.reply('go to IM-2');
    state.timeMs = T0 + 21 * H;
    state.windowDurationH = 22.5;
    const r = await e.reply('when is the next sunset?');
    expect(r.text).toBe(
      'There is no sunset after the simulated time inside the analysed mission window. Next passage of the Sun through the skyline: partly hidden from 2026-03-02 10:00, whole disc clear again 11:00 (after the analysed window) UTC; never fully set.',
    );
  });

  it("uses the science core's own sentence for an end outside the analysed window", async () => {
    const e = engine();
    await e.reply('go to IM-2');
    // The window starts after Earth started setting: that end is before the window.
    state.windowStartMs = T0 + 8 * H + 30 * MIN;
    state.timeMs = state.windowStartMs;
    const r = await e.reply('when is the next earthset?');
    expect(r.text).toContain('Earth: starts setting 2026-03-01 20:10 (before the analysed window), centre sets 21:00, fully set 21:50 UTC.');
  });

  it('says plainly that only the labelled instant is available on a build without spans', async () => {
    state = installFakeApp({ ...ALL_ACTIONS, eventSpans: false });
    const e = engine();
    await e.reply('go to IM-2');
    const r = await e.reply('jump to next sunset');
    expect(r.text).toContain("Sun fully set 2026-03-02 08:00 UTC (the last part of the Sun's disc goes behind the terrain skyline), at azimuth 268.9°. Only this one instant of the sunset is available here, not the start and end of its passage through the skyline.");
    state.timeMs = T0;
    const from = lastSeq();
    const refused = await e.reply('jump to the start of the next sunset');
    expect(refused.text).toContain('This build can move the clock to the next sunset itself (say "jump to next sunset"), not to the start of its passage through the skyline.');
    expect(ranSince(from).map((x) => x.name)).not.toContain('jumpToEvent');
  });
});

describe("deterministic mode: Earth's centre and any part of Earth's disc", () => {
  beforeEach(() => {
    installFakeApp(ALL_ACTIONS);
  });

  it('reports both definitions side by side, each named', async () => {
    const e = engine();
    await e.reply('go to IM-2');
    const r = await e.reply('metrics');
    const m = lastResult('getAnalysis').metrics;
    const f1 = (v: number) => v.toFixed(1);
    expect(r.text).toContain(
      `Earth's centre in view ${f1(m.earthVisiblePct)} %, longest Earth-centre gap ${f1(m.longestEarthGapH)} h, any part of Earth's disc in view ${f1(m.earthAnyPct)} %, longest spell with Earth's whole disc hidden ${f1(m.longestEarthAnyGapH)} h`,
    );
    expect(m.earthAnyPct).toBeGreaterThan(m.earthVisiblePct);
  });

  it("gives the comparison's any-part difference apart from the centre's", async () => {
    const e = engine();
    await e.reply('go to IM-2 then save as A');
    await e.reply('go to Apollo 11 then save as B');
    const r = await e.reply('compare A and B');
    const d = lastResult('compare').diff;
    expect(r.text).toContain(`Earth's centre in view ${d.earthVisiblePct > 0 ? '+' : ''}${d.earthVisiblePct.toFixed(1)} percentage points`);
    expect(r.text).toContain(`any part of Earth's disc in view ${d.earthAnyPct > 0 ? '+' : ''}${d.earthAnyPct.toFixed(1)} percentage points`);
  });
});

describe('deterministic mode: the default solar band is no requirement (finding Q-5)', () => {
  beforeEach(() => {
    installFakeApp(ALL_ACTIONS);
  });

  it('says what the core says while the band is the default 0° to 90° (T-46: `required: false`)', async () => {
    const e = engine();
    await e.reply('go to IM-2');
    const r = await e.reply('metrics');
    const band = lastResult('getAnalysis').requirements.sunElevationBand;
    expect(band).toMatchObject({ required: false, minDeg: 0, maxDeg: 90, metForWholeWindow: null });
    expect(r.text).not.toContain('leaves the required elevation band');
    expect(r.text).toContain(`${band.note} The Sun's elevation ranges from -1.2° to 4.6° during the window, so it goes below the horizontal.`);
  });

  it('does not report a band failure on a core before T-46 either, which calls the default band "not met"', async () => {
    installFakeApp({ ...ALL_ACTIONS, bandRule: false });
    const e = engine();
    await e.reply('go to IM-2');
    const r = await e.reply('metrics');
    const band = lastResult('getAnalysis').requirements.sunElevationBand;
    expect(band.required).toBeUndefined();
    expect(band).toMatchObject({ minDeg: 0, maxDeg: 90, metForWholeWindow: false });
    expect(r.text).not.toContain('leaves the required elevation band');
    expect(r.text).toContain("No solar elevation band is set (the Filters default, 0° to 90°, means no requirement). The Sun's elevation ranges from -1.2° to 4.6° during the window, so it goes below the horizontal.");
  });

  it('still reports a band the user set', async () => {
    const e = engine();
    await e.reply('go to IM-2; sun elevation between 0 and 60');
    const r = await e.reply('metrics');
    expect(lastResult('getAnalysis').requirements.sunElevationBand).toMatchObject({ required: true, metForWholeWindow: false });
    expect(r.text).toContain('The Sun leaves the required elevation band (0.0° to 60.0°) during the window: it ranges from -1.2° to 4.6°.');
    expect(r.text).not.toMatch(/No solar elevation band is (set|required)/);
  });
});

describe("deterministic mode: the view's target, not its momentary centre", () => {
  let state: FakeState;
  beforeEach(() => {
    state = installFakeApp(ALL_ACTIONS);
  });

  it('zooms and shows the whole Moon about the point the view was asked to centre on', async () => {
    const e = engine();
    await e.reply('show the south pole');
    // The globe stops 0.1° short of the pole; the view's target is the pole itself.
    expect(state.globeCenter.latDeg).toBe(-89.9);
    expect(state.viewTarget).toEqual({ latDeg: -90, lonDegEast: 0 });
    let from = lastSeq();
    await e.reply('zoom in');
    await e.reply('show the whole moon');
    expect(ranSince(from).filter((x) => x.name === 'setGlobeCamera').map((x) => [x.params.lat, x.params.lon])).toEqual([[-90, 0], [-90, 0]]);

    // Turned by hand: no target any more, the drawn centre is the view.
    state.viewTarget = null;
    state.globeCenter = { latDeg: 12, lonDegEast: 30, altitudeKm: 4000 };
    from = lastSeq();
    await e.reply('zoom in');
    expect(ranSince(from).filter((x) => x.name === 'setGlobeCamera').map((x) => x.params)).toEqual([{ lat: 12, lon: 30, altitudeKm: 2000 }]);
  });
});

describe("deterministic mode: the card's records and the real clock (T-44)", () => {
  beforeEach(() => {
    installFakeApp(ALL_ACTIONS);
  });

  it('says who the hardware belongs to and how big the explored area is, with the sources', async () => {
    const e = engine();
    await e.reply('go to IM-2');
    const from = lastSeq();
    expect((await e.reply('who owns this site?')).text).toBe('IM-2 Athena belongs to United States (GCAT state code US); owner: Intuitive Machines, GCAT id fixture-im-2. Source: GCAT stand-in record.');
    expect((await e.reply('how big is the explored area?')).text).toBe('The explored area at IM-2 Athena: about 40 m across, 1,257 m² (true size). Source: stand-in area.');
    // Read from getState only: nothing changed.
    expect(ranSince(from).map((x) => x.name)).toEqual(['getState', 'getState']);
  });

  it('says plainly when there is no record, and that a pin has none', async () => {
    const e = engine();
    await e.reply('go to Chandrayaan-3');
    expect((await e.reply('who does it belong to')).text).toBe('No ownership record is available for Chandrayaan-3.');
    await e.reply('drop a pin at 10 N 20 E');
    expect((await e.reply('who owns this site')).text).toContain('is not a catalogued landing, so it has no ownership record and no explored area.');
  });

  it('reads the real clock apart from the simulated one', async () => {
    const e = engine();
    const r = await e.reply('what is the real time?');
    expect(r.text).toBe('The real date and time on this computer is 2026-11-15 04:00 UTC. The simulated clock shows 2026-03-01 12:00 UTC and is paused. "Start the mission window now in real time" starts the window at the real time.');
    // The simulated time is still its own question.
    expect((await e.reply('what time is it?')).text).toBe('The simulated time is 2026-03-01 12:00 UTC, and the clock is paused.');
  });
});
