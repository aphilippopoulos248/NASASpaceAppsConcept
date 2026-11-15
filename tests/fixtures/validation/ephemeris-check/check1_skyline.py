#!/usr/bin/env python3
"""Check 1: the app's terrain skyline against an independent ray march.

Reference: lib/skyline.py over lib/lunyx_dem.py, straight from the bundled elevation
files. Under test: analyse().horizon as dumped by app_dump.mjs (skyline/app-*.json).

    node tests/fixtures/validation/ephemeris-check/app_dump.mjs --scenarios tests/fixtures/validation/ephemeris-check/skyline/scenarios.json --out tests/fixtures/validation/ephemeris-check/skyline/app-now.json
    python3 -I tests/fixtures/validation/ephemeris-check/check1_skyline.py [--write]

Differences are app minus reference, in degrees, at the app's own 720 azimuths.
"""
import argparse
import json
import os
import sys
import time

sys.path.insert(0, os.path.join(os.path.dirname(os.path.abspath(__file__)), 'lib'))
import common  # noqa: E402
import numpy as np  # noqa: E402
import lunyx_dem as dem  # noqa: E402
import skyline as sk  # noqa: E402

ap = argparse.ArgumentParser()
ap.add_argument('--write', action='store_true', help='store reference skylines and results in skyline/')
ap.add_argument('--apps', nargs='*', default=['app-before.json', 'app-now.json'])
args = ap.parse_args()
DIR = os.path.join(common.BASE, 'skyline')
LIMIT = 0.1  # deg: differences above this are listed and explained (task T-26)

with open(os.path.join(DIR, 'scenarios.json')) as fh:
    scenarios = json.load(fh)
apps = {}
for name in args.apps:
    p = os.path.join(DIR, name)
    if os.path.exists(p):
        with open(p) as fh:
            d = json.load(fh)
        apps[name] = {'commit': d['app']['commit'], 'by_id': {r['id']: r for r in d['results']}}

report = {'limitDeg': LIMIT, 'reference': 'lib/skyline.py: 0.1 m steps to 200 m, then 0.05 % of distance, to 500 km; 3-D elevation of every sample. referenceConvergenceDeg is the largest change when both step sizes are halved.', 'sites': {}}
lines = []
out = lines.append
for s in scenarios:
    site = s['site']
    landing = site['id'] if site['kind'] == 'landing' else None
    stack = dem.stack_for(common.ROOT, site['lat'], site['lon'], landing)
    az = np.arange(720) * 0.5
    t0 = time.time()
    ref = sk.skyline(stack, site['lat'], site['lon'], s['mastHeightM'], az)
    # Convergence of the reference itself: the same march twice as fine.
    fine = sk.skyline(stack, site['lat'], site['lon'], s['mastHeightM'], az, min_step=0.05, frac=2.5e-4)
    conv = float(np.max(np.abs(fine['elev_deg'] - ref['elev_deg'])))
    secs = time.time() - t0
    names = [l.name for l in stack.layers]
    used = sorted(set(int(k) for k in ref['layer']))
    out('')
    out('%s  (%.5f, %.5f), mast %g m' % (s['id'], site['lat'], site['lon'], s['mastHeightM']))
    out('  reference: ground %.2f m; skyline %.3f .. %.3f deg; formed %.0f m .. %.1f km away; reference converged to %.5f deg; %d samples per ray, %.0f s'
        % (ref['ground_m'], ref['elev_deg'].min(), ref['elev_deg'].max(), ref['dist_m'].min(), ref['dist_m'].max() / 1000, conv, ref['samples_per_ray'], secs))
    out('  layers forming it: ' + '; '.join('%s (%d az)' % (names[k], int(np.sum(ref['layer'] == k))) for k in used))
    out('  azimuth of the skyline-forming sample differs from the nominal azimuth by at most %.6f deg' % float(np.max(np.abs((ref['az_check_deg'] - az + 180) % 360 - 180))))
    entry = {
        'site': site, 'mastHeightM': s['mastHeightM'], 'referenceGroundM': ref['ground_m'], 'referenceConvergenceDeg': conv,
        'layers': names, 'apps': {},
    }
    for name, app in apps.items():
        r = app['by_id'].get(s['id'])
        if not r:
            continue
        h = r['horizon']
        assert abs(h['azStepDeg'] - 0.5) < 1e-12 and len(h['elevDeg']) == 720
        e_app = np.array(h['elevDeg'], dtype=np.float64)
        diff = e_app - ref['elev_deg']
        k = int(np.argmax(np.abs(diff)))
        over = np.abs(diff) > LIMIT
        stats = {
            'commit': app['commit'], 'appGroundM': h['siteElevationM'], 'groundDiffM': h['siteElevationM'] - ref['ground_m'],
            'maxAbsDeg': float(np.max(np.abs(diff))), 'atAzDeg': float(az[k]), 'signedAtMaxDeg': float(diff[k]),
            'meanDeg': float(diff.mean()), 'rmsDeg': float(np.sqrt((diff ** 2).mean())),
            'appLowestDeg': float(diff.min()), 'appHighestDeg': float(diff.max()),
            'over0p02': int(np.sum(np.abs(diff) > 0.02)), 'over0p05': int(np.sum(np.abs(diff) > 0.05)), 'overLimit': int(over.sum()),
            'appMaxRangeM': h['maxRangeM'], 'runs': [],
        }
        out('  app %s (%s): ground %.2f m (%+.2f); app - reference: max |d| %.4f deg at az %.1f (%+.4f); mean %+.4f, rms %.4f; app lowest %+.4f, highest %+.4f; |d| > 0.02: %d, > 0.05: %d, > %.1f: %d of 720'
            % (name.replace('.json', ''), app['commit'], h['siteElevationM'], stats['groundDiffM'], stats['maxAbsDeg'], stats['atAzDeg'], stats['signedAtMaxDeg'],
               stats['meanDeg'], stats['rmsDeg'], stats['appLowestDeg'], stats['appHighestDeg'], stats['over0p02'], stats['over0p05'], LIMIT, stats['overLimit']))
        # Contiguous azimuth runs above the limit, with what forms the skyline there.
        idx = np.flatnonzero(over)
        if idx.size:
            runs = np.split(idx, np.flatnonzero(np.diff(idx) > 1) + 1)
            if len(runs) > 1 and runs[0][0] == 0 and runs[-1][-1] == 719:
                runs = [np.concatenate([runs[-1], runs[0]])] + runs[1:-1]
            for run in runs:
                j = run[int(np.argmax(np.abs(diff[run])))]
                item = {
                    'azFromDeg': float(az[run[0]]), 'azToDeg': float(az[run[-1]]), 'count': int(run.size), 'worstDeg': float(diff[j]), 'worstAzDeg': float(az[j]),
                    'refElevDeg': float(ref['elev_deg'][j]), 'refDistM': float(ref['dist_m'][j]), 'refHeightM': float(ref['height_m'][j]), 'refLayer': names[int(ref['layer'][j])],
                    'appElevDeg': float(e_app[j]), 'appDistM': h['distM'][j], 'appHeightM': h['heightM'][j],
                }
                stats['runs'].append(item)
                out('      az %5.1f..%5.1f (%3d): worst %+.3f at %.1f | reference %.3f deg from %.0f m away, %.1f m high [%s] | app %.3f deg from %.0f m, %.1f m'
                    % (item['azFromDeg'], item['azToDeg'], item['count'], item['worstDeg'], item['worstAzDeg'], item['refElevDeg'], item['refDistM'], item['refHeightM'],
                       item['refLayer'], item['appElevDeg'], item['appDistM'], item['appHeightM']))
        entry['apps'][name.replace('.json', '')] = stats
    report['sites'][s['id']] = entry
    if args.write:
        with open(os.path.join(DIR, 'reference-%s.json' % s['id']), 'w') as fh:
            json.dump({
                'site': site, 'mastHeightM': s['mastHeightM'], 'groundM': ref['ground_m'], 'azStepDeg': 0.5, 'layers': names,
                'elevDeg': [round(float(v), 5) for v in ref['elev_deg']], 'distM': [round(float(v), 1) for v in ref['dist_m']],
                'heightM': [round(float(v), 2) for v in ref['height_m']], 'layer': [int(v) for v in ref['layer']],
                'convergenceDeg': conv,
            }, fh)
            fh.write('\n')

text = '\n'.join(lines).lstrip('\n')
print(text)
if args.write:
    with open(os.path.join(DIR, 'results.json'), 'w') as fh:
        json.dump(report, fh, indent=1)
        fh.write('\n')
    with open(os.path.join(DIR, 'results.txt'), 'w') as fh:
        fh.write(text + '\n')
