#!/usr/bin/env python3
"""Check 0: are the bundled elevation grids the LOLA products they say they are?

Reads small pieces of the original files at the NASA PDS Geosciences Node by HTTP range
request (a few kilobytes each) and compares them, sample for sample, with the bundled grids
as decoded by lib/lunyx_dem.py. A wrong orientation, shift, scale or block alignment in the
bundle would show here; the skyline comparison (check 1) cannot see it, because both sides
of that comparison read the same bundle.

    python3 -I tests/fixtures/validation/ephemeris-check/check0_bundle_vs_pds.py [--write]     (needs network)

PDS files are raw little-endian int16, height = DN * 0.5 m above the 1737.4 km sphere.
"""
import argparse
import json
import math
import os
import sys
import time
import urllib.request

sys.path.insert(0, os.path.join(os.path.dirname(os.path.abspath(__file__)), 'lib'))
import common  # noqa: E402
import numpy as np  # noqa: E402
import lunyx_dem as dem  # noqa: E402

ap = argparse.ArgumentParser()
ap.add_argument('--write', action='store_true')
args = ap.parse_args()
PDS = 'https://pds-geosciences.wustl.edu/lro/lro-l-lola-3-rdr-v1/lrolol_1xxx/data/lola_gdr/'


def read_samples(url, width, row, col, count):
    """`count` int16 samples of one image row, starting at `col`."""
    start = (row * width + col) * 2
    req = urllib.request.Request(url, headers={'Range': 'bytes=%d-%d' % (start, start + 2 * count - 1), 'User-Agent': 'range-reader'})
    for attempt in range(4):
        try:
            with urllib.request.urlopen(req, timeout=60) as res:
                data = res.read()
            if len(data) != 2 * count:
                raise IOError('short read')
            time.sleep(0.25)
            return np.frombuffer(data, dtype='<i2').astype(np.float64)
        except Exception:
            if attempt == 3:
                raise
            time.sleep(2 * (attempt + 1))


lines = []
out = lines.append
report = {'source': PDS, 'polar': [], 'global': []}
polar = dem.polar_layers(common.ROOT)
sources = [('polar/img/ldem_875s_20m.img', 7584, 0.25), ('polar/img/ldem_85s_40m.img', 7584, 0.5), ('polar/img/ldem_80s_80m.img', 7600, 0.5)]
# Places that matter to the other checks, plus a few scattered ones (lat, lon).
places = [('Shackleton rim pin', -89.78, -155.73), ('connecting ridge pin', -89.45, -137.2), ('Shackleton floor', -89.67, 129.78),
          ('IM-2', -84.79, 29.2), ('88.5 S 87 W', -88.5, -87.0), ('87.8 S 40 E', -87.8, 40.0), ('86 S 160 E', -86.0, 160.0), ('82 S 100 W', -82.0, -100.0)]
out('Bundled south-polar layers against the PDS files they were made from (2x2 block means; 64 bundled samples per place)')
for layer, (path, src_width, tol) in zip(polar, sources):
    n = layer.grid.shape[0]
    assert src_width == 2 * n, 'the bundle is not half the size of %s' % path
    worst, checked, used = 0.0, 0, []
    for name, lat, lon in places:
        x, y, _ = layer.xy(lat, lon)
        c = int(round(n / 2 - 0.5 + x / layer.mpp)) - 32
        r = int(round(n / 2 - 0.5 - y / layer.mpp))
        if not (0 <= c and c + 64 <= n and 0 <= r < n):
            continue
        src = [read_samples(PDS + path, src_width, 2 * r + k, 2 * c, 128) for k in (0, 1)]
        mean = (src[0][0::2] + src[0][1::2] + src[1][0::2] + src[1][1::2]) / 4.0 * 0.5      # metres
        mine = layer.grid[r, c:c + 64].astype(np.float64) * layer.scale + layer.offset
        d = float(np.max(np.abs(mine - mean)))
        worst = max(worst, d)
        checked += 64
        used.append(name)
        # The same strip mirrored east-west or shifted by one bundled sample must NOT fit: proves the test can fail.
    x, y, _ = layer.xy(places[0][1], places[0][2])
    c = int(round(n / 2 - 0.5 + x / layer.mpp)) - 32
    r = int(round(n / 2 - 0.5 - y / layer.mpp))
    src = [read_samples(PDS + path, src_width, 2 * r + k, 2 * c, 128) for k in (0, 1)]
    mean = (src[0][0::2] + src[0][1::2] + src[1][0::2] + src[1][1::2]) / 4.0 * 0.5
    shifted = float(np.max(np.abs(layer.grid[r, c + 1:c + 65] * layer.scale - mean)))
    mirrored = float(np.max(np.abs(layer.grid[r, n - 1 - np.arange(c, c + 64)] * layer.scale - mean)))
    ok = worst <= tol + 1e-9
    out('  %-40s %4d samples at %d places: worst difference %.2f m (rounding allows %.2f)  %s   [control: shifted one sample %.1f m, mirrored %.1f m]'
        % (layer.name, checked, len(used), worst, tol, 'ok' if ok else 'FAIL', shifted, mirrored))
    report['polar'].append({'layer': layer.name, 'pdsFile': path, 'samples': checked, 'places': used, 'worstM': worst, 'allowedM': tol, 'ok': ok, 'controlShiftedM': shifted, 'controlMirroredM': mirrored})

out('')
out('Bundled whole-Moon grid against PDS LDEM_16 (whole rows; the bundle starts at 180 W, the source at 0 E; bundle rounded to 1 m)')
g = dem.global_layer(common.ROOT)
for lat in (89.0, 26.1, 0.7, -45.4, -84.8):
    row = int((90.0 - lat) * 16)
    src = read_samples(PDS + 'cylindrical/img/ldem_16.img', 5760, row, 0, 5760) * 0.5
    mine = g.grid[row].astype(np.float64) * g.scale + g.offset
    d = float(np.max(np.abs(np.roll(mine, -2880) - src)))
    wrong = float(np.max(np.abs(mine - src)))
    ok = d <= 0.5 + 1e-9
    out('  row at latitude %6.2f: 5760 samples, worst difference %.2f m (rounding allows 0.50)  %s   [control: without the 180 deg shift %.0f m]' % (90 - (row + 0.5) / 16, d, 'ok' if ok else 'FAIL', wrong))
    report['global'].append({'row': row, 'latitude': 90 - (row + 0.5) / 16, 'worstM': d, 'ok': ok, 'controlUnshiftedM': wrong})

report['ok'] = all(x['ok'] for x in report['polar'] + report['global'])
out('')
out('PASS: every bundled sample checked equals its source within rounding.' if report['ok'] else 'FAIL')
text = '\n'.join(lines)
print(text)
if args.write:
    with open(os.path.join(common.BASE, 'terrain', 'results.json'), 'w') as fh:
        json.dump(report, fh, indent=1)
        fh.write('\n')
    with open(os.path.join(common.BASE, 'terrain', 'results.txt'), 'w') as fh:
        fh.write(text + '\n')
sys.exit(0 if report['ok'] else 1)
