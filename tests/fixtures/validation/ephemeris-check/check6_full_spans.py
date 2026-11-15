#!/usr/bin/env python3
"""Check 6: the longest darkness and the longest Earth gap, measured in full.

The app reports the longest spell with the Sun entirely hidden, and the longest spell without
line of sight to Earth's centre, both inside the mission window (longestDarknessH,
longestEarthGapH) and followed past the window's edges to their real start and end
(metrics.longestDarknessFull, longestEarthGapFull). Reference: SPICE Sun and Earth against
this fixture's own skyline, searched 60 days beyond each edge, every transition bisected to
one second. Eclipses of the Sun by Earth are not darkness here unless the app's spell is one.

    python3 -I tests/fixtures/validation/ephemeris-check/check6_full_spans.py [--write]
"""
import argparse
import json
import os
import sys

sys.path.insert(0, os.path.join(os.path.dirname(os.path.abspath(__file__)), 'lib'))
import common  # noqa: E402
import numpy as np  # noqa: E402
import skygeom as sg  # noqa: E402
import spice_sky  # noqa: E402

ap = argparse.ArgumentParser()
ap.add_argument('--write', action='store_true')
args = ap.parse_args()
DIR = os.path.join(common.BASE, 'spans')
with open(os.path.join(DIR, 'scenarios.json')) as fh:
    scenarios = json.load(fh)
apps = {}
for name in ('before', 'now'):
    p = os.path.join(DIR, 'app-%s.json' % name)
    if os.path.exists(p):
        with open(p) as fh:
            d = json.load(fh)
        apps[name] = {'commit': d['app']['commit'], 'by_id': {r['id']: r for r in d['results']}}
MARGIN = 60 * 86400.0
hms = lambda t: sg.to_iso(t).replace('T', ' ')[:19]


def spells(fn, t0, t1, key):
    """Maximal spans where fn <= 0 (hidden) that overlap [t0, t1], searched MARGIN beyond each edge."""
    lo, hi = t0 - MARGIN, t1 + MARGIN
    cross = sg.crossings(fn, lo, hi, step=600.0, tol=1.0)
    edges = [lo] + [t for t, _ in cross] + [hi]
    hidden_first = float(fn(np.array([lo]))[0]) <= 0
    out = []
    for i in range(len(edges) - 1):
        hidden = hidden_first if i % 2 == 0 else not hidden_first
        a, b = edges[i], edges[i + 1]
        if hidden and b > t0 and a < t1:
            out.append({'start': a, 'end': b, 'startFound': i > 0, 'endFound': i + 2 < len(edges), 'inWindowH': (min(b, t1) - max(a, t0)) / 3600.0})
    return out


lines = []
out = lines.append
report = {}
for s in scenarios:
    sky = sg.Skyline.load(os.path.join(common.BASE, 'reference', 'skyline.%s.m%g.json' % (s['siteKey'], s['mastHeightM'])))
    site = spice_sky.Site(s['site']['lat'], s['site']['lon'], sky.extra['groundM'] + s['mastHeightM'])
    t0 = sg.to_unix(s['start'])
    t1 = t0 + s['durationH'] * 3600.0
    sun_any = lambda t: sg.disc_edges(*site.body('sun', t), sky)[1]            # > 0 while any part of the disc shows
    earth = lambda t: sg.centre_clearance(*site.body('earth', t)[:2], sky)     # > 0 while Earth's centre shows
    ref = {}
    for key, fn in (('darkness', sun_any), ('earthGap', earth)):
        found = spells(fn, t0, t1, key)
        ref[key] = max(found, key=lambda x: x['inWindowH']) if found else None
        ref[key + 'Full'] = max(found, key=lambda x: x['end'] - x['start']) if found else None
    out('')
    out('%s  (%.4f, %.4f), 2 m, window %s + %d h' % (s['id'], s['site']['lat'], s['site']['lon'], s['start'], s['durationH']))
    entry = {'window': {'start': s['start'], 'durationH': s['durationH']}, 'reference': {}, 'apps': {}}
    for key, label in (('darkness', 'darkness'), ('earthGap', 'Earth gap')):
        r, full = ref[key], ref[key + 'Full']
        if not full:
            out('  reference %-9s none in the window' % label)
            entry['reference'][key] = None
            continue
        out('  reference %-9s longest inside the window %.2f h; longest overlapping spell in full %s .. %s = %.2f h%s'
            % (label, r['inWindowH'], hms(full['start']), hms(full['end']), (full['end'] - full['start']) / 3600.0, '' if full['startFound'] and full['endFound'] else ' (search limit reached)'))
        entry['reference'][key] = {'inWindowH': r['inWindowH'], 'fullStart': sg.to_iso(full['start']), 'fullEnd': sg.to_iso(full['end']), 'fullH': (full['end'] - full['start']) / 3600.0,
                                   'startFound': full['startFound'], 'endFound': full['endFound']}
    for name, app in apps.items():
        r = app['by_id'].get(s['id'])
        if not r:
            continue
        m = r['metrics']
        row = {'commit': app['commit'], 'ephemeris': r['series']['source']}
        for key, label, in_key, full_key in (('darkness', 'darkness', 'longestDarknessH', 'longestDarknessFull'), ('earthGap', 'Earth gap', 'longestEarthGapH', 'longestEarthGapFull')):
            full = m.get(full_key)
            refk = entry['reference'].get(key)
            if full is None:
                out('  app %s %-9s inside the window %.2f h; no full-length value%s' % (app['commit'], label, m[in_key], '' if refk is None else '  <-- the reference has one'))
                row[key] = {'inWindowH': m[in_key], 'full': None}
                continue
            a0, a1 = full['startMs'] / 1000.0, full['endMs'] / 1000.0
            d_in = m[in_key] - refk['inWindowH'] if refk else float('nan')
            d0 = (a0 - sg.to_unix(refk['fullStart'])) / 60.0 if refk else float('nan')
            d1 = (a1 - sg.to_unix(refk['fullEnd'])) / 60.0 if refk else float('nan')
            out('  app %s %-9s inside the window %.2f h (%+.2f); in full %s .. %s = %.2f h (start %+.1f min, end %+.1f min, length %+.2f h)%s'
                % (app['commit'], label, m[in_key], d_in, hms(a0), hms(a1), full['hours'], d0, d1, full['hours'] - (refk['fullH'] if refk else float('nan')),
                   '' if full['startFound'] and full['endFound'] else ' (app: search limit reached)'))
            row[key] = {'inWindowH': m[in_key], 'inWindowMinusReferenceH': d_in, 'fullStart': sg.to_iso(a0), 'fullEnd': sg.to_iso(a1), 'fullH': full['hours'],
                        'startMinusReferenceMin': d0, 'endMinusReferenceMin': d1, 'startFound': full['startFound'], 'endFound': full['endFound']}
        entry['apps'][name] = row
    report[s['id']] = entry

text = '\n'.join(lines).lstrip('\n')
print(text)
if args.write:
    with open(os.path.join(DIR, 'results.json'), 'w') as fh:
        json.dump(report, fh, indent=1)
        fh.write('\n')
    with open(os.path.join(DIR, 'results.txt'), 'w') as fh:
        fh.write(text + '\n')
