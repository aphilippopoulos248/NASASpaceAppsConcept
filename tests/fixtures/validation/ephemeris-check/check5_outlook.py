#!/usr/bin/env python3
"""Check 5: the seasonal outlook (a year of lunar days, and every arrival date in it).

Under test: outlook() as dumped by app_dump.mjs (outlook/app-now.json): one row per lunar day
with sunlight, any-Sun and Earth-centre percentages and the longest darkness and Earth gap,
then a score for a mission of the scenario's length starting at every arrival time, with the
best and worst arrivals. The app uses its own Sun/Earth model for the whole span.

Reference: the same quantities from SPICE directions (DE440; equal to JPL Horizons to
0.000002 deg) against this fixture's own skyline, sampled at the app's step. A second pass
uses the app's model directions against the same skyline: the difference between the two
passes is what the model costs. Those directions are 4 MB of app output and are not committed:

    python3 -I tests/fixtures/validation/ephemeris-check/check5_outlook.py --make-series-input
    node tests/fixtures/validation/ephemeris-check/app_skyat.mjs --series --in tests/fixtures/validation/ephemeris-check/outlook/model-series-input.json --out scripts/.cache/ephemeris-check/outlook/model-series.json
    python3 -I tests/fixtures/validation/ephemeris-check/check5_outlook.py [--write]
"""
import argparse
import json
import math
import os
import sys

sys.path.insert(0, os.path.join(os.path.dirname(os.path.abspath(__file__)), 'lib'))
import common  # noqa: E402
import numpy as np  # noqa: E402
import skygeom as sg  # noqa: E402
import spice_sky  # noqa: E402

ap = argparse.ArgumentParser()
ap.add_argument('--write', action='store_true')
ap.add_argument('--make-series-input', action='store_true', help='write outlook/model-series-input.json for app_skyat.mjs --series and stop')
ap.add_argument('--app', default='app-now.json', help='app dump under outlook/ to test')
ap.add_argument('--tag', default='', help='write results-<tag>.* instead of results.* (keeps the earlier record)')
args = ap.parse_args()
DIR = os.path.join(common.BASE, 'outlook')
with open(os.path.join(DIR, 'scenarios.json')) as fh:
    scenarios = json.load(fh)
with open(os.path.join(DIR, args.app)) as fh:
    app = json.load(fh)
by_id = {r['id']: r for r in app['results']}
hm = lambda t: sg.to_iso(t)[:16].replace('T', ' ')


def grid(o, r):
    """Sample instants covering the outlook span plus one mission length, at the outlook's own step."""
    step = o['stepMin'] * 60.0
    t0 = o['startMs'] / 1000.0
    t_end = o['endMs'] / 1000.0 + r['input']['durationH'] * 3600.0
    return t0, step, t0 + step * np.arange(int(math.ceil((t_end - t0) / step)) + 1)


if args.make_series_input:
    rows = []
    for s in scenarios:
        r = by_id[s['id']]
        sky = sg.Skyline.load(os.path.join(common.BASE, 'reference', 'skyline.%s.m%g.json' % (s['siteKey'], s['mastHeightM'])))
        t0, step, t = grid(r['outlook'], r)
        rows.append({'id': s['id'], 'lat': s['site']['lat'], 'lon': s['site']['lon'], 'elevationM': sky.extra['groundM'] + s['mastHeightM'], 'start': sg.to_iso(t0), 'stepMin': r['outlook']['stepMin'], 'count': int(t.size)})
    with open(os.path.join(DIR, 'model-series-input.json'), 'w') as fh:
        json.dump(rows, fh, indent=1)
    print('wrote outlook/model-series-input.json')
    sys.exit(0)

model = {}
p = os.path.join(common.CACHE, 'outlook', 'model-series.json')  # 4 MB of app output: kept out of the repository
if os.path.exists(p):
    with open(p) as fh:
        model = {x['id']: x for x in json.load(fh)['rows']}


def measures(t, step, sun, earth, sky):
    """Per-sample visible fraction of the Sun, any-Sun flag and Earth-centre flag."""
    frac, top = sg.disc(sun[:, 0], sun[:, 1], sun[:, 2], sky)
    return frac, (top > 0).astype(np.float64), (sg.centre_clearance(earth[:, 0], earth[:, 1], sky) > 0).astype(np.float64)


def window_mean(c, i0, i1):
    """Mean over samples i0 .. i1-1 from a cumulative sum with a leading zero."""
    return (c[i1] - c[i0]) / max(i1 - i0, 1)


lines = []
out = lines.append
report = {'app': app['app']['commit'], 'sites': {}}
for s in scenarios:
    r = by_id[s['id']]
    o = r['outlook']
    sky = sg.Skyline.load(os.path.join(common.BASE, 'reference', 'skyline.%s.m%g.json' % (s['siteKey'], s['mastHeightM'])))
    site = spice_sky.Site(s['site']['lat'], s['site']['lon'], sky.extra['groundM'] + s['mastHeightM'])
    t0, step, t = grid(o, r)
    series = site.series(t, cache_key='outlook.%s.%d.%d.%d' % (s['siteKey'], int(t0), int(step), t.size))
    frac, any_sun, earth_c = measures(t, step, series['sun'], series['earth'], sky)
    cum = {k: np.concatenate([[0.0], np.cumsum(v)]) for k, v in (('frac', frac), ('any', any_sun), ('earth', earth_c))}
    # Spells in full, from the continuous functions (not from the samples), searched 60 days beyond the span.
    lo, hi = t[0] - 60 * 86400.0, t[-1] + 60 * 86400.0
    dark = sg.hidden_spans(lambda x: sg.disc_edges(*site.body('sun', x), sky)[1], lo, hi)
    gaps = sg.hidden_spans(lambda x: sg.centre_clearance(*site.body('earth', x)[:2], sky), lo, hi)

    def longest(spans, a, b):
        over = [(x0, x1) for x0, x1, _, _ in spans if x1 > a and x0 < b]
        if not over:
            return 0.0, 0.0
        return max(x1 - x0 for x0, x1 in over) / 3600.0, max(min(x1, b) - max(x0, a) for x0, x1 in over) / 3600.0

    out('')
    out('%s  (%.4f, %.4f), 2 m; %d lunar days of %.6f d from %s; step %g min; app %s' % (s['id'], s['site']['lat'], s['site']['lon'], o['months'], o['windowDays'], sg.to_iso(t0), o['stepMin'], app['app']['commit']))
    out('  lunar day from       sunlight %% (disc)        any Sun %%             Earth centre %%        longest darkness, in full (h)   longest Earth gap, in full (h)')
    out('                       app     own    diff     app     own    diff    app     own    diff    app       own      diff          app       own      diff')
    rows = []
    w = {'illum': 0.0, 'any': 0.0, 'earth': 0.0, 'dark': 0.0, 'gap': 0.0, 'darkIn': 0.0, 'gapIn': 0.0}
    for row in o['rows']:
        a, b = row['startMs'] / 1000.0, row['endMs'] / 1000.0
        i0, i1 = int(round((a - t0) / step)), int(round((b - t0) / step))
        own = {'illum': 100 * window_mean(cum['frac'], i0, i1), 'any': 100 * window_mean(cum['any'], i0, i1), 'earth': 100 * window_mean(cum['earth'], i0, i1)}
        own['dark'], own['darkIn'] = longest(dark, a, b)
        own['gap'], own['gapIn'] = longest(gaps, a, b)
        d = {'illum': row['illuminationPct'] - own['illum'], 'any': row['sunAnyPct'] - own['any'], 'earth': row['earthVisiblePct'] - own['earth'],
             'dark': row['longestDarknessH'] - own['dark'], 'gap': row['longestEarthGapH'] - own['gap'],
             'darkIn': row['longestDarknessInWindowH'] - own['darkIn'], 'gapIn': row['longestEarthGapInWindowH'] - own['gapIn']}
        for k in w:
            w[k] = max(w[k], abs(d[k]))
        out('  %2d %s  %6.2f  %6.2f  %+5.2f   %6.2f  %6.2f  %+5.2f   %6.2f  %6.2f  %+5.2f   %7.1f   %7.1f   %+6.2f%s       %7.1f   %7.1f   %+6.2f%s'
            % (row['index'], hm(a), row['illuminationPct'], own['illum'], d['illum'], row['sunAnyPct'], own['any'], d['any'], row['earthVisiblePct'], own['earth'], d['earth'],
               row['longestDarknessH'], own['dark'], d['dark'], '' if row['darknessComplete'] else '*', row['longestEarthGapH'], own['gap'], d['gap'], '' if row['earthGapComplete'] else '*'))
        rows.append({'index': row['index'], 'start': sg.to_iso(a), 'own': own, 'appMinusOwn': d})
    out('  worst app - own over the %d rows: sunlight %.2f, any Sun %.2f, Earth %.2f points; darkness in full %.2f h (inside the row %.2f h); Earth gap in full %.2f h (inside the row %.2f h)'
        % (len(rows), w['illum'], w['any'], w['earth'], w['dark'], w['darkIn'], w['gap'], w['gapIn']))

    # ---- arrivals: a mission of missionH hours starting every stepMs
    arr = o['arrivals']
    n, k_step, k_len = arr['n'], int(round(arr['stepMs'] / 1000.0 / step)), int(round(arr['missionH'] * 3600.0 / step))
    idx = np.arange(n) * k_step
    own_illum = 100 * (cum['frac'][idx + k_len] - cum['frac'][idx]) / k_len
    own_earth = 100 * (cum['earth'][idx + k_len] - cum['earth'][idx]) / k_len
    own_score = 0.5 * (own_illum + own_earth)
    app_score = np.array(arr['score'], dtype=np.float64)
    d_score = app_score - own_score
    d_il = np.array(arr['illuminationPct'], dtype=np.float64) - own_illum
    d_ea = np.array(arr['earthVisiblePct'], dtype=np.float64) - own_earth
    tb, tw = t0 + int(np.argmax(own_score)) * arr['stepMs'] / 1000.0, t0 + int(np.argmin(own_score)) * arr['stepMs'] / 1000.0
    out('  arrivals: %d start times %g h apart, mission %g h. app - own: score within %.2f points (sunlight %.2f, Earth %.2f)'
        % (n, arr['stepMs'] / 3.6e6, arr['missionH'], float(np.max(np.abs(d_score))), float(np.max(np.abs(d_il))), float(np.max(np.abs(d_ea)))))
    best, worst_a, planned = o['best'], o['worst'], o['planned']
    out('    best arrival   app %s score %.2f | own %s score %.2f%s' % (hm(best['startMs'] / 1000.0), best['score'], hm(tb), float(own_score.max()),
        '' if abs(best['startMs'] / 1000.0 - tb) < 1 else '   (own score at the app\'s best time: %.2f)' % float(own_score[int(round((best['startMs'] / 1000.0 - t0) / (arr['stepMs'] / 1000.0)))])))
    out('    worst arrival  app %s score %.2f | own %s score %.2f%s' % (hm(worst_a['startMs'] / 1000.0), worst_a['score'], hm(tw), float(own_score.min()),
        '' if abs(worst_a['startMs'] / 1000.0 - tw) < 1 else '   (own score at the app\'s worst time: %.2f)' % float(own_score[int(round((worst_a['startMs'] / 1000.0 - t0) / (arr['stepMs'] / 1000.0)))])))
    out('    planned (the scenario\'s own start): app score %.2f, sunlight %.2f, Earth %.2f | own %.2f, %.2f, %.2f' % (planned['score'], planned['illuminationPct'], planned['earthVisiblePct'], own_score[0], own_illum[0], own_earth[0]))
    # ---- the longest spells of the whole span
    span_a, span_b = o['startMs'] / 1000.0, o['endMs'] / 1000.0
    for key, spans, label in (('longestDarkness', dark, 'darkness'), ('longestEarthGap', gaps, 'Earth gap')):
        f = o.get(key)
        over = [(x0, x1) for x0, x1, _, _ in spans if x1 > span_a and x0 < span_b]
        ref = max(over, key=lambda x: x[1] - x[0]) if over else None
        if f and ref:
            out('    longest %s of the span: app %s .. %s = %.1f h | own %s .. %s = %.1f h (start %+.1f min, end %+.1f min)'
                % (label, hm(f['startMs'] / 1000.0), hm(f['endMs'] / 1000.0), f['hours'], hm(ref[0]), hm(ref[1]), (ref[1] - ref[0]) / 3600.0, (f['startMs'] / 1000.0 - ref[0]) / 60.0, (f['endMs'] / 1000.0 - ref[1]) / 60.0))
    entry = {'rows': rows, 'worstRowDiff': w, 'arrivals': {'n': n, 'worstScoreDiff': float(np.max(np.abs(d_score))), 'worstSunlightDiff': float(np.max(np.abs(d_il))), 'worstEarthDiff': float(np.max(np.abs(d_ea))),
             'appBest': sg.to_iso(best['startMs'] / 1000.0), 'ownBest': sg.to_iso(tb), 'appBestScore': best['score'], 'ownBestScore': float(own_score.max()),
             'appWorst': sg.to_iso(worst_a['startMs'] / 1000.0), 'ownWorst': sg.to_iso(tw), 'appWorstScore': worst_a['score'], 'ownWorstScore': float(own_score.min())}}

    # ---- what the in-app model costs: the same computation with the app's own directions
    m = model.get(s['id'])
    if m and m['count'] == t.size:
        msun = np.stack([m['sunAz'], m['sunEl'], m['sunRadius']], axis=-1)
        mearth = np.stack([m['earthAz'], m['earthEl'], m['earthRadius']], axis=-1)
        sep = lambda a, b: sg.separation(a[:, 0], a[:, 1], b[:, 0], b[:, 1])
        d_sun, d_earth = sep(msun, series['sun']), sep(mearth, series['earth'])
        mfrac, many, mearth_c = measures(t, step, msun, mearth, sky)
        mc = {k: np.concatenate([[0.0], np.cumsum(v)]) for k, v in (('frac', mfrac), ('any', many), ('earth', mearth_c))}
        cost = {'illum': 0.0, 'any': 0.0, 'earth': 0.0}
        for row in o['rows']:
            i0, i1 = int(round((row['startMs'] / 1000.0 - t0) / step)), int(round((row['endMs'] / 1000.0 - t0) / step))
            for k, key in (('illum', 'frac'), ('any', 'any'), ('earth', 'earth')):
                cost[k] = max(cost[k], abs(100 * (window_mean(mc[key], i0, i1) - window_mean(cum[key], i0, i1))))
        m_score = 50 * ((mc['frac'][idx + k_len] - mc['frac'][idx]) + (mc['earth'][idx + k_len] - mc['earth'][idx])) / k_len
        flips = int(np.sum(many != any_sun)), int(np.sum(mearth_c != earth_c))
        out('  the in-app model against SPICE over this year (%d instants %g min apart): Sun within %.4f deg, Earth within %.4f deg' % (t.size, o['stepMin'], float(d_sun.max()), float(d_earth.max())))
        out('    on the same skyline that changes a lunar day\'s sunlight by at most %.3f points, any-Sun by %.3f, Earth by %.3f; an arrival score by %.3f; %d of %d samples change their any-Sun state and %d their Earth state'
            % (cost['illum'], cost['any'], cost['earth'], float(np.max(np.abs(m_score - own_score))), flips[0], t.size, flips[1]))
        entry['modelCost'] = {'sunWorstDeg': float(d_sun.max()), 'earthWorstDeg': float(d_earth.max()), 'rowSunlightPoints': cost['illum'], 'rowAnySunPoints': cost['any'], 'rowEarthPoints': cost['earth'],
                              'arrivalScorePoints': float(np.max(np.abs(m_score - own_score))), 'samplesChangingSunState': flips[0], 'samplesChangingEarthState': flips[1], 'samples': int(t.size)}
    report['sites'][s['id']] = entry

text = '\n'.join(lines).lstrip('\n')
print(text)
if args.write:
    stem = 'results-%s' % args.tag if args.tag else 'results'
    with open(os.path.join(DIR, stem + '.json'), 'w') as fh:
        json.dump(report, fh, indent=1)
        fh.write('\n')
    with open(os.path.join(DIR, stem + '.txt'), 'w') as fh:
        fh.write(text + '\n')
