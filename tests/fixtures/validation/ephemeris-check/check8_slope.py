#!/usr/bin/env python3
"""Check 8: terrain slope at the catalogued sites and at nearby-scan candidates.

The app states its measure: the least-squares plane through a 3 x 3 pattern of points half a
baseline apart, on the finest elevation layer that has data at all nine, with the baseline it
reports (10 m on a 3 m site model, 120 m on a 60 m window). Reference: the same measure
computed here from the elevation files with lib/lunyx_dem.py, at the app's baseline, and at
120 m on the 60 m window for every site so the two baselines can be seen side by side.

    python3 -I tests/fixtures/validation/ephemeris-check/check8_slope.py [--write]
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
args = ap.parse_args()
DIR = os.path.join(common.BASE, 'slope')
with open(os.path.join(DIR, 'app-now.json')) as fh:
    app = json.load(fh)
wrap = lambda a: (a + 180.0) % 360.0 - 180.0
lines = []
out = lines.append
report = {'app': app['app']['commit'], 'sites': {}, 'nearby': []}
out('App %s. Slope = least-squares plane through 3 x 3 points half a baseline apart; aspect = direction the ground falls towards.' % app['app']['commit'])
out('')
out('site             baseline  app slope  own slope   diff     app aspect  own aspect   diff   layer (own)                                   | own, 120 m on the 60 m window')
worst = {'slope': 0.0, 'aspect': 0.0}
for r in app['results']:
    if r.get('nearby') or not r.get('slope'):
        continue
    site = r['input']['site']
    stack = dem.stack_for(common.ROOT, site['lat'], site['lon'], site['id'])
    b = r['slope']['baselineM']
    s_own, a_own, layer = dem.plane_slope(stack, site['lat'], site['lon'], b)
    # The same measure over 120 m on the 60 m window only: what the site would read without a 3 m model.
    coarse = dem.Stack([l for l in stack.layers if l.resolution_m >= 40])
    s120, a120, layer120 = dem.plane_slope(coarse, site['lat'], site['lon'], 120.0)
    ds = r['slope']['slopeDeg'] - s_own
    da = wrap(r['slope']['aspectDeg'] - a_own)
    worst['slope'] = max(worst['slope'], abs(ds))
    # An aspect is ill-defined on nearly flat ground: weigh its difference by the slope.
    worst['aspect'] = max(worst['aspect'], abs(da) * math.sin(math.radians(s_own)))
    out('%-15s %5g m   %7.3f    %7.3f   %+7.4f   %7.1f     %7.1f    %+6.2f   %-45s | %6.3f deg, aspect %5.1f' % (r['id'], b, r['slope']['slopeDeg'], s_own, ds, r['slope']['aspectDeg'], a_own, da, (layer or '')[:45], s120, a120))
    report['sites'][r['id']] = {'baselineM': b, 'appSlopeDeg': r['slope']['slopeDeg'], 'ownSlopeDeg': s_own, 'appAspectDeg': r['slope']['aspectDeg'], 'ownAspectDeg': a_own, 'appLayer': r['slope']['demName'], 'ownLayer': layer,
                                'own120mOn60mWindow': {'slopeDeg': s120, 'aspectDeg': a120}}
out('')
out('28 sites: worst slope difference %.4f deg; worst aspect difference, weighted by sin(slope), %.4f deg' % (worst['slope'], worst['aspect']))
report['worstSlopeDiffDeg'] = worst['slope']
report['worstAspectDiffWeightedDeg'] = worst['aspect']

nb = next(r for r in app['results'] if r.get('nearby'))
centre = nb['input']['site']
stack = dem.stack_for(common.ROOT, centre['lat'], centre['lon'], centre['id'])
rows = [c for c in nb['nearby']['rows'] if c['rank'] and c['rank'] <= 10]
rows.sort(key=lambda c: c['rank'])
out('')
out('Nearby scan around IM-2 (radius %g m, spacing %g m, %d candidates): the ten best-ranked' % (nb['nearby']['options']['radiusM'], nb['nearby']['options']['spacingM'], len(nb['nearby']['rows'])))
out('rank  offset E, N (m)   position error   app slope  own slope   diff     app aspect  own aspect   app height  own height')
wn = {'slope': 0.0, 'pos': 0.0, 'height': 0.0}
for c in rows:
    la, lo = dem.offset_point(centre['lat'], centre['lon'], c['eastM'], c['northM'])
    # Distance between where the app put the candidate and where the offset leads, metres.
    u1, u2 = dem.unit(float(la), float(lo)), dem.unit(c['lat'], c['lon'])
    pos = float(np.arccos(np.clip(u1 @ u2, -1, 1)) * dem.R_M)
    s_own, a_own, _ = dem.plane_slope(stack, c['lat'], c['lon'], c['slope']['baselineM'])
    h_own = float(stack.sample(c['lat'], c['lon'])[0])
    wn['slope'] = max(wn['slope'], abs(c['slope']['slopeDeg'] - s_own))
    wn['pos'] = max(wn['pos'], pos)
    wn['height'] = max(wn['height'], abs(c['elevationM'] - h_own))
    out('%3d   %6g, %6g      %6.3f m       %7.3f    %7.3f   %+7.4f   %7.1f     %7.1f      %8.2f    %8.2f' % (c['rank'], c['eastM'], c['northM'], pos, c['slope']['slopeDeg'], s_own, c['slope']['slopeDeg'] - s_own, c['slope']['aspectDeg'], a_own, c['elevationM'], h_own))
    report['nearby'].append({'rank': c['rank'], 'eastM': c['eastM'], 'northM': c['northM'], 'positionErrorM': pos, 'appSlopeDeg': c['slope']['slopeDeg'], 'ownSlopeDeg': s_own, 'appHeightM': c['elevationM'], 'ownHeightM': h_own})
out('ten candidates: worst slope difference %.4f deg, position %.3f m, height %.2f m. Baseline %g m on the 60 m window for every candidate.' % (wn['slope'], wn['pos'], wn['height'], rows[0]['slope']['baselineM']))
# The scan's slope limit: every candidate over it must be rejected, every other kept.
limit = nb['nearby']['options']['slopeLimitDeg']
wrong = [c for c in nb['nearby']['rows'] if c['slope'] and math.isfinite(c['slope']['slopeDeg']) and ((c['slope']['slopeDeg'] > limit) != (c['rejected'] == 'slope'))]
n_rej = sum(1 for c in nb['nearby']['rows'] if c['rejected'] == 'slope')
out('slope limit %g deg: %d of %d candidates rejected for slope; %d inconsistent with their own slope value' % (limit, n_rej, len(nb['nearby']['rows']), len(wrong)))
report['nearbyWorst'] = wn
report['nearbyRejectedForSlope'] = n_rej
report['nearbyInconsistent'] = len(wrong)
text = '\n'.join(lines)
print(text)
if args.write:
    with open(os.path.join(DIR, 'results.json'), 'w') as fh:
        json.dump(report, fh, indent=1)
        fh.write('\n')
    with open(os.path.join(DIR, 'results.txt'), 'w') as fh:
        fh.write(text + '\n')
