#!/usr/bin/env python3
"""Check 0b: how well do the 3 m site models join the 60 m windows around them?

At the 19 landing sites with a 3 m LROC NAC model, the app takes heights from that model out
to its edge (768 m from the site in the cardinal directions) and from the 60 m window beyond.
This measures the two layers against each other where they overlap, the step along the
model's edge, and how much of each site's skyline (reference/skyline.<site>.m2.json, where
one exists) is formed exactly on that edge.

    python3 -I tests/fixtures/validation/ephemeris-check/check0b_layer_seams.py [--eased] [--write]

--eased reads each 3 m model as T-32 makes the app load it (lib/lunyx_dem.py eased_fine: eased
onto the 60 m window over the outer 43 samples, rule taken from T-32's handover, not its code)
and writes terrain/seams-eased.*; the files on disk are the same in both modes.
"""
import argparse
import json
import math
import os
import sys

sys.path.insert(0, os.path.join(os.path.dirname(os.path.abspath(__file__)), 'lib'))
import common  # noqa: E402
import numpy as np  # noqa: E402
import lunyx_dem as dem  # noqa: E402

ap = argparse.ArgumentParser()
ap.add_argument('--write', action='store_true')
ap.add_argument('--eased', action='store_true', help='the 3 m models eased onto their 60 m windows (T-32 rule)')
args = ap.parse_args()
with open(os.path.join(common.ROOT, 'public', 'terrain', 'index.json')) as fh:
    index = json.load(fh)


def latlon(lat0, lon0, east_m, north_m):
    """Point reached from the site by an azimuthal-equidistant offset (the site windows' own layout)."""
    east, north, up = dem.frame(lat0, lon0)
    d = np.hypot(east_m, north_m) / dem.R_M
    safe = np.maximum(d * dem.R_M, 1e-9)
    u = np.cos(d)[..., None] * up + np.sin(d)[..., None] * ((east_m / safe)[..., None] * east + (north_m / safe)[..., None] * north)
    return np.degrees(np.arcsin(u[..., 2])), np.degrees(np.arctan2(u[..., 1], u[..., 0]))


lines = []
out = lines.append
report = {}
out('site             3 m minus 60 m over the overlap      60 m just outside minus 3 m just inside, along the edge      skyline formed on the edge')
out('                 mean      std                        mean      lowest    highest                               (share of azimuths, 2 m)')
for sid, e in index['sites'].items():
    if 'fine' not in e:
        continue
    entry, layers = dem.site_windows(common.ROOT, sid, eased=args.eased)
    w60 = next(l for l in layers if l.spacing == 60)
    fine = next(l for l in layers if l.spacing < 60)
    hw = fine.half_width_m
    g = np.arange(-hw + 15, hw - 14, 30.0)
    E, N = np.meshgrid(g, g)
    la, lo = latlon(entry['lat'], entry['lon'], E.ravel(), N.ravel())
    d = fine.sample(la, lo) - w60.sample(la, lo)
    t = np.arange(-hw + 3, hw - 2, 6.0)
    full = np.full_like(t, hw)
    steps = []
    for ei, ni, eo, no in ((full - 1.5, t, full + 1.5, t), (-full + 1.5, t, -full - 1.5, t), (t, full - 1.5, t, full + 1.5), (t, -full + 1.5, t, -full - 1.5)):
        steps.append(w60.sample(*latlon(entry['lat'], entry['lon'], eo, no)) - fine.sample(*latlon(entry['lat'], entry['lon'], ei, ni)))
    s = np.concatenate(steps)
    row = {'overlapMeanM': float(np.nanmean(d)), 'overlapStdM': float(np.nanstd(d)), 'edgeStepMeanM': float(np.nanmean(s)), 'edgeStepMinM': float(np.nanmin(s)), 'edgeStepMaxM': float(np.nanmax(s)), 'halfWidthM': hw}
    # T-32's measure: both grids read at the same points of the edge (0.01 m inside it), every 3 m.
    t3 = np.arange(-hw, hw + 0.001, 3.0)
    f3 = np.full_like(t3, hw - 0.01)
    same = []
    for e_, n_ in ((f3, t3), (-f3, t3), (t3, f3), (t3, -f3)):
        q = latlon(entry['lat'], entry['lon'], e_, n_)
        same.append(w60.sample(*q) - fine.sample(*q))
    same = np.concatenate(same)
    row.update({'edgeSamePointsMinM': float(np.nanmin(same)), 'edgeSamePointsMaxM': float(np.nanmax(same)), 'edgeSamePointsRmsM': float(np.sqrt(np.nanmean(same ** 2))), 'edgeSamePointsN': int(np.isfinite(same).sum())})
    if args.eased:
        _, stored_layers = dem.site_windows(common.ROOT, sid)
        fs = next(l for l in stored_layers if l.spacing < 60)
        same_s = np.concatenate([w60.sample(*latlon(entry['lat'], entry['lon'], e_, n_)) - fs.sample(*latlon(entry['lat'], entry['lon'], e_, n_)) for e_, n_ in ((f3, t3), (-f3, t3), (t3, f3), (t3, -f3))])
        moved = fine.grid - fine.stored_grid
        row.update({'storedEdgeSamePointsMinM': float(np.nanmin(same_s)), 'storedEdgeSamePointsMaxM': float(np.nanmax(same_s)), 'storedEdgeSamePointsRmsM': float(np.sqrt(np.nanmean(same_s ** 2))),
                    'easedNodes': int((moved != 0).sum()), 'easedLargestMoveM': float(np.abs(moved).max())})
    share = ''
    ref_path = os.path.join(common.BASE, 'reference', 'skyline.%s.m2.json' % sid)
    if os.path.exists(ref_path) and not args.eased:  # the stored reference skylines are built on the files as stored
        with open(ref_path) as fh:
            ref = json.load(fh)
        az = np.arange(len(ref['elevDeg'])) * ref['azStepDeg']
        edge = hw / np.maximum(np.abs(np.cos(np.radians(az))), np.abs(np.sin(np.radians(az))))
        on_edge = np.abs(np.array(ref['distM']) - edge) < 6
        row['skylineOnEdgeShare'] = float(on_edge.mean())
        idx = np.flatnonzero(on_edge)
        runs = [r for r in np.split(idx, np.flatnonzero(np.diff(idx) > 1) + 1) if r.size >= 5] if idx.size else []
        row['skylineOnEdgeAzRuns'] = [[float(az[r[0]]), float(az[r[-1]])] for r in runs]
        share = '%4.1f %%  %s' % (100 * on_edge.mean(), ', '.join('%.1f-%.1f' % (a, b) for a, b in row['skylineOnEdgeAzRuns']))
    if args.eased:
        out('%-15s %+6.2f m  %5.2f m                    %+6.2f m  %+6.2f m  %+6.2f m      | same points: as stored %+6.2f .. %+6.2f, RMS %4.2f m; eased %+6.3f .. %+6.3f, RMS %5.3f m | %d nodes moved, at most %.2f m'
            % (sid, row['overlapMeanM'], row['overlapStdM'], row['edgeStepMeanM'], row['edgeStepMinM'], row['edgeStepMaxM'], row['storedEdgeSamePointsMinM'], row['storedEdgeSamePointsMaxM'], row['storedEdgeSamePointsRmsM'],
               row['edgeSamePointsMinM'], row['edgeSamePointsMaxM'], row['edgeSamePointsRmsM'], row['easedNodes'], row['easedLargestMoveM']))
    else:
        out('%-15s %+6.2f m  %5.2f m                    %+6.2f m  %+6.2f m  %+6.2f m                              %s' % (sid, row['overlapMeanM'], row['overlapStdM'], row['edgeStepMeanM'], row['edgeStepMinM'], row['edgeStepMaxM'], share))
    report[sid] = row
out('')
out('A step of 1 m at 768 m is 0.075 deg of skyline; the Sun crosses that in about 9 minutes at the equator.')
if args.eased:
    out('Eased mode: the 3 m models as T-32 makes the app load them (rule from its handover; lib/lunyx_dem.py eased_fine). The "just outside minus just inside"')
    out('columns read the two grids 3 m apart, so they keep about 3 m of the ground\'s own slope; "same points" reads both grids at the same points of the')
    out('edge (0.01 m inside it, every 3 m), T-32\'s own measure, 60 m window minus 3 m model.')
text = '\n'.join(lines)
print(text)
if args.write:
    os.makedirs(os.path.join(common.BASE, 'terrain'), exist_ok=True)
    stem = 'seams-eased' if args.eased else 'seams'
    with open(os.path.join(common.BASE, 'terrain', stem + '.json'), 'w') as fh:
        json.dump(report, fh, indent=1)
        fh.write('\n')
    with open(os.path.join(common.BASE, 'terrain', stem + '.txt'), 'w') as fh:
        fh.write(text + '\n')
