#!/usr/bin/env python3
"""Check 4: Earth visibility at polar and limb sites.

Reference: Earth's centre from JPL Horizons (hourly rows, interpolated) against this
fixture's own skyline (reference/skyline.<site>.m2.json, 0.1 deg in azimuth). Under test:
analyse().metrics and events as dumped by app_dump.mjs (earth/app-*.json). The app defines
Earth visibility, Earthrise and Earthset by Earth's centre, so the reference does too.

    python3 -I tests/fixtures/validation/ephemeris-check/check4_earth.py [--write]
"""
import argparse
import json
import os
import sys

sys.path.insert(0, os.path.join(os.path.dirname(os.path.abspath(__file__)), 'lib'))
import common  # noqa: E402
import numpy as np  # noqa: E402
import skygeom as sg  # noqa: E402

ap = argparse.ArgumentParser()
ap.add_argument('--write', action='store_true')
args = ap.parse_args()
DIR = os.path.join(common.BASE, 'earth')
with open(os.path.join(DIR, 'scenarios.json')) as fh:
    scenarios = json.load(fh)
apps = {}
for name in ('app-before', 'app-now'):
    p = os.path.join(DIR, name + '.json')
    if os.path.exists(p):
        with open(p) as fh:
            d = json.load(fh)
        apps[name] = {'commit': d['app']['commit'], 'by_id': {r['id']: r for r in d['results']}}


def visibility(series, skyline, t0, t1):
    """Percent of [t0, t1] with Earth's centre above the skyline, the visible spans and the gaps."""
    fn = lambda t: sg.centre_clearance(*series.at(t)[:2], skyline)
    t = np.arange(t0, t1 + 30.0, 60.0)
    g = fn(t)
    spans = []
    for a, b, open_a, open_b in sg.intervals(t, g):
        if not open_a:
            a = sg.refine(lambda x: float(fn(np.array([x]))[0]), a - 60, a + 60)
        if not open_b:
            b = sg.refine(lambda x: float(fn(np.array([x]))[0]), b - 60, b + 60)
        spans.append((a, b, open_a, open_b))
    seen = sum(b - a for a, b, _, _ in spans)
    gaps = []
    edges = [t0] + [x for a, b, _, _ in spans for x in (a, b)] + [t1]
    for i in range(0, len(edges), 2):
        if edges[i + 1] - edges[i] > 1:
            gaps.append((edges[i], edges[i + 1], i == 0, i + 2 == len(edges)))
    events = [(a, 'earthrise') for a, _, oa, _ in spans if not oa] + [(b, 'earthset') for _, b, _, ob in spans if not ob]
    return 100.0 * seen / (t1 - t0), spans, gaps, sorted(events), fn


report = {'definition': 'Earth counts as visible when its centre is above the skyline (the app\'s definition).', 'sites': {}}
lines = []
out = lines.append
for s in scenarios:
    hz = sg.load_horizons(os.path.join(common.BASE, 'horizons', s['horizons'] + '.json'))
    sky = sg.Skyline.load(os.path.join(common.BASE, 'reference', 'skyline.%s.m%g.json' % (s['id'], s['mastHeightM'])))
    t0 = sg.to_unix(s['start'])
    t1 = t0 + s['durationH'] * 3600.0
    pct, spans, gaps, events, fn = visibility(hz['earth'], sky, t0, t1)
    pct05 = visibility(hz['earth'], sky.resampled(0.5), t0, t1)[0]
    az, el, _ = hz['earth'].at(np.arange(t0, t1 + 1, 3600.0))
    longest = max(gaps, key=lambda g: g[1] - g[0]) if gaps else None
    out('')
    out('%s  (%.4f, %.4f), mast %g m, %s .. +%d days' % (s['id'], s['site']['lat'], s['site']['lon'], s['mastHeightM'], s['start'], s['durationH'] // 24))
    out('  Horizons: Earth elevation %.2f .. %.2f deg, azimuth %.1f .. %.1f; reference skyline along that path %.2f .. %.2f deg'
        % (el.min(), el.max(), az.min(), az.max(), sky.at(az).min(), sky.at(az).max()))
    out('  reference: Earth visible %.2f %% of the window (%.2f %% with the skyline read every 0.5 deg); %d risings/settings; longest gap %s'
        % (pct, pct05, len(events), ('%.1f h%s' % ((longest[1] - longest[0]) / 3600, ' (runs into the window edge)' if longest[2] or longest[3] else '')) if longest else 'none'))
    entry = {
        'site': s['site'], 'window': {'start': s['start'], 'durationH': s['durationH']},
        'reference': {'earthVisiblePct': pct, 'earthVisiblePctSkylineEvery0p5deg': pct05, 'longestGapH': (longest[1] - longest[0]) / 3600 if longest else 0.0,
                      'longestGapOpenEnded': bool(longest and (longest[2] or longest[3])), 'events': [{'type': k, 'utc': sg.to_iso(t)} for t, k in events]},
        'apps': {},
    }
    for name, app in apps.items():
        r = app['by_id'].get(s['id'])
        if not r:
            continue
        m = r['metrics']
        ev_app = [(e['timeMs'] / 1000.0, e['type']) for e in r['events'] if e['type'] in ('earthrise', 'earthset')]
        # The same Horizons Earth against the app's own skyline: separates skyline differences from everything else.
        app_sky = sg.Skyline(r['horizon']['elevDeg'], r['horizon']['azStepDeg'])
        pct_app_sky, _, gaps_as, ev_as, _ = visibility(hz['earth'], app_sky, t0, t1)
        diffs = []
        for t, k in ev_app:
            cand = [tr for tr, kr in events if kr == k]
            if cand:
                tr = min(cand, key=lambda x: abs(x - t))
                diffs.append({'type': k, 'app': sg.to_iso(t), 'reference': sg.to_iso(tr), 'appMinusReferenceMin': (t - tr) / 60.0})
        worst = max((abs(d['appMinusReferenceMin']) for d in diffs), default=0.0)
        out('  app %s (%s, ephemeris %s): Earth visible %.2f %% (%+.2f vs reference); longest gap %.1f h%s; %d risings/settings (reference %d); worst time difference %.1f min'
            % (name, app['commit'], r['series']['source'], m['earthVisiblePct'], m['earthVisiblePct'] - pct, m['longestEarthGapH'], ' (open-ended)' if m['earthGapOpenEnded'] else '',
               len(ev_app), len(events), worst))
        out('      the same Horizons Earth against the app\'s own skyline gives %.2f %%, so the app\'s logic and ephemeris account for %+.2f and its skyline for %+.2f points'
            % (pct_app_sky, m['earthVisiblePct'] - pct_app_sky, pct_app_sky - pct))
        for d in diffs:
            out('      %-9s app %s  reference %s  %+7.1f min' % (d['type'], d['app'], d['reference'], d['appMinusReferenceMin']))
        entry['apps'][name] = {
            'commit': app['commit'], 'ephemeris': r['series']['source'], 'earthVisiblePct': m['earthVisiblePct'], 'diffPct': m['earthVisiblePct'] - pct,
            'longestEarthGapH': m['longestEarthGapH'], 'earthGapOpenEnded': m['earthGapOpenEnded'], 'events': diffs, 'eventCount': len(ev_app),
            'worstEventDiffMin': worst, 'horizonsEarthOnAppSkylinePct': pct_app_sky,
        }
    report['sites'][s['id']] = entry

text = '\n'.join(lines).lstrip('\n')
print(text)
if args.write:
    with open(os.path.join(DIR, 'results.json'), 'w') as fh:
        json.dump(report, fh, indent=1)
        fh.write('\n')
    with open(os.path.join(DIR, 'results.txt'), 'w') as fh:
        fh.write(text + '\n')
