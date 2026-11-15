#!/usr/bin/env python3
"""Pick two fresh crest pins on the bundled 40 m south-polar grid that no one has tuned against.

Round 1 (T-26) and @analysis's T-31 tests use five polar pins, and the app was checked against
their stored reference skylines. To see whether the T-31 ground-observer fix generalises, the
skyline check is also run at two points chosen here by a fixed rule, before any app output exists:

  candidates: nodes 5 to 60 km from the pole, more than 5 km from every round-1 pin, that are
  the highest node of their 5 x 5 neighbourhood (a summit of the grid) and whose slope to each
  of the 8 nodes around them stays below 25 deg (no single-cell spikes: the first version of
  this rule, the plain 40 m convexity, picked 42 m spikes on crater floors, i.e. gridding noise);
  convexity = node height minus the mean of the 16 nodes on the ring two cells (80 m) out;
  pin A = the most convex candidate; pin B = the most convex candidate more than 20 km from A.
  Each pin is then moved off its node by (+0.37, +0.21) cell (east-ish x, north-ish y of the
  grid) so that the ground at the observer's feet is a bilinear facet rising towards the node,
  the case where the 0 m skyline is formed at the observer's feet.

    python3 -I tests/fixtures/validation/science-validation/pick_fresh_pins.py [--write]
"""
import argparse
import json
import math
import os
import sys

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, os.path.join(HERE, '..', 'ephemeris-check', 'lib'))
import common  # noqa: E402
import numpy as np  # noqa: E402
import lunyx_dem as dem  # noqa: E402

ap = argparse.ArgumentParser()
ap.add_argument('--root', default=common.ROOT, help='checkout whose public/data/dem is read')
ap.add_argument('--write', action='store_true')
args = ap.parse_args()

layer = dem.polar_layers(args.root)[0]
assert layer.mpp == 40 or abs(layer.mpp - 40) < 1e-9, layer.mpp
g = layer.grid.astype(np.float64) * layer.scale + layer.offset
n = g.shape[0]
c = n / 2 - 0.5
rows, cols = np.mgrid[0:n, 0:n]
x = (cols - c) * layer.mpp
y = (c - rows) * layer.mpp
r = np.hypot(x, y)
def shifted(dy, dx):
    return np.roll(np.roll(g, dy, axis=0), dx, axis=1)


ring = [(dy, dx) for dy in range(-2, 3) for dx in range(-2, 3) if max(abs(dy), abs(dx)) == 2]
convex = g - sum(shifted(dy, dx) for dy, dx in ring) / len(ring)
summit = np.ones(g.shape, dtype=bool)
for dy in range(-2, 3):
    for dx in range(-2, 3):
        if dy or dx:
            summit &= g > shifted(dy, dx)
steep = np.zeros(g.shape, dtype=bool)
for dy in (-1, 0, 1):
    for dx in (-1, 0, 1):
        if dy or dx:
            steep |= np.abs(g - shifted(dy, dx)) > math.tan(math.radians(25)) * layer.mpp * math.hypot(dx, dy)
convex = np.where(summit & ~steep, convex, -np.inf)
convex[:3, :] = convex[-3:, :] = convex[:, :3] = convex[:, -3:] = -np.inf


def latlon(xm, ym):
    colat = 2 * math.degrees(math.atan(math.hypot(xm, ym) / (2 * dem.R_M)))
    return colat - 90.0, math.degrees(math.atan2(xm, ym))


def xy_of(lat, lon):
    xx, yy, _ = layer.xy(lat, lon)
    return float(xx), float(yy)


with open(os.path.join(HERE, '..', 'ephemeris-check', 'sites.json')) as fh:
    old = json.load(fh)['sites']
old_xy = [xy_of(s['lat'], s['lon']) for s in old.values() if s['lat'] < -87.5]
ok = (r > 5e3) & (r < 60e3)
for ox, oy in old_xy:
    ok &= np.hypot(x - ox, y - oy) > 5e3
score = np.where(ok, convex, -np.inf)
picks = []
for k in np.argsort(score, axis=None)[::-1]:
    i, j = np.unravel_index(k, score.shape)
    if not np.isfinite(score[i, j]):
        break
    if picks and any(math.hypot(x[i, j] - p['nodeX'], y[i, j] - p['nodeY']) <= 20e3 for p in picks):
        continue
    picks.append({'row': int(i), 'col': int(j), 'nodeX': float(x[i, j]), 'nodeY': float(y[i, j]), 'convexity80M': float(convex[i, j]), 'nodeHeightM': float(g[i, j])})
    if len(picks) == 2:
        break

out = {'rule': __doc__.split('\n\n')[1].strip(), 'layer': layer.name, 'pins': {}}
for name, p in zip(('fresh-a', 'fresh-b'), picks):
    px, py = p['nodeX'] + 0.37 * layer.mpp, p['nodeY'] + 0.21 * layer.mpp
    lat, lon = latlon(px, py)
    lat, lon = round(lat, 5), round(lon, 5)
    h = float(np.atleast_1d(layer.sample(lat, lon))[0])
    nlat, nlon = latlon(p['nodeX'], p['nodeY'])
    out['pins'][name] = {'lat': lat, 'lon': lon, 'groundM': round(h, 2), 'node': {'lat': round(nlat, 6), 'lon': round(nlon, 6), 'heightM': round(p['nodeHeightM'], 2), 'convexity80M': round(p['convexity80M'], 3)},
                         'kmFromPole': round(math.hypot(px, py) / 1000, 2)}
    print('%s: node %.5f, %.5f (height %.2f m, %.2f m above the ring 80 m out) -> pin %.5f, %.5f, ground %.2f m, %.1f km from the pole'
          % (name, nlat, nlon, p['nodeHeightM'], p['convexity80M'], lat, lon, h, math.hypot(px, py) / 1000))
if args.write:
    with open(os.path.join(HERE, 'skyline-masts', 'fresh-pins.json'), 'w') as fh:
        json.dump(out, fh, indent=1)
        fh.write('\n')
