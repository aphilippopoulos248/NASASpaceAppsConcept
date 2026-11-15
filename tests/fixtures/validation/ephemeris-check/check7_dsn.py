#!/usr/bin/env python3
"""Check 7: geometric opportunities with the three DSN 70 m stations.

Reference: JPL Horizons, both ways (dsn/horizons/*.json, fetched by fetch_horizons_pairs.mjs):
the lunar site as seen from Horizons' own DSN sites (-14@399, -43@399, -63@399), and each
station as seen from the lunar site, against this fixture's own skyline. Dates the app's
author did not use: August 2023 (Chandrayaan-3 site), March 2025 around an Earthset at IM-2,
April 2031 (Apollo 11 site). Under test: analysis.dsn and dsnAt() (dsn/app-now.json).

    python3 -I tests/fixtures/validation/ephemeris-check/check7_dsn.py [--write]

An opportunity, as the app defines it: the site is above the station's elevation limit AND the
station is above the site's terrain skyline. Geometry only, airless.
"""
import argparse
import json
import math
import os
import sys

sys.path.insert(0, os.path.join(os.path.dirname(os.path.abspath(__file__)), 'lib'))
import common  # noqa: E402
import numpy as np  # noqa: E402
import skygeom as sg  # noqa: E402

ap = argparse.ArgumentParser()
ap.add_argument('--write', action='store_true')
args = ap.parse_args()
DIR = os.path.join(common.BASE, 'dsn')
with open(os.path.join(DIR, 'scenarios.json')) as fh:
    scenarios = json.load(fh)
with open(os.path.join(DIR, 'app-now.json')) as fh:
    app = json.load(fh)
by_id = {r['id']: r for r in app['results']}
hms = lambda t: sg.to_iso(t)[5:19].replace('T', ' ')
wrap = lambda a: (a + 180.0) % 360.0 - 180.0


def load(qid):
    with open(os.path.join(DIR, 'horizons', qid + '.json')) as fh:
        return json.load(fh)


class Cubic:
    """A regularly sampled quantity read between samples with a four-point (Catmull-Rom) cubic."""

    def __init__(self, t0, step, values):
        self.t0, self.step, self.v = float(t0), float(step), np.asarray(values, dtype=np.float64)

    def at(self, t):
        x = (np.asarray(t, dtype=np.float64) - self.t0) / self.step
        i = np.clip(np.floor(x).astype(np.int64), 0, self.v.size - 2)
        f = x - i
        p0, p1, p2, p3 = self.v[np.clip(i - 1, 0, None)], self.v[i], self.v[i + 1], self.v[np.clip(i + 2, None, self.v.size - 1)]
        return 0.5 * ((2 * p1) + (-p0 + p2) * f + (2 * p0 - 5 * p1 + 4 * p2 - p3) * f ** 2 + (-p0 + 3 * p1 - 3 * p2 + p3) * f ** 3)


def spans(fn, t0, t1):
    """[(start, end, open_start, open_end)] where fn > 0, edges bisected to one second."""
    t = np.arange(t0, t1 + 1.0, 60.0)
    g = fn(t)
    out = []
    for a, b, oa, ob in sg.intervals(t, g):
        if not oa:
            a = sg.refine(lambda x: float(fn(np.array([x]))[0]), a - 60, a + 60)
        if not ob:
            b = sg.refine(lambda x: float(fn(np.array([x]))[0]), b - 60, b + 60)
        out.append((a, b, oa, ob))
    return out


lines = []
out = lines.append
report = {'app': app['app']['commit'], 'stations': {}, 'scenarios': {}}

# ---- 1. the stations themselves
out('1. Station coordinates: the app (DSN handbook 810-005) against Horizons\' own DSN sites')
first = by_id[scenarios[0]['id']]
for st in first['dsn']['stations']:
    s = st['station']
    h = load('%s.dss%s.station-sees-site' % (scenarios[0]['id'], s['id'].split('-')[1]))['horizons']
    lon_h, lat_h, alt_h = h['centerGeodetic']
    d_lat = (s['latDeg'] - lat_h) * 111320.0
    d_lon = wrap(s['lonDeg'] - lon_h) * 111320.0 * math.cos(math.radians(lat_h))
    d_h = s['heightM'] - alt_h * 1000.0
    out('   %s  app %.7f, %.7f, %.2f m   Horizons "%s" %.7f, %.7f, %.2f m   difference %.2f m north, %.2f m east, %.2f m up; limits %g / %g deg'
        % (s['id'], s['latDeg'], s['lonDeg'], s['heightM'], h['centerSite'], lat_h, wrap(lon_h), alt_h * 1000, d_lat, d_lon, d_h, s['receiveMaskDeg'], s['transmitMaskDeg']))
    report['stations'][s['id']] = {'app': [s['latDeg'], s['lonDeg'], s['heightM']], 'horizons': [lat_h, wrap(lon_h), alt_h * 1000.0], 'differenceM': [d_lat, d_lon, d_h], 'receiveMaskDeg': s['receiveMaskDeg'], 'transmitMaskDeg': s['transmitMaskDeg']}

worst = {'el': 0.0, 'az': 0.0, 'siteEl': 0.0, 'siteAz': 0.0, 'range': 0.0, 'mask_s': 0.0, 'terrain_min': 0.0, 'pct': 0.0}
for sc in scenarios:
    r = by_id[sc['id']]
    t0 = sg.to_unix(sc['start'])
    t1 = t0 + sc['durationH'] * 3600.0
    sky = sg.Skyline.load(os.path.join(common.BASE, 'reference', 'skyline.%s.m%g.json' % (sc['siteKey'], sc['mastHeightM'])))
    out('')
    out('2. %s  (%.4f, %.4f), %s + %d h, app ephemeris: %s' % (sc['id'], sc['site']['lat'], sc['site']['lon'], sc['start'], sc['durationH'], r['series']['source']))
    entry = {'stations': {}}
    series = {x['id']: x for x in r['dsn']['series']}
    at = {}
    for row in r.get('dsnAt', []):
        for st in row['stations']:
            at.setdefault(st['station']['id'], []).append((sg.to_unix(row['utc']), st))
    for st in r['dsn']['stations']:
        sid = st['station']['id']
        num = sid.split('-')[1]
        A = load('%s.dss%s.station-sees-site' % (sc['id'], num))
        B = load('%s.dss%s.site-sees-station' % (sc['id'], num))
        elA = Cubic(t0, A['stepMinutes'] * 60.0, A['el'])
        stB = sg.Series(t0, B['stepMinutes'] * 60.0, B['az'], B['el'], np.zeros(len(B['el'])))
        clear = lambda t: sg.centre_clearance(*stB.at(t)[:2], sky)
        # (a) elevation of the site at the station, every app sample
        app_el = np.array(series[sid]['stationElDeg'], dtype=np.float64)
        d_el = float(np.max(np.abs(app_el - np.array(A['el']))))
        # (b) azimuth, range and the site's view of the station, at the dsnAt instants
        d_az = d_sel = d_saz = d_rng = 0.0
        for t, v in at.get(sid, []):
            i = int(round((t - t0) / (A['stepMinutes'] * 60.0)))
            d_az = max(d_az, abs(wrap(v['stationAzDeg'] - A['az'][i]) * math.cos(math.radians(A['el'][i]))))
            d_rng = max(d_rng, abs(v['rangeKm'] - A['rangeKm'][i]))
            saz, sel, _ = stB.at(np.array([t]))
            d_sel = max(d_sel, abs(v['siteElDeg'] - sel[0]))
            d_saz = max(d_saz, abs(wrap(v['siteAzDeg'] - saz[0]) * math.cos(math.radians(sel[0]))))
        res = {'stationElWorstDeg': d_el, 'stationAzArcWorstDeg': d_az, 'rangeWorstKm': d_rng, 'siteElWorstDeg': d_sel, 'siteAzArcWorstDeg': d_saz, 'kinds': {}}
        out('   %s  site in the station\'s sky: elevation within %.4f deg (865 samples), azimuth arc %.4f deg, range %.1f km;  station in the site\'s sky: elevation %.4f, azimuth arc %.4f deg (25 instants)'
            % (sid, d_el, d_az, d_rng, d_sel, d_saz))
        for k, key in (('el', d_el), ('az', d_az), ('siteEl', d_sel), ('siteAz', d_saz), ('range', d_rng)):
            worst[k] = max(worst[k], key)
        # (c) opportunities
        for kind, mask in (('receive', st['station']['receiveMaskDeg']), ('transmit', st['station']['transmitMaskDeg'])):
            ref = spans(lambda t: np.minimum(elA.at(t) - mask, clear(t)), t0, t1)
            ref_pct = 100.0 * sum(b - a for a, b, _, _ in ref) / (t1 - t0)
            app_iv = [(iv['startMs'] / 1000.0, iv['endMs'] / 1000.0, bool(iv.get('openStart')), bool(iv.get('openEnd'))) for iv in st[kind]['intervals']]
            edges = []
            if len(app_iv) == len(ref):
                for (a0, a1, oa, ob), (r0, r1, _, _) in zip(app_iv, ref):
                    for ta, tr, is_open, which in ((a0, r0, oa, 'start'), (a1, r1, ob, 'end')):
                        if is_open:
                            continue
                        # What ends the reference span there: the station's limit, or the Moon's terrain?
                        by_terrain = float(clear(np.array([tr]))[0]) < float(elA.at(np.array([tr]))[0] - mask)
                        edges.append({'which': which, 'app': sg.to_iso(ta), 'reference': sg.to_iso(tr), 'appMinusReferenceS': ta - tr, 'limitedBy': 'lunar terrain' if by_terrain else 'station limit'})
            m = [abs(e['appMinusReferenceS']) for e in edges if e['limitedBy'] == 'station limit']
            tr_ = [abs(e['appMinusReferenceS']) / 60.0 for e in edges if e['limitedBy'] == 'lunar terrain']
            worst['mask_s'] = max([worst['mask_s']] + m)
            worst['terrain_min'] = max([worst['terrain_min']] + tr_)
            worst['pct'] = max(worst['pct'], abs(st[kind]['pct'] - ref_pct))
            res['kinds'][kind] = {'maskDeg': mask, 'appPct': st[kind]['pct'], 'referencePct': ref_pct, 'appSpans': len(app_iv), 'referenceSpans': len(ref), 'edges': edges}
            out('        %-8s limit %4.1f deg: app %5.2f %% in %d spans, reference %5.2f %% in %d; %d edges set by the station limit within %.1f s%s'
                % (kind, mask, st[kind]['pct'], len(app_iv), ref_pct, len(ref), len(m), max(m) if m else 0.0,
                   ('; %d set by lunar terrain within %.1f min' % (len(tr_), max(tr_))) if tr_ else ''))
            for e in edges:
                if e['limitedBy'] == 'lunar terrain':
                    out('            %-5s app %s  reference %s  %+6.1f min  (the station goes behind the Moon\'s skyline)' % (e['which'], hms(sg.to_unix(e['app'])), hms(sg.to_unix(e['reference'])), e['appMinusReferenceS'] / 60.0))
        entry['stations'][sid] = res
    report['scenarios'][sc['id']] = entry

out('')
out('Worst over all sites and stations: site elevation at the station %.4f deg, azimuth arc %.4f deg, range %.1f km; station in the site\'s sky %.4f / %.4f deg;'
    % (worst['el'], worst['az'], worst['range'], worst['siteEl'], worst['siteAz']))
out('edges set by a station\'s elevation limit within %.1f s; edges set by lunar terrain within %.1f min; share of the window within %.2f points.' % (worst['mask_s'], worst['terrain_min'], worst['pct']))
report['worst'] = worst
text = '\n'.join(lines)
print(text)
if args.write:
    with open(os.path.join(DIR, 'results.json'), 'w') as fh:
        json.dump(report, fh, indent=1)
        fh.write('\n')
    with open(os.path.join(DIR, 'results.txt'), 'w') as fh:
        fh.write(text + '\n')
