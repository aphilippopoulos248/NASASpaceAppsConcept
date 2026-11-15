#!/usr/bin/env python3
"""Blue Ghost Mission 1, sunset of 16 March 2025: how much does the choice of elevation product move it?

Independent of the app (nothing is called or read from src/): Sun from JPL Horizons (round 1's
cached rows, ../ephemeris-check/horizons/blue-ghost-1.2025-03.json), skyline from round 1's ray
march (../ephemeris-check/lib/skyline.py) over the bundled files read by lib/lunyx_dem.py, disc
events as in round 1's check 2 (61 strips, 1 min grid, bisected to 1 s).

The terrain is taken from one elevation product at a time:
  stack        the stored stack as bundled: LROC NAC 3 m model out to its edge (768 m from the
               site in the cardinal directions), then the SLDEM2015 60 m window, the 480 m
               window and the whole-Moon grid. This is what the app read before T-32 (and what
               round 1 used).
  60m          the same without the 3 m model: SLDEM2015 60 m window, 480 m window, whole Moon.
               Observer on the 60 m product's own ground.
  60m-obs3m    the 60 m terrain, observer on the 3 m model's ground (separates the terrain
               effect from the observer's datum).
  3m-alone     the 3 m model only; rays end at its edge (nothing beyond is seen).
The first four are the products as bundled, nothing eased or blended: their spread is the point.
One more row, for comparison only, is not a product:
  stack-eased  the stack with the 3 m model eased onto the 60 m window over its outer 129 m, as
               T-32 (e4b06ef) makes the app load it (lib/lunyx_dem.py eased_fine, the rule taken
               from T-32's handover text). Added after the four product rows were written.

    python3 -I tests/fixtures/validation/science-validation/check9_bg_products.py [--root DIR] [--write]
"""
import argparse
import hashlib
import json
import math
import os
import sys

HERE = os.path.dirname(os.path.abspath(__file__))
EC = os.path.join(HERE, '..', 'ephemeris-check')
sys.path.insert(0, os.path.join(EC, 'lib'))
import common  # noqa: E402
import numpy as np  # noqa: E402
import lunyx_dem as dem  # noqa: E402
import skyline as sk  # noqa: E402
import skygeom as sg  # noqa: E402

ap = argparse.ArgumentParser()
ap.add_argument('--root', default=common.ROOT)
ap.add_argument('--write', action='store_true')
args = ap.parse_args()
DIR = os.path.join(HERE, 'blue-ghost-products')
SITE = {'id': 'blue-ghost-1', 'lat': 18.562, 'lon': 61.81}
T0, T1 = sg.to_unix('2025-03-16T16:00:00Z'), sg.to_unix('2025-03-17T00:00:00Z')
ARC = np.arange(255.0, 285.0001, 0.05)
MASTS = (0.5, 2.0, 5.0)
ROUND1_2M = {'cut': '2025-03-16T18:23', 'half': '2025-03-16T18:56', 'lastLimb': '2025-03-16T19:30:03'}
hm = lambda t: sg.to_iso(t)[11:16]
hms = lambda t: sg.to_iso(t)[11:19]
lines = []
out = lines.append


def sha(path):
    h = hashlib.sha256()
    with open(path, 'rb') as fh:
        for chunk in iter(lambda: fh.read(1 << 20), b''):
            h.update(chunk)
    return h.hexdigest()[:16]


files = ['public/terrain/blue-ghost-1.bin', 'public/terrain/blue-ghost-1_fine.bin', 'public/terrain/index.json', 'public/data/dem/lola_global_16ppd.lxg']
hashes = {f: sha(os.path.join(args.root, f)) for f in files}
hz = sg.load_horizons(os.path.join(EC, 'horizons', 'blue-ghost-1.2025-03.json'))
sun = hz['sun']
entry, windows = dem.site_windows(args.root, SITE['id'])
fine = [l for l in windows if l.spacing == 3][0]
w60 = [l for l in windows if l.spacing == 60][0]
w480 = [l for l in windows if l.spacing == 480][0]
glob = dem.global_layer(args.root)
fine_eased = dem.eased_fine(fine, w60)
products = {
    'stack': dem.Stack([fine, w60, w480, glob]),
    '60m': dem.Stack([w60, w480, glob]),
    '60m-obs3m': dem.Stack([w60, w480, glob]),
    '3m-alone': dem.Stack([fine]),
    'stack-eased': dem.Stack([fine_eased, w60, w480, glob]),
}
g3 = float(fine.sample(np.array([SITE['lat']]), np.array([SITE['lon']]))[0])
g60 = float(w60.sample(np.array([SITE['lat']]), np.array([SITE['lon']]))[0])


def events(skyline):
    def edges(t):
        az, el, r = sun.at(t)
        return sg.disc_edges(az, el, r, skyline)
    cut = sg.crossings(lambda t: edges(t)[0], T0, T1)
    half = sg.crossings(lambda t: sg.disc(*sun.at(t), skyline)[0] - 0.5, T0, T1)
    limb = sg.crossings(lambda t: edges(t)[1], T0, T1)
    first = lambda c: next(t for t, k in c if k == 'set')
    return first(cut), first(half), first(limb)


def formed(arc, t):
    """Where the skyline is formed under the Sun's centre at instant t."""
    az = float(sun.at(np.array([t]))[0][0])
    j = int(round((az - ARC[0]) / 0.05))
    return {'sunAzDeg': round(az, 3), 'skylineDeg': round(float(arc['elev_deg'][j]), 4), 'distM': round(float(arc['dist_m'][j]), 1), 'heightM': round(float(arc['height_m'][j]), 2)}


report = {'site': SITE, 'window': [sg.to_iso(T0), sg.to_iso(T1)], 'fileSha256_16': hashes, 'groundAtSiteM': {'3m': g3, '60m': g60}, 'rows': []}
out('Blue Ghost Mission 1 (18.562 N, 61.81 E), sunset of 16 March 2025 UTC, by elevation product')
out('Ground under the lander: 3 m model %.2f m, 60 m window %.2f m (3 m minus 60 m: %+.2f m); heights above the 1737.4 km sphere.' % (g3, g60, g3 - g60))
out('3 m model: %s; 60 m window: %s.' % (fine.name, w60.name))
out('')
out('  eye     product      skyline cuts the Sun   half hidden   last limb gone   | skyline under the Sun at last limb: elevation, formed at, height')
for mast in MASTS:
    row = {'mastM': mast, 'products': {}}
    for name, stack in products.items():
        m = mast + (g3 - g60) if name == '60m-obs3m' else mast
        arc = sk.skyline(stack, SITE['lat'], SITE['lon'], m, ARC)
        sky = sg.ArcSkyline(ARC[0], 0.05, np.where(np.isfinite(arc['elev_deg']), arc['elev_deg'], -90.0))
        cut, half, last = events(sky)
        f_last, f_cut = formed(arc, last), formed(arc, cut)
        row['products'][name] = {'cut': sg.to_iso(cut), 'half': sg.to_iso(half), 'lastLimb': sg.to_iso(last), 'observerGroundM': arc['ground_m'] + (g3 - g60 if name == '60m-obs3m' else 0.0),
                                 'atLastLimb': f_last, 'atCut': f_cut, '_t': (cut, half, last)}
        out('  %3.1f m   %-11s  %s                  %s         %s         | %.3f deg, %.0f m, %.2f m'
            % (mast, name, hms(cut), hms(half), hms(last), f_last['skylineDeg'], f_last['distM'], f_last['heightM']))
        print(lines[-1], flush=True)
    t = {k: v.pop('_t') for k, v in row['products'].items()}
    span = lambda i, names: (max(t[n][i] for n in names) - min(t[n][i] for n in names)) / 60.0
    main = ('stack', '60m', '3m-alone')
    row['spreadMin'] = {'cut': span(0, main), 'half': span(1, main), 'lastLimb': span(2, main)}
    row['60mMinusStackMin'] = {'cut': (t['60m'][0] - t['stack'][0]) / 60, 'half': (t['60m'][1] - t['stack'][1]) / 60, 'lastLimb': (t['60m'][2] - t['stack'][2]) / 60}
    row['60mObs3mMinusStackMin'] = {'cut': (t['60m-obs3m'][0] - t['stack'][0]) / 60, 'lastLimb': (t['60m-obs3m'][2] - t['stack'][2]) / 60}
    row['3mAloneMinusStackMin'] = {'cut': (t['3m-alone'][0] - t['stack'][0]) / 60, 'lastLimb': (t['3m-alone'][2] - t['stack'][2]) / 60}
    row['easedMinusStackMin'] = {'cut': (t['stack-eased'][0] - t['stack'][0]) / 60, 'half': (t['stack-eased'][1] - t['stack'][1]) / 60, 'lastLimb': (t['stack-eased'][2] - t['stack'][2]) / 60}
    out('          spread over stack / 60m / 3m-alone: cut %.1f min, half %.1f min, last limb %.1f min;  60m minus stack: cut %+.1f, last limb %+.1f min (observer on the 3 m ground: %+.1f, %+.1f)'
        % (row['spreadMin']['cut'], row['spreadMin']['half'], row['spreadMin']['lastLimb'], row['60mMinusStackMin']['cut'], row['60mMinusStackMin']['lastLimb'],
           row['60mObs3mMinusStackMin']['cut'], row['60mObs3mMinusStackMin']['lastLimb']))
    print(lines[-1], flush=True)
    out('          T-32 eased stack minus stored stack: cut %+.1f min, half %+.1f min, last limb %+.1f min' % (row['easedMinusStackMin']['cut'], row['easedMinusStackMin']['half'], row['easedMinusStackMin']['lastLimb']))
    print(lines[-1], flush=True)
    report['rows'].append(row)

# Reproducibility of round 1 and numerical noise of the march, 2 m, stored stack.
r2 = [r for r in report['rows'] if r['mastM'] == 2.0][0]['products']['stack']
arc_f = sk.skyline(products['stack'], SITE['lat'], SITE['lon'], 2.0, ARC, min_step=0.05, frac=2.5e-4)
cf, hf, lf = events(sg.ArcSkyline(ARC[0], 0.05, arc_f['elev_deg']))
report['stack2mFinerMarch'] = {'cut': sg.to_iso(cf), 'half': sg.to_iso(hf), 'lastLimb': sg.to_iso(lf), 'lastLimbShiftS': lf - sg.to_unix(r2['lastLimb']), 'cutShiftS': cf - sg.to_unix(r2['cut'])}
out('')
out('Round 1 (check 2, same stack, 2 m): cut %s, half %s, last limb %s; here: %s, %s, %s.' % (ROUND1_2M['cut'][11:], ROUND1_2M['half'][11:], ROUND1_2M['lastLimb'][11:], r2['cut'][11:19], r2['half'][11:19], r2['lastLimb'][11:19]))
out('A march twice as fine moves the 2 m stack times by %+.0f s (cut) and %+.0f s (last limb).' % (report['stack2mFinerMarch']['cutShiftS'], report['stack2mFinerMarch']['lastLimbShiftS']))

# Height profiles of the two products under the setting Sun.
out('')
out('Heights along the Sun\'s azimuth at last limb (2 m, stored stack): 3 m model, 60 m window, 3 m minus 60 m, and the eased 3 m model (m)')
az_set = r2['atLastLimb']['sunAzDeg']
prof = {'azDeg': az_set, 'rows': []}
east, north, up = dem.frame(SITE['lat'], SITE['lon'])
for d in (0, 100, 200, 300, 400, 500, 600, 650, 700, 725, 750, 760, 765, 767, 768, 769, 770, 780, 800, 850, 900, 1000):
    th = d / dem.R_M
    a = math.radians(az_set)
    u = math.cos(th) * up + math.sin(th) * (math.cos(a) * north + math.sin(a) * east)
    la, lo = math.degrees(math.asin(u[2])), math.degrees(math.atan2(u[1], u[0]))
    h3 = float(fine.sample(np.array([la]), np.array([lo]))[0])
    h60 = float(w60.sample(np.array([la]), np.array([lo]))[0])
    he = float(fine_eased.sample(np.array([la]), np.array([lo]))[0])
    prof['rows'].append({'distM': d, 'h3m': None if not math.isfinite(h3) else round(h3, 2), 'h60m': round(h60, 2), 'h3mEased': None if not math.isfinite(he) else round(he, 2)})
    out('  %5d m   %s   %9.2f   %s   %s' % (d, '%9.2f' % h3 if math.isfinite(h3) else '        -', h60, '%+6.2f' % (h3 - h60) if math.isfinite(h3) else '     -', '%9.2f' % he if math.isfinite(he) else '        -'))
report['profileAtLastLimbAzimuth'] = prof
report['note'] = ('Nothing here is eased: the products are compared as bundled. The spread is an uncertainty of the input data, '
                  'not of the computation (the finer march moves the times by seconds).')
text = '\n'.join(lines)
print('\n'.join(lines[-30:]))
if args.write:
    with open(os.path.join(DIR, 'results.json'), 'w') as fh:
        json.dump(report, fh, indent=1)
        fh.write('\n')
    with open(os.path.join(DIR, 'results.txt'), 'w') as fh:
        fh.write(text + '\n')
