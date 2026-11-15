#!/usr/bin/env python3
"""Check 0c (T-34 item 6): the ground the app's analysis stands on at the 19 sites with a 3 m model.

T-32 (e4b06ef) eases each 3 m model onto its 60 m window when the stack is loaded; the files on
disk do not change, so check 0b cannot see it. This asks the app itself, through T-32's own
report script (`node scripts/terrain-seams.mjs --heights IN.json --out OUT.json`, run in a
throwaway export of the build: the app is only called), for the heights it uses ("inUse") and
the heights of its stack without easing ("stored"), and compares them with this fixture's
reader: lib/lunyx_dem.py as stored, and in its eased mode, which re-implements the rule from
T-32's handover text (not from src/terrain).

Points per site: grid nodes on rings 0, 1, 2, 10, 21, 30, 42, 43 and 60 samples from the edge
of the 513 x 513 model, every 16th node along each side; half-cell points inside the band; and
points 1.5 m and 30 m outside the edge, where the 60 m window answers.

    python3 -I tests/fixtures/validation/ephemeris-check/check0c_app_heights.py --make-input DIR
    for f in DIR/*.in.json; do node EXPORT/scripts/terrain-seams.mjs --heights $f --out ${f%.in.json}.out.json; done
    python3 -I tests/fixtures/validation/ephemeris-check/check0c_app_heights.py --app-dir DIR --commit e4b06ef [--write]
"""
import argparse
import json
import os
import sys

sys.path.insert(0, os.path.join(os.path.dirname(os.path.abspath(__file__)), 'lib'))
import common  # noqa: E402
import numpy as np  # noqa: E402
import lunyx_dem as dem  # noqa: E402

ap = argparse.ArgumentParser()
ap.add_argument('--make-input', metavar='DIR')
ap.add_argument('--app-dir', metavar='DIR')
ap.add_argument('--commit', default='unknown')
ap.add_argument('--write', action='store_true')
args = ap.parse_args()
with open(os.path.join(common.ROOT, 'public', 'terrain', 'index.json')) as fh:
    index = json.load(fh)
SITES = [sid for sid, e in index['sites'].items() if 'fine' in e]


def latlon(lat0, lon0, east_m, north_m):
    east, north, up = dem.frame(lat0, lon0)
    east_m, north_m = np.asarray(east_m, dtype=np.float64), np.asarray(north_m, dtype=np.float64)
    d = np.hypot(east_m, north_m) / dem.R_M
    safe = np.maximum(d * dem.R_M, 1e-9)
    u = np.cos(d)[..., None] * up + np.sin(d)[..., None] * ((east_m / safe)[..., None] * east + (north_m / safe)[..., None] * north)
    return np.degrees(np.arcsin(u[..., 2])), np.degrees(np.arctan2(u[..., 1], u[..., 0]))


def points(entry):
    """(east, north, kind, fromEdge) of the test points, metres in the site's own frame."""
    n, sp = entry['fine']['size'], entry['fine']['spacing']
    c = (n - 1) / 2
    hw = c * sp
    pts = []
    along = np.arange(0, n, 16)
    for ring in (0, 1, 2, 10, 21, 30, 42, 43, 60):
        for k in along:
            k = int(k)
            lo, hi = ring, n - 1 - ring
            if not lo <= k <= hi:
                continue
            for r, col in ((lo, k), (hi, k), (k, lo), (k, hi)):
                pts.append(((col - c) * sp, (r - c) * sp, 'node', ring))
    for ring in (0.5, 5.5, 20.5, 41.5):
        for k in along[1:-1] + 0.5:
            lo, hi = ring, n - 1 - ring
            for r, col in ((lo, k), (hi, k), (k, lo), (k, hi)):
                pts.append(((col - c) * sp, (r - c) * sp, 'half-cell', ring))
    for out_m in (1.5, 30.0):
        for k in along:
            v = (k - c) * sp
            for e_, n_ in ((hw + out_m, v), (-hw - out_m, v), (v, hw + out_m), (v, -hw - out_m)):
                pts.append((e_, n_, 'outside', -out_m / sp))
    # De-duplicate (corners appear on two sides).
    seen, uniq = set(), []
    for p in pts:
        key = (round(p[0], 3), round(p[1], 3))
        if key not in seen:
            seen.add(key)
            uniq.append(p)
    return uniq


if args.make_input:
    os.makedirs(args.make_input, exist_ok=True)
    for sid in SITES:
        entry = index['sites'][sid]
        pts = points(entry)
        la, lo = latlon(entry['lat'], entry['lon'], [p[0] for p in pts], [p[1] for p in pts])
        with open(os.path.join(args.make_input, '%s.in.json' % sid), 'w') as fh:
            json.dump({'site': sid, 'points': [[float(a), float(b)] for a, b in zip(la, lo)]}, fh)
        with open(os.path.join(args.make_input, '%s.meta.json' % sid), 'w') as fh:
            json.dump([{'eastM': p[0], 'northM': p[1], 'kind': p[2], 'fromEdge': p[3]} for p in pts], fh)
    print('wrote %d sites to %s' % (len(SITES), args.make_input))
    sys.exit(0)

lines = []
out = lines.append
report = {'build': args.commit, 'sites': {}}
out('App %s (scripts/terrain-seams.mjs --heights) against this fixture\'s reader, metres; "eased" = lib/lunyx_dem.py eased_fine (T-32 rule from its handover).' % args.commit)
out('site            points   app eased - own eased: worst  (band / outside)   app stored - own stored: worst   app in use - own stored: worst   source "fine" where expected')
worst_all = {'easedVsEased': 0.0, 'storedVsStored': 0.0, 'inUseVsStored': 0.0}
for sid in SITES:
    entry = index['sites'][sid]
    with open(os.path.join(args.app_dir, '%s.in.json' % sid)) as fh:
        q = json.load(fh)['points']
    with open(os.path.join(args.app_dir, '%s.meta.json' % sid)) as fh:
        meta = json.load(fh)
    with open(os.path.join(args.app_dir, '%s.out.json' % sid)) as fh:
        app = json.load(fh)['heights']
    assert len(app) == len(q) == len(meta)
    la = np.array([p[0] for p in q])
    lo = np.array([p[1] for p in q])
    own_s = dem.Stack(dem.site_windows(common.ROOT, sid)[1]).sample(la, lo)
    own_e = dem.Stack(dem.site_windows(common.ROOT, sid, eased=True)[1]).sample(la, lo)
    in_use = np.array([h['inUse'] for h in app], dtype=np.float64)
    stored = np.array([h['stored'] for h in app], dtype=np.float64)
    # From 30389f2 (decision D-10) the stack in use is the stored grids and "eased" is the opt-in
    # { easeEdges: true } stack; at e4b06ef "inUse" was the eased one and there was no "eased" key.
    new_api = 'eased' in app[0]
    eased = np.array([h['eased'] for h in app], dtype=np.float64) if new_api else in_use
    src = [str(h.get('source', '')) for h in app]
    kind = np.array([m['kind'] for m in meta])
    band = kind != 'outside'
    d_e, d_s, d_mix = eased - own_e, stored - own_s, in_use - own_s
    fine_expected = band
    fine_reported = np.array(['3 m' in s or 'NAC' in s or 'fine' in s.lower() for s in src])
    row = {'points': int(len(q)), 'interface': 'inUse = stored (D-10), eased opt-in' if new_api else 'inUse = eased (e4b06ef)',
           'easedMinusOwnEasedMaxM': float(np.nanmax(np.abs(d_e))), 'inBandMaxM': float(np.nanmax(np.abs(d_e[band]))), 'outsideMaxM': float(np.nanmax(np.abs(d_e[~band]))),
           'storedMinusOwnStoredMaxM': float(np.nanmax(np.abs(d_s))), 'inUseMinusOwnStoredMaxM': float(np.nanmax(np.abs(d_mix))),
           'sourcesSeen': sorted(set(src)), 'fineWhereExpected': int(np.sum(fine_reported & fine_expected)), 'bandPoints': int(band.sum()), 'nan': int(np.sum(~np.isfinite(in_use)))}
    for k, v in (('easedVsEased', row['easedMinusOwnEasedMaxM']), ('storedVsStored', row['storedMinusOwnStoredMaxM']), ('inUseVsStored', row['inUseMinusOwnStoredMaxM'])):
        worst_all[k] = max(worst_all[k], v)
    report['sites'][sid] = row
    out('%-15s %6d   %8.4f  (%7.4f / %7.4f)                %8.4f                         %8.3f                     %d of %d'
        % (sid, row['points'], row['easedMinusOwnEasedMaxM'], row['inBandMaxM'], row['outsideMaxM'], row['storedMinusOwnStoredMaxM'], row['inUseMinusOwnStoredMaxM'], row['fineWhereExpected'], row['bandPoints']))
report['worst'] = worst_all
out('')
out('Worst over the 19 sites: app eased against own eased %.4f m; app stored against own stored %.4f m; app in use against own stored %.4f m.' % (worst_all['easedVsEased'], worst_all['storedVsStored'], worst_all['inUseVsStored']))
out('Sources the app named: %s' % ', '.join(sorted({s for r in report['sites'].values() for s in r['sourcesSeen']}))[:600])
text = '\n'.join(lines)
print(text)
if args.write:
    with open(os.path.join(common.BASE, 'terrain', 'app-heights-%s.json' % args.commit), 'w') as fh:
        json.dump(report, fh, indent=1)
        fh.write('\n')
    with open(os.path.join(common.BASE, 'terrain', 'app-heights-%s.txt' % args.commit), 'w') as fh:
        fh.write(text + '\n')
