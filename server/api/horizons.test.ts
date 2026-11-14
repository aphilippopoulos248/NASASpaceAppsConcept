import { mkdtempSync, readdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { horizonsParams, horizonsTable, parseQuery, QueryError } from './horizons';
import handler from './horizons';

const ok = 'lat=-84.79&lon=29.2&altKm=5.321&start=2025-03-06T17:00:00Z&stop=2025-03-06T18:00:00Z&stepMin=30';
const fake = (rows: number) => {
  const calls: string[] = [];
  const f = async (url: string) => {
    calls.push(url);
    const lines = Array.from({ length: rows }, (_, i) => ` ${(2460741.208333333 + i / 48).toFixed(9)},*, ,  65.9${i},  2.4${i},  0.99224146158115,  1.39,`);
    return `header\n$$SOE\n${lines.join('\n')}\n$$EOE\nfooter`;
  };
  return { f, calls };
};

function mockRes() {
  const r = { statusCode: 0, headers: {} as Record<string, string>, body: '' };
  return Object.assign(r, {
    setHeader: (k: string, v: string) => { r.headers[k] = v; },
    end: (b: string) => { r.body = b; },
  });
}

describe('/api/horizons query validation', () => {
  it('accepts a well-formed query', () => {
    const q = parseQuery(new URLSearchParams(ok));
    expect(q).toMatchObject({ lat: -84.79, lon: 29.2, altKm: 5.321, stepMin: 30 });
  });
  it.each([
    ['unknown parameter', ok + '&COMMAND=499'],
    ['injection in a number', ok.replace('lat=-84.79', "lat=1'%20OR")],
    ['latitude out of range', ok.replace('lat=-84.79', 'lat=95')],
    ['bad time', ok.replace('2025-03-06T17:00:00Z', 'yesterday')],
    ['stop before start', ok.replace('stop=2025-03-06T18', 'stop=2025-03-06T16')],
    ['too many rows', ok.replace('stop=2025-03-06T18:00:00Z', 'stop=2025-04-30T00:00:00Z').replace('stepMin=30', 'stepMin=1')],
    ['fractional step', ok.replace('stepMin=30', 'stepMin=2.5')],
  ])('rejects %s', (_n, qs) => {
    expect(() => parseQuery(new URLSearchParams(qs))).toThrow(QueryError);
  });
  it('sends only the fixed topocentric airless query to Horizons', () => {
    const p = horizonsParams(parseQuery(new URLSearchParams(ok)), '399');
    expect(p.get('CENTER')).toBe("'coord@301'");
    expect(p.get('APPARENT')).toBe("'AIRLESS'");
    expect(p.get('SITE_COORD')).toBe("'29.2,-84.79,5.321'");
    expect([...p.keys()].sort()).toEqual(['ANG_FORMAT', 'APPARENT', 'CAL_FORMAT', 'CENTER', 'COMMAND', 'COORD_TYPE', 'CSV_FORMAT', 'EPHEM_TYPE', 'EXTRA_PREC', 'QUANTITIES', 'SITE_COORD', 'START_TIME', 'STEP_SIZE', 'STOP_TIME', 'TIME_DIGITS', 'format']);
  });
});

describe('/api/horizons handler', () => {
  it('returns a table and caches it on disk', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'hz-'));
    const { f, calls } = fake(3);
    const t = await horizonsTable(parseQuery(new URLSearchParams(ok)), f, dir);
    expect(t.n).toBe(3);
    expect(t.stepMs).toBe(30 * 60_000);
    expect(readdirSync(dir).length).toBe(2);
    await horizonsTable(parseQuery(new URLSearchParams(ok)), f, dir);
    expect(calls.length).toBe(2); // second time from cache
  });
  it('fails cleanly (502 JSON) when offline', async () => {
    const res = mockRes();
    await handler({ method: 'GET', url: `/api/horizons?${ok.replace('stepMin=30', 'stepMin=7')}` } as never, res as never, async () => { throw new Error('getaddrinfo ENOTFOUND'); });
    expect(res.statusCode).toBe(502);
    expect(JSON.parse(res.body).error).toMatch(/unavailable/);
  });
  it('400 on a bad query, 405 on POST', async () => {
    const a = mockRes();
    await handler({ method: 'GET', url: '/api/horizons?lat=1' } as never, a as never);
    expect(a.statusCode).toBe(400);
    const b = mockRes();
    await handler({ method: 'POST', url: '/api/horizons' } as never, b as never);
    expect(b.statusCode).toBe(405);
  });
  it('does not cache Horizons error pages', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'hz-'));
    await expect(horizonsTable(parseQuery(new URLSearchParams(ok)), async () => 'ERROR: bad site', dir)).rejects.toThrow(/did not return a table/);
    expect(readdirSync(dir).length).toBe(0);
  });
});
