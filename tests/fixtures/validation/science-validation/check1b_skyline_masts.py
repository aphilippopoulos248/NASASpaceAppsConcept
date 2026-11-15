#!/usr/bin/env python3
"""T-34 item 5, first half: the app's skyline at 0 m, 0.5 m and 2 m against an independent ray march.

Reference: round 1's own ray march (../ephemeris-check/lib/skyline.py over lib/lunyx_dem.py, straight
from the bundled elevation files; nothing from src/). Under test: analyse().horizon as dumped by
../ephemeris-check/app_dump.mjs from a git-archive export of the build (skyline-masts/app-<build>.json).

Reference skylines that round 1 stored (ephemeris-check/skyline/reference-*.json: 2 m at five
sites, 0 m at five) are reused when the elevation files the app reads are byte-identical to the
ones round 1 read (checked with --data-unchanged-since); the others are computed here, each with
a second march twice as fine to state its own numerical noise. One stored reference is
recomputed as a reproducibility check.

    python3 -I tests/fixtures/validation/science-validation/check1b_skyline_masts.py \
        --root /path/to/export --app app-1289083.json [--write]

Differences are app minus reference, in degrees, at the app's own 720 azimuths.
"""
import argparse
import json
import os
import sys
import time

HERE = os.path.dirname(os.path.abspath(__file__))
EC = os.path.join(HERE, '..', 'ephemeris-check')
sys.path.insert(0, os.path.join(EC, 'lib'))
import common  # noqa: E402
import numpy as np  # noqa: E402
import lunyx_dem as dem  # noqa: E402
import skyline as sk  # noqa: E402
sys.path.insert(0, HERE)
import near_field as nf  # noqa: E402

ap = argparse.ArgumentParser()
ap.add_argument('--root', required=True, help='checkout (export) whose elevation files the app read')
ap.add_argument('--app', default='app-1289083.json')
ap.add_argument('--reuse-stored', default='yes', choices=['yes', 'no'])
ap.add_argument('--reuse-own', default='yes', choices=['yes', 'no'], help='reuse references this script stored earlier (restarts)')
ap.add_argument('--reproduce', default='rim-top@0m', help='stored reference to recompute as a reproducibility check ("" for none)')
ap.add_argument('--only', nargs='*')
ap.add_argument('--write', action='store_true')
ap.add_argument('--dir', default='skyline-masts', help='directory (next to this script) with scenarios.json and the app dump; outputs go there')
ap.add_argument('--near-exact-m', type=float, default=500.0, help='also evaluate the first N metres of every ray with a step-free crease search (near_field.py) and keep the higher value; 0 to switch off')
ap.add_argument('--eased', action='store_true', help='reference on the 3 m models eased onto their 60 m windows (lib/lunyx_dem.py eased_fine, T-32 rule)')
args = ap.parse_args()
DIR = os.path.join(HERE, args.dir)
MODE = '.eased' if args.eased else ''
if args.eased:
    args.reuse_stored = 'no'  # round 1's references are built on the files as stored
STORED = os.path.join(EC, 'skyline')
LIMIT = 0.1  # deg, round 1's threshold: a fifth of the Sun's diameter, about 12 min of sunrise at low latitude
AZ = np.arange(720) * 0.5

with open(os.path.join(DIR, 'scenarios.json')) as fh:
    scenarios = json.load(fh)
with open(os.path.join(DIR, args.app)) as fh:
    dump = json.load(fh)
app_by_id = {r['id']: r for r in dump['results']}
commit = dump['app']['commit']


def stored_id(s):
    if s['mastHeightM'] == 2:
        return s['siteKey']
    if s['mastHeightM'] == 0:
        return s['siteKey'] + '@0m'
    return None


def load_stored(s):
    rid = stored_id(s)
    if not rid or args.reuse_stored != 'yes':
        return None
    p = os.path.join(STORED, 'reference-%s.json' % rid)
    if not os.path.exists(p):
        return None
    with open(p) as fh:
        r = json.load(fh)
    assert abs(r['site']['lat'] - s['site']['lat']) < 1e-9 and abs(r['site']['lon'] - s['site']['lon']) < 1e-9 and r['mastHeightM'] == s['mastHeightM'], rid
    return rid, r


def compute(s, fine_pass=True):
    site = s['site']
    landing = site['id'] if site['kind'] == 'landing' else None
    stack = dem.stack_for(args.root, site['lat'], site['lon'], landing, eased=args.eased)
    t0 = time.time()
    ref = sk.skyline(stack, site['lat'], site['lon'], s['mastHeightM'], AZ)
    conv = None
    if fine_pass:
        fine = sk.skyline(stack, site['lat'], site['lon'], s['mastHeightM'], AZ, min_step=0.05, frac=2.5e-4)
        conv = float(np.max(np.abs(fine['elev_deg'] - ref['elev_deg'])))
    names = [l.name for l in stack.layers]
    return {
        'site': site, 'mastHeightM': s['mastHeightM'], 'groundM': ref['ground_m'], 'azStepDeg': 0.5, 'layers': names,
        'elevDeg': [round(float(v), 5) for v in ref['elev_deg']], 'distM': [round(float(v), 1) for v in ref['dist_m']],
        'heightM': [round(float(v), 2) for v in ref['height_m']], 'layer': [int(v) for v in ref['layer']],
        'convergenceDeg': conv, 'seconds': round(time.time() - t0, 1),
    }


lines = []
out = lines.append
report = {'build': commit, 'root': args.root, 'limitDeg': LIMIT, 'referenceMode': 'eased (T-32 rule)' if args.eased else 'as stored', 'sites': {}}
by_id = {s['id']: s for s in scenarios}
if args.reproduce and args.reproduce in by_id and not args.eased:
    s = by_id[args.reproduce]
    rid, st = load_stored(s)
    again = compute(s, fine_pass=False)
    d = np.abs(np.array(again['elevDeg']) - np.array(st['elevDeg']))
    report['reproducibility'] = {'id': args.reproduce, 'storedFile': 'ephemeris-check/skyline/reference-%s.json' % rid, 'maxAbsDeg': float(d.max()), 'groundDiffM': again['groundM'] - st['groundM'], 'seconds': again['seconds']}
    out('Reproducibility: round 1 stored reference-%s.json recomputed here on the export: max |difference| %.5f deg over 720 azimuths, ground %+.3f m (%.0f s)'
        % (rid, float(d.max()), again['groundM'] - st['groundM'], again['seconds']))
    print(lines[-1], flush=True)

for s in scenarios:
    if args.only and s['id'] not in args.only:
        continue
    site = s['site']
    got = load_stored(s)
    own = os.path.join(DIR, 'reference-%s%s.json' % (s['id'], MODE))
    if got:
        rid, ref = got
        origin = 'round 1 stored ephemeris-check/skyline/reference-%s.json (computed on 32ef35a; same elevation files)' % rid
        conv = None
    elif os.path.exists(own) and args.reuse_own == 'yes':
        with open(own) as fh:
            ref = json.load(fh)
        assert abs(ref['site']['lat'] - site['lat']) < 1e-9 and abs(ref['site']['lon'] - site['lon']) < 1e-9 and ref['mastHeightM'] == s['mastHeightM'], s['id']
        origin = 'computed here earlier (%s/reference-%s%s.json, %.0f s, two marches)' % (args.dir, s['id'], MODE, ref['seconds'])
        conv = ref['convergenceDeg']
    else:
        ref = compute(s)
        origin = 'computed here (%.0f s, two marches%s)' % (ref['seconds'], ', 3 m models eased (T-32 rule)' if args.eased else '')
        conv = ref['convergenceDeg']
        if args.write:
            with open(own, 'w') as fh:
                json.dump(ref, fh)
                fh.write('\n')
    e_ref = np.array(ref['elevDeg'], dtype=np.float64)
    d_ref = np.array(ref['distM'], dtype=np.float64)
    h_ref = np.array(ref['heightM'], dtype=np.float64)
    e_march = e_ref.copy()
    near = None
    if args.near_exact_m > 0:
        landing = site['id'] if site['kind'] == 'landing' else None
        nstack = dem.stack_for(args.root, site['lat'], site['lon'], landing, eased=args.eased)
        t0n = time.time()
        nr = nf.near_skyline(nstack, site['lat'], site['lon'], s['mastHeightM'], AZ, max_range=args.near_exact_m, step=0.05)
        lift = nr['elev_deg'] - e_ref
        up_ = lift > 0
        e_ref = np.where(up_, nr['elev_deg'], e_ref)
        d_ref = np.where(up_, nr['dist_m'], d_ref)
        h_ref = np.where(up_, nr['height_m'], h_ref)
        near = {'rangeM': args.near_exact_m, 'azimuthsRaised': int(np.sum(lift > 1e-4)), 'largestRaiseDeg': float(max(0.0, lift.max())), 'atAzDeg': float(AZ[int(np.argmax(lift))]), 'seconds': round(time.time() - t0n, 1)}
    r = app_by_id[s['id']]
    h = r['horizon']
    assert abs(h['azStepDeg'] - 0.5) < 1e-12 and len(h['elevDeg']) == 720 and h['mastHeightM'] == s['mastHeightM']
    e_app = np.array(h['elevDeg'], dtype=np.float64)
    d_app = np.array([np.nan if v is None else v for v in h['distM']], dtype=np.float64)
    diff = e_app - e_ref
    k = int(np.argmax(np.abs(diff)))
    diff_march = e_app - e_march
    stats = {
        'nearFieldExact': near, 'againstMarchOnly': {'maxAbsDeg': float(np.max(np.abs(diff_march))), 'signedAtMaxDeg': float(diff_march[int(np.argmax(np.abs(diff_march)))]), 'over0p02': int(np.sum(np.abs(diff_march) > 0.02))},
        'referenceOrigin': origin, 'referenceConvergenceDeg': conv, 'referenceGroundM': ref['groundM'], 'appGroundM': h['siteElevationM'],
        'maxAbsDeg': float(np.max(np.abs(diff))), 'atAzDeg': float(AZ[k]), 'signedAtMaxDeg': float(diff[k]),
        'meanDeg': float(diff.mean()), 'rmsDeg': float(np.sqrt((diff ** 2).mean())), 'appLowestDeg': float(diff.min()), 'appHighestDeg': float(diff.max()),
        'over0p01': int(np.sum(np.abs(diff) > 0.01)), 'over0p02': int(np.sum(np.abs(diff) > 0.02)), 'over0p05': int(np.sum(np.abs(diff) > 0.05)), 'overLimit': int(np.sum(np.abs(diff) > LIMIT)),
        'refAtFeet': int(np.sum(d_ref < 1.0)), 'appAtFeet': int(np.sum(d_app == 0)), 'refSkylineDeg': [float(e_ref.min()), float(e_ref.max())],
        'worst': [], 'warnings': r.get('warnings', []),
    }
    for j in np.argsort(-np.abs(diff))[:3]:
        stats['worst'].append({'azDeg': float(AZ[j]), 'diffDeg': float(diff[j]), 'refElevDeg': float(e_ref[j]), 'refDistM': float(d_ref[j]), 'refHeightM': float(h_ref[j]),
                               'appElevDeg': float(e_app[j]), 'appDistM': h['distM'][j], 'appHeightM': h['heightM'][j]})
    report['sites'][s['id']] = {'site': site, 'mastHeightM': s['mastHeightM'], 'app': stats}
    out('')
    out('%s  (%.5f, %.5f), observer %g m above the ground; reference: %s%s'
        % (s['id'], site['lat'], site['lon'], s['mastHeightM'], origin, '' if conv is None else ', converged to %.5f deg' % conv))
    out('  ground: reference %.2f m, app %.2f m (%+.2f); reference skyline %.3f .. %.3f deg, formed at the observer\'s feet (< 1 m) in %d of 720 azimuths, app says distM 0 in %d'
        % (ref['groundM'], h['siteElevationM'], h['siteElevationM'] - ref['groundM'], e_ref.min(), e_ref.max(), stats['refAtFeet'], stats['appAtFeet']))
    if near:
        out('  exact near field (first %.0f m, every grid-line crossing): raised the march reference at %d azimuths, by at most %.4f deg (az %.1f); against the march alone the app was %+.4f at worst'
            % (near['rangeM'], near['azimuthsRaised'], near['largestRaiseDeg'], near['atAzDeg'], stats['againstMarchOnly']['signedAtMaxDeg']))
    out('  app %s - reference: max |d| %.4f deg at az %.1f (%+.4f); mean %+.4f, rms %.4f; lowest %+.4f, highest %+.4f; |d| > 0.01: %d, > 0.02: %d, > 0.05: %d, > %.1f: %d of 720'
        % (commit, stats['maxAbsDeg'], stats['atAzDeg'], stats['signedAtMaxDeg'], stats['meanDeg'], stats['rmsDeg'], stats['appLowestDeg'], stats['appHighestDeg'],
           stats['over0p01'], stats['over0p02'], stats['over0p05'], LIMIT, stats['overLimit']))
    for w in stats['worst'][:2]:
        out('      az %5.1f: %+.4f | reference %.3f deg from %.1f m away, %.1f m high | app %.3f deg from %s m, %s m'
            % (w['azDeg'], w['diffDeg'], w['refElevDeg'], w['refDistM'], w['refHeightM'], w['appElevDeg'], w['appDistM'], w['appHeightM']))
    print('\n'.join(lines[-(3 + (1 if near else 0) + len(stats['worst'][:2])):]), flush=True)

# Summary table by mast.
out('')
out('Summary, app %s minus reference (deg): worst |d| and azimuths over 0.02 / 0.1 of 720' % commit)
masts = sorted({s['mastHeightM'] for s in scenarios})
keys = []
for s in scenarios:
    if s['siteKey'] not in keys:
        keys.append(s['siteKey'])
out('  %-18s' % 'site' + ''.join('%-24s' % ('%g m' % m) for m in masts))
for key in keys:
    cells = []
    for m in masts:
        e = report['sites'].get('%s@%gm' % (key, m))
        cells.append('%-24s' % ('%+.4f  %3d / %3d' % (e['app']['signedAtMaxDeg'], e['app']['over0p02'], e['app']['overLimit']) if e else '-'))
    out('  %-18s' % key + ''.join(cells))
text = '\n'.join(lines).lstrip('\n')
print('\n'.join(lines[-(len(keys) + 3):]))
if args.write:
    with open(os.path.join(DIR, 'results%s.json' % MODE), 'w') as fh:
        json.dump(report, fh, indent=1)
        fh.write('\n')
    with open(os.path.join(DIR, 'results%s.txt' % MODE), 'w') as fh:
        fh.write(text + '\n')
