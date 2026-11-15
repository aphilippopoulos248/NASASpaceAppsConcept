#!/usr/bin/env python3
"""Check 10 (T-34 item 5, second half): both ends of every rise and set, and Earth by disc (T-31 items 2-3).

Under test: analyse().transitions and the new metrics (earthAnyPct, longestEarthAnyGapH) as dumped by
app_dump.mjs (transitions/app-<build>[-bundled].json). The shape is taken from the contract,
docs/lunyx/handover/T-31-event-spans.md; nothing in src/ is read.

Reference: JPL Horizons Sun and Earth (horizons/*.json, hourly, interpolated through unit vectors)
against this fixture's own skylines: reference/skyline.<site>.m2.json (0.1 deg), and for Blue Ghost
at 0.5, 2 and 5 m an arc 255-285 deg every 0.05 deg on the stored stack (as check 2). Disc in 61
vertical strips (the middle strip passes through the centre, so the lowest and highest points of the
disc are exact). Instants bisected to 1 s:
  set:  first cut = lowest point of the disc reaches the skyline; centre; last limb = highest point
  rise: first limb = highest point clears the skyline; centre; whole disc clear = lowest point clears
Any part of Earth's disc is in view when its highest point is above the skyline (PGDA's definition).

Tolerance. A time difference is turned into the skyline (or ephemeris) error that would explain it:
dt times the rate at which the clearance changes there. 0.01 deg is agreement (the two skylines agree
to a few thousandths, the in-app model is within 0.0038 deg of SPICE); that is 1.2 min for the Sun at
Blue Ghost and several minutes to hours near the pole. Percentages: 0.1 points, as in check 4.

    node app_dump.mjs [--bundle] --scenarios transitions/scenarios[-bundled].json --out transitions/app-<build>[-bundled].json --root EXPORT --commit <build>
    python3 -I tests/fixtures/validation/ephemeris-check/check10_transitions.py --build <build> [--write]
"""
import argparse
import json
import os
import sys

sys.path.insert(0, os.path.join(os.path.dirname(os.path.abspath(__file__)), 'lib'))
import common  # noqa: E402
import numpy as np  # noqa: E402
import lunyx_dem as dem  # noqa: E402
import skyline as sk  # noqa: E402
import skygeom as sg  # noqa: E402

ap = argparse.ArgumentParser()
ap.add_argument('--build', required=True)
ap.add_argument('--write', action='store_true')
ap.add_argument('--instants-only', action='store_true', help='skip the Earth-by-disc shares (minutes of CPU over 60-day windows)')
ap.add_argument('--resample', type=float, default=0.0, help='read the own 0.1 deg skylines only every N deg (the app keeps 0.5 deg), to see what the azimuth sampling alone does')
args = ap.parse_args()
DIR = os.path.join(common.BASE, 'transitions')
TOL_DEG, TOL_PCT = 0.01, 0.1
hms = lambda t: sg.to_iso(t)[5:19].replace('T', ' ')

dumps = {}
for suffix in ('', '-bundled'):
    p = os.path.join(DIR, 'app-%s%s.json' % (args.build, suffix))
    if os.path.exists(p):
        with open(p) as fh:
            d = json.load(fh)
        for r in d['results']:
            dumps[r['id']] = (r, d['app'])
with open(os.path.join(DIR, 'scenarios.json')) as fh:
    scen = json.load(fh)
with open(os.path.join(DIR, 'scenarios-bundled.json')) as fh:
    scen += json.load(fh)
HZ = {'blue-ghost-1': 'blue-ghost-1.2025-03.json', 'im-2': 'im-2.2025-03-04.json', 'chandrayaan-3': 'chandrayaan-3.2023-08-09.json',
      'shackleton-rim': 'shackleton-rim.2025-03-04.json', 'connecting-ridge': 'connecting-ridge.2025-03-04.json',
      'limb-east': 'limb-east.2025-03-04.json', 'limb-west': 'limb-west.2025-03-04.json'}
hz_cache, sky_cache = {}, {}


def horizons(key):
    if key not in hz_cache:
        hz_cache[key] = sg.load_horizons(os.path.join(common.BASE, 'horizons', HZ[key]))
    return hz_cache[key]


def skyline_for(s):
    key = (s['siteKey'], s['mastHeightM'])
    if key not in sky_cache:
        if s['siteKey'] == 'blue-ghost-1':
            arc_az = np.arange(255.0, 285.0001, 0.05)
            stack = dem.stack_for(common.ROOT, s['site']['lat'], s['site']['lon'], 'blue-ghost-1')
            arc = sk.skyline(stack, s['site']['lat'], s['site']['lon'], s['mastHeightM'], arc_az)
            sky_cache[key] = sg.ArcSkyline(arc_az[0], 0.05, arc['elev_deg'])
        else:
            assert s['mastHeightM'] == 2
            sky_cache[key] = sg.Skyline.load(os.path.join(common.BASE, 'reference', 'skyline.%s.m2.json' % s['siteKey']))
            if args.resample:
                sky_cache[key] = sky_cache[key].resampled(args.resample)
    return sky_cache[key]


def functions(series, sky):
    def low(t):
        return sg.disc_edges(*series.at(t), sky)[0]

    def high(t):
        return sg.disc_edges(*series.at(t), sky)[1]

    def centre(t):
        az, el, _ = series.at(t)
        return sg.centre_clearance(az, el, sky)
    return {'low': low, 'high': high, 'centre': centre}


def rate(fn, t):
    """|d clearance / dt| at t, deg per minute."""
    return abs(float(fn(np.array([t + 30.0]))[0] - fn(np.array([t - 30.0]))[0]))


def nearest(cross, t, want):
    c = [x for x, k in cross if k == want]
    return min(c, key=lambda x: abs(x - t)) if c else None


lines = []
out = lines.append
report = {'build': args.build, 'toleranceDeg': TOL_DEG, 'tolerancePct': TOL_PCT, 'cases': {}}
worst = {'deg': 0.0, 'pct': 0.0}
out('App %s: SiteAnalysis.transitions and the any-part Earth metrics against Horizons + own skylines%s.' % (args.build, ' read only every %g deg (Blue Ghost arcs: 0.05 deg as always)' % args.resample if args.resample else ''))
out('Each instant: app, reference, app minus reference, and that difference as a skyline error (dt x rate of the clearance). Tolerance %.2f deg; %.1f points.' % (TOL_DEG, TOL_PCT))
for s in scen:
    if s['id'] not in dumps:
        continue
    r, meta = dumps[s['id']]
    series_src = r['series']['source']
    hz = horizons(s['siteKey'])
    sky = skyline_for(s)
    t_lo, t_hi = max(hz['sun'].t0, hz['earth'].t0), min(hz['sun'].t1, hz['earth'].t1)
    w0 = r['series']['startMs'] / 1000.0
    w1 = w0 + s['durationH'] * 3600.0
    case = {'id': s['id'], 'ephemeris': series_src, 'transitions': [], 'checks': []}
    out('')
    out('%s  (%.4f, %.4f), %g m, window %s + %g h, app ephemeris %s' % (s['id'], s['site']['lat'], s['site']['lon'], s['mastHeightM'], s['start'], s['durationH'], series_src))
    # Event/span consistency stated by the contract: sunset = span.end, sunrise = span.start, Earth events = one of span.centre.
    bad = 0
    for e in r.get('events', []):
        sp = e.get('span')
        if not sp:
            bad += 1
            continue
        if e['type'] == 'sunset':
            bad += int(sp['end']['timeMs'] != e['timeMs'])
        elif e['type'] == 'sunrise':
            bad += int(sp['start']['timeMs'] != e['timeMs'])
        elif e['type'] in ('earthrise', 'earthset'):
            bad += int(not any(c['timeMs'] == e['timeMs'] for c in sp.get('centre', [])))
    out('  events: %d, each with its span as the contract says: %s' % (len(r.get('events', [])), 'yes' if bad == 0 else 'NO (%d)' % bad))
    case['eventsWithoutConsistentSpan'] = bad
    fns = {}
    for tr in r.get('transitions') or []:
        body = tr['body']
        if body not in fns:
            fns[body] = functions(hz[body], sky)
        f = fns[body]
        kind = tr['kind']
        if kind not in ('set', 'rise'):
            out('  %s %s: start %s (%s), end %s (%s): not compared (kind %s)' % (body, kind, hms(tr['start']['timeMs'] / 1000), tr['start']['edge'], hms(tr['end']['timeMs'] / 1000), tr['end']['edge'], kind))
            continue
        a0, a1 = tr['start']['timeMs'] / 1000.0, tr['end']['timeMs'] / 1000.0
        lo, hi = max(t_lo + 1, a0 - 6 * 3600), min(t_hi - 1, a1 + 6 * 3600)
        if hi <= lo:
            out('  %s %s %s .. %s: outside the Horizons rows, not compared' % (body, kind, hms(a0), hms(a1)))
            continue
        step = 60.0 if body == 'sun' else 300.0
        cl = {k: sg.crossings(fn, lo, hi, step=step) for k, fn in f.items()}
        if kind == 'set':
            want = (('start', 'low', 'set', a0), ('end', 'high', 'set', a1))
            cdir = 'set'
        else:
            want = (('start', 'high', 'rise', a0), ('end', 'low', 'rise', a1))
            cdir = 'rise'
        item = {'body': body, 'kind': kind, 'hours': tr['hours'], 'instants': []}
        parts = []
        for name, fk, direction, ta in want:
            edge = tr[name]['edge']
            if edge == 'unresolved' or not (t_lo + 60 <= ta <= t_hi - 60):
                parts.append('%s %s: %s (not compared: %s)' % (name, edge, hms(ta), 'unresolved' if edge == 'unresolved' else 'beyond the Horizons rows'))
                continue
            tref = nearest(cl[fk], ta, direction)
            if tref is None or abs(tref - ta) > 6 * 3600:
                parts.append('%s %s: app %s, reference has no %s crossing nearby' % (name, edge, hms(ta), fk))
                item['instants'].append({'which': name, 'edge': edge, 'app': sg.to_iso(ta), 'reference': None})
                worst['deg'] = max(worst['deg'], 99.0)
                continue
            rt = rate(f[fk], tref)
            ddeg = abs(ta - tref) / 60.0 * rt
            worst['deg'] = max(worst['deg'], ddeg)
            item['instants'].append({'which': name, 'edge': edge, 'inWindow': tr[name]['inWindow'], 'app': sg.to_iso(ta), 'reference': sg.to_iso(tref), 'diffS': ta - tref, 'rateDegPerMin': rt, 'asSkylineDeg': ddeg})
            parts.append('%s (%s%s) app %s, ref %s, %+.0f s = %.4f deg' % (edge, name, '' if tr[name]['inWindow'] else ', beyond window', hms(ta), hms(tref)[6:], ta - tref, ddeg))
        for c in tr.get('centre', []):
            tc = c['timeMs'] / 1000.0
            if not (t_lo + 60 <= tc <= t_hi - 60):
                continue
            tref = nearest(cl['centre'], tc, 'set' if not c['up'] else 'rise')
            if tref is None:
                continue
            rt = rate(f['centre'], tref)
            ddeg = abs(tc - tref) / 60.0 * rt
            worst['deg'] = max(worst['deg'], ddeg)
            item['instants'].append({'which': 'centre', 'up': c['up'], 'app': sg.to_iso(tc), 'reference': sg.to_iso(tref), 'diffS': tc - tref, 'rateDegPerMin': rt, 'asSkylineDeg': ddeg})
            parts.append('centre %s app %s, ref %s, %+.0f s = %.4f deg' % ('rises' if c['up'] else 'sets', hms(tc), hms(tref)[6:], tc - tref, ddeg))
        case['transitions'].append(item)
        out('  %s %s, %.2f h: %s' % (body, kind, tr['hours'], '; '.join(parts)))
    # Earth by disc over the window.
    m = r['metrics']
    if m.get('earthAnyPct') is not None and not args.instants_only:
        fe = fns.get('earth') or functions(hz['earth'], sky)
        if w0 >= t_lo - 1e-6 and w1 <= t_hi + 1e-6:
            t = np.arange(w0, w1 - 0.1, 60.0)
            t = np.append(t, w1)
            g_any = fe['high'](t)
            g_c = fe['centre'](t)
            spans = []
            for a, b, oa, ob in sg.intervals(t, g_any):
                if not oa:
                    a = sg.refine(lambda x: float(fe['high'](np.array([x]))[0]), max(a - 60, w0), a + 60)
                if not ob:
                    b = sg.refine(lambda x: float(fe['high'](np.array([x]))[0]), b - 60, min(b + 60, w1))
                spans.append((max(a, w0), min(b, w1)))
            any_pct = 100.0 * sum(b - a for a, b in spans) / (w1 - w0)
            edges = [w0] + [x for ab in spans for x in ab] + [w1]
            gaps = [(edges[i], edges[i + 1]) for i in range(0, len(edges), 2) if edges[i + 1] - edges[i] > 1]
            gap_h = max([(b - a) / 3600.0 for a, b in gaps], default=0.0)
            centre_pct = 100.0 * float(np.mean(g_c > 0))
            d_any = m['earthAnyPct'] - any_pct
            worst['pct'] = max(worst['pct'], abs(d_any))
            case['earthByDisc'] = {'app': {'earthAnyPct': m['earthAnyPct'], 'longestEarthAnyGapH': m.get('longestEarthAnyGapH'), 'earthAnyGapOpenEnded': m.get('earthAnyGapOpenEnded'), 'earthVisiblePct': m['earthVisiblePct']},
                                   'reference': {'earthAnyPct': any_pct, 'longestEarthAnyGapH': gap_h, 'earthCentrePct': centre_pct}, 'anyMinusReference': d_any}
            out('  Earth, any part of the disc: app %.2f %%, reference %.2f %% (%+.2f); longest spell wholly hidden app %.2f h%s, reference %.2f h. Centre: app %.2f %%, reference %.2f %% (1 min samples)'
                % (m['earthAnyPct'], any_pct, d_any, m.get('longestEarthAnyGapH') or 0.0, ' (open-ended)' if m.get('earthAnyGapOpenEnded') else '', gap_h, m['earthVisiblePct'], centre_pct))
        else:
            out('  Earth, any part of the disc: app %.2f %% (window beyond the Horizons rows: not compared)' % m['earthAnyPct'])
    report['cases'][s['id']] = case
report['worst'] = worst
out('')
out('Worst over all compared instants: %.4f deg as a skyline error (tolerance %.2f); worst any-part Earth share: %.2f points (tolerance %.1f).' % (worst['deg'], TOL_DEG, worst['pct'], TOL_PCT))
text = '\n'.join(lines)
print(text)
if args.write:
    stem = 'results-%s%s' % (args.build, '-sky%g' % args.resample if args.resample else '')
    with open(os.path.join(DIR, stem + '.json'), 'w') as fh:
        json.dump(report, fh, indent=1)
        fh.write('\n')
    with open(os.path.join(DIR, stem + '.txt'), 'w') as fh:
        fh.write(text + '\n')
