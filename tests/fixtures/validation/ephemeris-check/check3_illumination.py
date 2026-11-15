#!/usr/bin/env python3
"""Check 3: long-term sunlight and Earth visibility at south-polar points.

Three numbers side by side for each point:
  PGDA      the published multi-year average (PGDA product 69, AVGVISIB_85S_060M_201608 and
            its _EARTH twin: share of hourly steps over 18.6 years with ANY part of the disc
            visible, on the 60 m LOLA model LDEM_85S_060M; the label states neither the
            calendar span nor a height above the ground)
  own       this fixture's computation on the elevation data Lunyx bundles: Sun and Earth
            from SPICE (DE440; reproduces Horizons to 0.000002 deg, see the T-18 fixture)
            against reference/skyline.<site>.m<mast>.json, same hourly instants as the app
  app       analyse() over the same 18.6 years (illumination/app-*.json)

    python3 -I tests/fixtures/validation/ephemeris-check/check3_illumination.py [--write] [--neighbours]

Needs the two PGDA rasters (51 MB each) and the SPICE kernels in scripts/.cache/ephemeris-check/
(git-ignored; download commands in README.md). --neighbours also evaluates the eight points
60 m around each crest pin, to show how much a single 60 m step changes the answer.
"""
import argparse
import hashlib
import json
import math
import os
import sys
import time

sys.path.insert(0, os.path.join(os.path.dirname(os.path.abspath(__file__)), 'lib'))
import common  # noqa: E402
import numpy as np  # noqa: E402
import lunyx_dem as dem  # noqa: E402
import skyline as sk  # noqa: E402
import skygeom as sg  # noqa: E402
import spiceypy as spice  # noqa: E402

ap = argparse.ArgumentParser()
ap.add_argument('--write', action='store_true')
ap.add_argument('--neighbours', action='store_true')
ap.add_argument('--apps', nargs='*', default=['before', 'now'], help='app dumps to compare: illumination/app-<name>.json')
ap.add_argument('--tag', default='', help='write results-<tag>.* instead of results.* (keeps the earlier record)')
args = ap.parse_args()
DIR = os.path.join(common.BASE, 'illumination')
PGDA = os.path.join(common.CACHE, 'pgda')
for k in ('naif0012.tls', 'pck00011.tpc', 'moon_pa_de440_200625.bpc', 'moon_de440_250416.tf', 'de440s.bsp'):
    spice.furnsh(os.path.join(common.CACHE, 'kernels', k))

# ---------------------------------------------------------------- PGDA rasters
N, MPP, C = 5058, 60.0, 2528.5  # label: 5058 x 5058, 60 m/pix, LINE/SAMPLE_PROJECTION_OFFSET 2528.5
PRODUCTS = {'sun': 'AVGVISIB_85S_060M_201608.IMG', 'earth': 'AVGVISIB_85S_060M_201608_EARTH.IMG'}
raster, pgda_sha = {}, {}
for key, name in PRODUCTS.items():
    path = os.path.join(PGDA, name)
    with open(path, 'rb') as fh:
        pgda_sha[name] = hashlib.sha256(fh.read()).hexdigest()
    raster[key] = np.fromfile(path, dtype='<i2').reshape(N, N)


def pgda_pixel(lat, lon):
    r = 2 * dem.R_M * math.tan(math.radians((90 + lat) / 2))
    return C + r * math.sin(math.radians(lon)) / MPP, C - r * math.cos(math.radians(lon)) / MPP


def pixel_latlon(col, row):
    x, y = (col - C) * MPP, (C - row) * MPP
    return 2 * math.degrees(math.atan(math.hypot(x, y) / (2 * dem.R_M))) - 90, math.degrees(math.atan2(x, y))


def pgda_at(key, lat, lon):
    fx, fy = pgda_pixel(lat, lon)
    c, r = int(round(fx)), int(round(fy))
    block = raster[key][r - 1:r + 2, c - 1:c + 2] * 0.004  # DN * 0.00004 = fraction; in percent
    return {'pixel': float(raster[key][r, c] * 0.004), 'min3x3': float(block.min()), 'median3x3': float(np.median(block)), 'max3x3': float(block.max()), 'col': c, 'row': r}


# ---------------------------------------------------------------- own computation
def spice_series(lat, lon, alt_m, t_unix):
    """Sun and Earth az/el/angular radius at a site for an array of UTC instants."""
    east, north, up = dem.frame(lat, lon)
    pos = list((dem.R_M + alt_m) / 1000.0 * up)
    out = {b: np.empty((t_unix.size, 3)) for b in ('sun', 'earth')}
    radius = {'sun': 695700.0, 'earth': 6378.137}
    for i, t in enumerate(t_unix):
        utc = t - 946728000.0                      # seconds past J2000 on the UTC scale (no leap seconds counted, like a JavaScript Date)
        et = utc + spice.deltet(utc, 'UTC')
        for body in ('sun', 'earth'):
            v = np.array(spice.spkcpo(body.upper(), et, 'MOON_ME', 'OBSERVER', 'LT+S', pos, 'MOON', 'MOON_ME')[0][:3])
            d = np.linalg.norm(v)
            out[body][i] = (math.degrees(math.atan2(v @ east, v @ north)) % 360.0, math.degrees(math.asin((v @ up) / d)), math.degrees(math.asin(radius[body] / d)))
    return out


def own_metrics(series, skyline):
    s, e = series['sun'], series['earth']
    frac, top = sg.disc(s[:, 0], s[:, 1], s[:, 2], skyline)
    _, e_top = sg.disc(e[:, 0], e[:, 1], e[:, 2], skyline)
    return {
        'sunAnyPct': float(100.0 * np.mean(top > 0)), 'sunDiscPct': float(100.0 * np.mean(frac)),
        'earthCentrePct': float(100.0 * np.mean(sg.centre_clearance(e[:, 0], e[:, 1], skyline) > 0)), 'earthAnyPct': float(100.0 * np.mean(e_top > 0)),
    }


with open(os.path.join(DIR, 'scenarios.json')) as fh:
    scenarios = json.load(fh)
with open(os.path.join(common.BASE, 'sites.json')) as fh:
    sites = json.load(fh)['sites']
apps = {}
for name in args.apps:
    p = os.path.join(DIR, 'app-%s.json' % name)
    if os.path.exists(p):
        with open(p) as fh:
            d = json.load(fh)
        apps[name] = {'commit': d['app']['commit'], 'by_id': {r['id']: r for r in d['results']}}

t0 = sg.to_unix(scenarios[0]['start'])
hours = scenarios[0]['durationH']
t = t0 + 3600.0 * np.arange(hours + 1)
lines = []
out = lines.append
out('Window: %s + %d h (18.6 years), one sample per hour, %d instants. Percent of instants.' % (scenarios[0]['start'], hours, t.size))
out('PGDA = product 69: 60 m pixels, any part of the disc, hourly over 18.6 years; its label states neither the calendar span nor a height above the ground.')
out('')
report = {'window': {'start': scenarios[0]['start'], 'durationH': hours, 'stepMin': 60}, 'pgdaFiles': pgda_sha, 'sites': {}}
series_cache = {}
for sc in scenarios:
    sid, mast = sc['siteKey'], sc['mastHeightM']
    site = sites[sid]
    sky = sg.Skyline.load(os.path.join(common.BASE, 'reference', 'skyline.%s.m%g.json' % (sid, mast)))
    if sid not in series_cache:
        # The series only depends on the site and the instants: keep it in the git-ignored cache between runs.
        cache = os.path.join(common.CACHE, 'spice-series', '%s.%d.%d.npz' % (sid, int(t0), hours))
        if os.path.exists(cache):
            z = np.load(cache)
            series_cache[sid] = {'sun': z['sun'], 'earth': z['earth']}
        else:
            tic = time.time()
            series_cache[sid] = spice_series(site['lat'], site['lon'], sky.extra['groundM'] + 1.0, t)
            os.makedirs(os.path.dirname(cache), exist_ok=True)
            np.savez(cache, **series_cache[sid])
            sys.stderr.write('%s: SPICE series in %.0f s\n' % (sid, time.time() - tic))
    own = own_metrics(series_cache[sid], sky)
    own05 = own_metrics(series_cache[sid], sky.resampled(0.5))
    entry = report['sites'].setdefault(sid, {'site': site, 'pgda': {k: pgda_at(k, site['lat'], site['lon']) for k in ('sun', 'earth')}, 'masts': {}})
    if mast == scenarios[0]['mastHeightM']:
        p = entry['pgda']
        out('%s  (%.4f, %.4f)  ground %.1f m' % (sid, site['lat'], site['lon'], sky.extra['groundM']))
        out('  PGDA  Sun %6.2f %%  (the 9 pixels around it: %5.2f .. %5.2f, median %5.2f)     Earth %6.2f %%  (%5.2f .. %5.2f, median %5.2f)'
            % (p['sun']['pixel'], p['sun']['min3x3'], p['sun']['max3x3'], p['sun']['median3x3'], p['earth']['pixel'], p['earth']['min3x3'], p['earth']['max3x3'], p['earth']['median3x3']))
    m = {'own': own, 'ownSkylineEvery0p5deg': own05, 'apps': {}}
    out('  %g m above ground' % mast)
    out('    own            any Sun %6.2f %%   disc average %6.2f %%   Earth centre %6.2f %%   any Earth %6.2f %%   (skyline every 0.5 deg instead of 0.1: any Sun %6.2f, Earth centre %6.2f)'
        % (own['sunAnyPct'], own['sunDiscPct'], own['earthCentrePct'], own['earthAnyPct'], own05['sunAnyPct'], own05['earthCentrePct']))
    for name, app in apps.items():
        r = app['by_id'].get(sc['id'])
        if not r:
            continue
        mm = r['metrics']
        m['apps'][name] = {'commit': app['commit'], 'sunAnyPct': mm['sunAnyPct'], 'illuminationPct': mm['illuminationPct'], 'earthVisiblePct': mm['earthVisiblePct'],
                           'sunAnyMinusOwn': mm['sunAnyPct'] - own['sunAnyPct'], 'illuminationMinusOwn': mm['illuminationPct'] - own['sunDiscPct'], 'earthMinusOwn': mm['earthVisiblePct'] - own['earthCentrePct'],
                           'longestDarknessH': mm['longestDarknessH'], 'ephemeris': r['series']['source']}
        anyE = ''
        if mm.get('earthAnyPct') is not None:  # T-31 item 3: any part of Earth's disc (PGDA's definition)
            m['apps'][name].update({'earthAnyPct': mm['earthAnyPct'], 'earthAnyMinusOwn': mm['earthAnyPct'] - own['earthAnyPct'], 'earthAnyMinusPgda': mm['earthAnyPct'] - entry['pgda']['earth']['pixel']})
            anyE = '   any Earth %6.2f %% (%+5.2f; PGDA %+6.2f)' % (mm['earthAnyPct'], mm['earthAnyPct'] - own['earthAnyPct'], mm['earthAnyPct'] - entry['pgda']['earth']['pixel'])
        out('    app %-9s  any Sun %6.2f %% (%+5.2f)   disc average %6.2f %% (%+5.2f)   Earth centre %6.2f %% (%+5.2f)   longest darkness %.0f h%s'
            % (app['commit'], mm['sunAnyPct'], mm['sunAnyPct'] - own['sunAnyPct'], mm['illuminationPct'], mm['illuminationPct'] - own['sunDiscPct'], mm['earthVisiblePct'], mm['earthVisiblePct'] - own['earthCentrePct'], mm['longestDarknessH'], anyE))
    entry['masts']['%g' % mast] = m

if args.neighbours:
    out('')
    out('How much one 60 m step matters (own computation at the surface, skyline every 0.5 deg): the 9 PGDA pixel centres around each crest pin')
    for sid in ('shackleton-rim', 'connecting-ridge', 'ridge-top', 'rim-top'):
        site = sites[sid]
        stack = dem.stack_for(common.ROOT, site['lat'], site['lon'])
        p = report['sites'][sid]['pgda']['sun']
        az = np.arange(720) * 0.5
        own_grid, pgda_grid = [], []
        # Nine skylines take about two minutes: keep the own values in the git-ignored cache (they do not depend on the app).
        cache = os.path.join(common.CACHE, 'spice-series', 'neighbours.%s.%d.%d.json' % (sid, int(t0), hours))
        cached = None
        if os.path.exists(cache):
            with open(cache) as fh:
                cached = json.load(fh)
        for dr in (-1, 0, 1):
            for dc in (-1, 0, 1):
                pgda_grid.append(float(raster['sun'][p['row'] + dr, p['col'] + dc] * 0.004))
                if cached is None:
                    la, lo = pixel_latlon(p['col'] + dc, p['row'] + dr)
                    ref = sk.skyline(stack, la, lo, 0.0, az)
                    own_grid.append(own_metrics(series_cache[sid], sg.Skyline(ref['elev_deg'], 0.5))['sunAnyPct'])
        if cached is not None:
            own_grid = cached
        else:
            with open(cache, 'w') as fh:
                json.dump(own_grid, fh)
        report['sites'][sid]['neighbours3x3'] = {'ownSunAnyPct': own_grid, 'pgdaSunPct': pgda_grid}
        fmt = lambda g: '  '.join('%5.1f' % v for v in g)
        out('  %-17s own  [%s]   min %5.1f  median %5.1f  max %5.1f' % (sid, fmt(own_grid), min(own_grid), float(np.median(own_grid)), max(own_grid)))
        out('  %-17s PGDA [%s]   min %5.1f  median %5.1f  max %5.1f' % ('', fmt(pgda_grid), min(pgda_grid), float(np.median(pgda_grid)), max(pgda_grid)))

text = '\n'.join(lines)
print(text)
if args.write:
    stem = 'results-%s' % args.tag if args.tag else 'results'
    with open(os.path.join(DIR, stem + '.json'), 'w') as fh:
        json.dump(report, fh, indent=1)
        fh.write('\n')
    with open(os.path.join(DIR, stem + '.txt'), 'w') as fh:
        fh.write(text + '\n')
