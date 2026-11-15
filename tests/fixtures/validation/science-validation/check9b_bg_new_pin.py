#!/usr/bin/env python3
"""Blue Ghost, 16 March 2025, 2 m: first cut and last limb at the catalogue pin before and after T-38.

T-38 (original project; landed on am/lunyx/integration with 7cf48f5) moved the catalogue position of
Blue Ghost Mission 1 from 18.562, 61.81 to LROC's measured 18.5622, 61.8102 (8.4 m). check9 used the
old pin. Same method as check9 (Horizons Sun, round 1's ray march, disc bisected to 1 s), on the 3 m
model (the stored stack, the app's default under D-10) and on the 60 m window alone.

    python3 -I tests/fixtures/validation/science-validation/check9b_bg_new_pin.py > blue-ghost-products/new-pin.txt
"""
import os
import sys
sys.path.insert(0, os.path.join(os.path.dirname(os.path.abspath(__file__)), '..', 'ephemeris-check', 'lib'))
import common
import numpy as np, lunyx_dem as dem, skyline as sk, skygeom as sg
root = common.ROOT
hz = sg.load_horizons(common.BASE + '/horizons/blue-ghost-1.2025-03.json'); sun = hz['sun']
entry, W_ = dem.site_windows(root, 'blue-ghost-1')
fine = [l for l in W_ if l.spacing == 3][0]; w60 = [l for l in W_ if l.spacing == 60][0]; w480 = [l for l in W_ if l.spacing == 480][0]; g = dem.global_layer(root)
ARC = np.arange(255.0, 285.0001, 0.05)
T0, T1 = sg.to_unix('2025-03-16T16:00:00Z'), sg.to_unix('2025-03-17T00:00:00Z')
for label, lat, lon in (('old pin (validated)', 18.562, 61.81), ('new pin (T-38, 7cf48f5)', 18.5622, 61.8102)):
    for name, st in (('3 m model / stored stack', dem.Stack([fine, w60, w480, g])), ('60 m window alone', dem.Stack([w60, w480, g]))):
        arc = sk.skyline(st, lat, lon, 2.0, ARC)
        sky = sg.ArcSkyline(ARC[0], 0.05, arc['elev_deg'])
        e = lambda t: sg.disc_edges(*sun.at(t), sky)
        cut = [x for x in sg.crossings(lambda t: e(t)[0], T0, T1) if x[1] == 'set'][0][0]
        lim = [x for x in sg.crossings(lambda t: e(t)[1], T0, T1) if x[1] == 'set'][0][0]
        print('%-24s %-26s ground %.2f m  first cut %s  last limb %s' % (label, name, arc['ground_m'], sg.to_iso(cut)[11:19], sg.to_iso(lim)[11:19]), flush=True)
