#!/usr/bin/env python3
"""Computes this fixture's own skyline for one site and observer height and stores it.

    python3 -I tests/fixtures/validation/ephemeris-check/make_reference_skyline.py --site im-2 --mast 2 [--step 0.1]

Output: reference/skyline.<site>.m<mast>.json (skyline elevation and the distance of the
terrain that forms it, every `step` degrees of azimuth). See lib/skyline.py for the method.
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
ap.add_argument('--site', required=True)
ap.add_argument('--mast', type=float, default=2.0)
ap.add_argument('--step', type=float, default=0.1)
args = ap.parse_args()
with open(os.path.join(common.BASE, 'sites.json')) as fh:
    site = json.load(fh)['sites'][args.site]
stack = dem.stack_for(common.ROOT, site['lat'], site['lon'], args.site if site['kind'] == 'landing' else None)
n = int(round(360 / args.step))
az = np.arange(n) * (360.0 / n)
t0 = time.time()
ref = sk.skyline(stack, site['lat'], site['lon'], args.mast, az)
names = [l.name for l in stack.layers]
out = {
    'site': dict(id=args.site, **site), 'mastHeightM': args.mast, 'groundM': round(ref['ground_m'], 3), 'azStepDeg': 360.0 / n,
    'method': 'lib/skyline.py: 0.1 m steps to 200 m, then 0.05 % of distance, to 500 km; finest bundled layer at every sample',
    'layers': names,
    'elevDeg': [round(float(v), 5) for v in ref['elev_deg']],
    'distM': [int(round(float(v))) for v in ref['dist_m']],
}
name = 'skyline.%s.m%g.json' % (args.site, args.mast)
with open(os.path.join(common.BASE, 'reference', name), 'w') as fh:
    json.dump(out, fh, separators=(',', ':'))
    fh.write('\n')
print('%s: ground %.2f m, skyline %.3f..%.3f deg, %d azimuths, %.0f s' % (name, ref['ground_m'], ref['elev_deg'].min(), ref['elev_deg'].max(), n, time.time() - t0))
