/// <reference types="node" />
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { offsetLatLon } from '../scene/surface/ground';
import type { Landing } from './landings';
import { buildTrack, compassPoint, describeRovers, localOffset, parseRovers, roversAtSite, roverStateAt, trackReachM, type RoverTrack } from './rovers';

const read = (path: string) => JSON.parse(readFileSync(join(process.cwd(), 'public', path), 'utf8'));
const landings = (read('data/landings.json') as { landings: Landing[] }).landings;
const raw = read('data/rovers.json') as { note: string; rovers: Record<string, unknown>[] };
const file = parseRovers(raw);
const tracks: RoverTrack[] = file.rovers.map((r) => buildTrack(r, landings.find((l) => l.id === r.siteId)!, file.epochMs));

describe('the packaged rovers (simulated)', () => {
  it('say that they are simulated, in the file and on every rover', () => {
    expect(raw.note).toMatch(/^SIMULATED, NOT DATA/);
    expect(file.rovers.length).toBeGreaterThanOrEqual(10);
    for (const r of file.rovers) expect(r.simulated).toBe(true);
  });

  it('are placed beside landings in the catalogue, under that landing\'s country', () => {
    for (const r of file.rovers) {
      const site = landings.find((l) => l.id === r.siteId);
      expect(site, `${r.id}: ${r.siteId}`).toBeDefined();
      expect(r.country).toBe(site!.country);
      expect(r.home).toEqual({ lat: r.path[0].lat, lon: r.path[0].lon });
    }
    expect(roversAtSite(file.rovers, 'apollo-17').map((r) => r.id)).toEqual(['rover-11', 'rover-12']);
    expect(roversAtSite(file.rovers, 'apollo-11')).toEqual([]);
  });

  it('drive at the speed of real vehicles', () => {
    for (const r of file.rovers) {
      if (r.kind === 'crewed') expect(r.speedMps).toBeGreaterThan(1), expect(r.speedMps).toBeLessThanOrEqual(4.2);
      else expect(r.speedMps).toBeGreaterThanOrEqual(0.04), expect(r.speedMps).toBeLessThanOrEqual(0.5);
    }
  });

  it('keep to a circuit near the site that never runs over the lander', () => {
    for (const t of tracks) {
      const reach = t.rover.kind === 'crewed' ? 1500 : 250;
      const steps = t.points.map((p, i) => Math.hypot(t.points[(i + 1) % t.points.length].eastM - p.eastM, t.points[(i + 1) % t.points.length].northM - p.northM));
      for (const p of t.points) {
        const d = Math.hypot(p.eastM, p.northM);
        expect(d, t.rover.id).toBeGreaterThan(7.5);
        expect(d, t.rover.id).toBeLessThan(reach);
      }
      // Points are close together, the closing step included: the circuit has no jump in it.
      expect(Math.max(...steps), t.rover.id).toBeLessThan(t.rover.kind === 'crewed' ? 40 : 12);
      expect(Math.abs(t.lengthM - t.rover.lengthM), t.rover.id).toBeLessThan(1);
      expect(t.rover.path.filter((p) => p.stopS).length, t.rover.id).toBeGreaterThanOrEqual(3);
    }
  });
});

describe('roverStateAt', () => {
  it('never moves faster than the rover drives, and covers a lap in a lap', () => {
    for (const t of tracks) {
      const t0 = Date.UTC(2026, 10, 15, 9, 30);
      const stepS = t.rover.kind === 'crewed' ? 1 : 5;
      let moved = 0;
      let prev = roverStateAt(t, t0);
      for (let s = stepS; s <= t.lapS; s += stepS) {
        const now = roverStateAt(t, t0 + s * 1000);
        const d = Math.hypot(now.eastM - prev.eastM, now.northM - prev.northM);
        expect(d, t.rover.id).toBeLessThanOrEqual(t.rover.speedMps * stepS + 1e-6);
        moved += d;
        prev = now;
      }
      // Sampling cuts corners a little, so a little less than the full length.
      expect(moved / t.lengthM, t.rover.id).toBeGreaterThan(0.97);
      expect(moved / t.lengthM, t.rover.id).toBeLessThanOrEqual(1 + 1e-9);
    }
  });

  it('repeats every lap, before the epoch as well as after', () => {
    for (const t of tracks) {
      for (const at of [Date.UTC(1969, 6, 20, 20, 17), file.epochMs, Date.UTC(2031, 4, 2)]) {
        const a = roverStateAt(t, at);
        const b = roverStateAt(t, at + 3 * t.lapS * 1000);
        expect(Math.hypot(a.eastM - b.eastM, a.northM - b.northM), t.rover.id).toBeLessThan(0.01);
      }
    }
  });

  it('halts at a station for its stop, facing the way it arrived, then drives on', () => {
    const t = tracks.find((x) => x.rover.id === 'rover-2')!;
    const first = t.rover.path[0];
    // Seconds into the lap are 0 at this instant.
    const lapStart = file.epochMs - t.rover.phaseS * 1000;
    const halted = roverStateAt(t, lapStart + (first.stopS! / 2) * 1000);
    expect(halted).toMatchObject({ moving: false, activity: first.activity, eastM: t.points[0].eastM, northM: t.points[0].northM });
    expect(halted.headingDeg).toBeCloseTo(roverStateAt(t, lapStart - 1000).headingDeg, 6);
    const driving = roverStateAt(t, lapStart + (first.stopS! + 10) * 1000);
    expect(driving.moving).toBe(true);
    expect(Math.hypot(driving.eastM - t.points[0].eastM, driving.northM - t.points[0].northM)).toBeCloseTo(t.rover.speedMps * 10, 6);
    expect(driving.activity).toBeUndefined();
  });
});

describe('localOffset', () => {
  it('undoes offsetLatLon, at the equator and beside the pole', () => {
    for (const [lat, lon] of [[0.67416, 23.47314], [-84.7906, 29.19567], [-45.4562, 177.5886]]) {
      for (const [e, n] of [[120, -45], [-700, 310], [0, 9]]) {
        const p = offsetLatLon(lat, lon, e, n);
        const back = localOffset(lat, lon, p.lat, p.lon);
        expect(back.eastM).toBeCloseTo(e, 4);
        expect(back.northM).toBeCloseTo(n, 4);
      }
    }
  });
});

describe('parseRovers', () => {
  const one = () => ({ simulated: true, epochUtc: '2026-01-01T00:00:00Z', rovers: [structuredClone(raw.rovers[0])] });

  it('refuses a file or a rover that is not marked simulated', () => {
    expect(() => parseRovers({ ...one(), simulated: false })).toThrow(/simulated/);
    const f = one();
    delete f.rovers[0].simulated;
    expect(() => parseRovers(f)).toThrow(/"rover-1": must be marked "simulated": true/);
  });

  it('names the rover and the field that is wrong', () => {
    const f = one();
    f.rovers[0].speedMps = 0;
    expect(() => parseRovers(f)).toThrow(/rover "rover-1": "speedMps" must be a number/);
    const g = one();
    (g.rovers[0].path as { lat: unknown }[])[2].lat = 'north';
    expect(() => parseRovers(g)).toThrow(/"path\[2\]\.lat"/);
    const h = one();
    h.rovers.push(structuredClone(h.rovers[0]));
    expect(() => parseRovers(h)).toThrow(/used twice/);
  });
});

describe('describeRovers', () => {
  it('says where each rover of a site is from the lander, and how far its circuit reaches', () => {
    const here = tracks.filter((t) => t.rover.siteId === 'im-2');
    const second = here.find((t) => t.rover.id === 'rover-2')!;
    const lapStart = file.epochMs - second.rover.phaseS * 1000;
    const p = second.points[0];
    const line = describeRovers(here, lapStart + 1000);
    expect(line).toContain(`Rover 2: ${Math.round(Math.hypot(p.eastM, p.northM))} m ${compassPoint(p.eastM, p.northM)} of the lander, halted: ${second.rover.path[0].activity!.toLowerCase()} (circuit within ${Math.ceil(trackReachM(second))} m)`);
    expect(line).toMatch(/^Rover 1: \d+ m [NESW]{1,2} of the lander, /);
    expect(describeRovers([], 0)).toBe('');
  });

  it('names the eight compass points', () => {
    expect([[0, 5], [5, 5], [5, 0], [5, -5], [0, -5], [-5, -5], [-5, 0], [-5, 5]].map(([e, n]) => compassPoint(e, n))).toEqual(['N', 'NE', 'E', 'SE', 'S', 'SW', 'W', 'NW']);
  });
});
