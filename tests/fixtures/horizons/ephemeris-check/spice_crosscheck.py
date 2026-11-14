#!/usr/bin/env python3
"""Second opinion on the Horizons sky fixture: recompute every row with NAIF SPICE.

Horizons is a web service; this recomputes the same quantities offline from the JPL
kernels (DE440 planetary ephemeris, DE440 lunar orientation, Moon ME frame) with
`spkcpo` and this file's own east/north/up projection, and reports the worst
differences. Agreement at the 1e-4 deg level shows that the fixture values mean what
README.md says they mean: site on the 1737.4 km sphere (+ altitude) in the Moon ME
frame, apparent place (light-time + stellar aberration), azimuth clockwise from
north, elevation above the local horizontal.

It needs spiceypy and five public kernels (about 46 MB), none of which are committed:

    mkdir -p scripts/.cache/ephemeris-check/kernels && cd scripts/.cache/ephemeris-check
    python3 -m pip install --target ./pylib spiceypy
    B=https://naif.jpl.nasa.gov/pub/naif/generic_kernels
    for f in lsk/naif0012.tls pck/pck00011.tpc pck/moon_pa_de440_200625.bpc \\
             fk/satellites/moon_de440_250416.tf spk/planets/de440s.bsp; do
      curl -sO --output-dir kernels "$B/$f"; done

Run from the repository root:

    python3 -I tests/fixtures/horizons/ephemeris-check/spice_crosscheck.py \\
        [--pylib scripts/.cache/ephemeris-check/pylib] \\
        [--kernels scripts/.cache/ephemeris-check/kernels] [--write]

--write stores the summary in spice-crosscheck.json next to this file.
--sensitivity also prints how far each of several plausible modelling mistakes moves
the answer over the fixture's rows (this is where the tolerance in index.json comes from).
"""
import argparse
import hashlib
import json
import math
import os
import sys

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.normpath(os.path.join(HERE, '..', '..', '..', '..'))
CACHE = os.path.join(ROOT, 'scripts', '.cache', 'ephemeris-check')

ap = argparse.ArgumentParser()
ap.add_argument('--pylib', default=os.path.join(CACHE, 'pylib'))
ap.add_argument('--kernels', default=os.path.join(CACHE, 'kernels'))
ap.add_argument('--write', action='store_true')
ap.add_argument('--sensitivity', action='store_true')
args = ap.parse_args()
if os.path.isdir(args.pylib):
    sys.path.insert(0, args.pylib)
import spiceypy as spice  # noqa: E402

KERNELS = ['naif0012.tls', 'pck00011.tpc', 'moon_pa_de440_200625.bpc', 'moon_de440_250416.tf', 'de440s.bsp']
kernel_hashes = {}
for name in KERNELS:
    path = os.path.join(args.kernels, name)
    with open(path, 'rb') as fh:
        kernel_hashes[name] = hashlib.sha256(fh.read()).hexdigest()
    spice.furnsh(path)

R_MOON = 1737.4
D2R = math.pi / 180.0


def utc_to_et(utc):
    """TDB seconds past J2000 for a UTC instant.

    SPICE's leap-second kernel starts in 1972 and assumes TAI-UTC = 9 s before that.
    Horizons uses the real pre-1972 UTC, which ran at a slightly different rate
    (1968-02-01 to 1972-01-01: TAI-UTC = 4.2131700 s + (MJD - 39126) * 0.002592 s).
    """
    if utc >= '1972-01-01':
        return spice.str2et(utc.replace('Z', ''))
    if utc < '1968-02-01':
        raise ValueError('no TAI-UTC rule coded before 1968-02-01: ' + utc)
    y, mo, d = int(utc[0:4]), int(utc[5:7]), int(utc[8:10])
    h, mi, s = int(utc[11:13]), int(utc[14:16]), float(utc[17:].rstrip('Z') or 0)
    a = (14 - mo) // 12
    yy, mm = y + 4800 - a, mo + 12 * a - 3
    jdn = d + (153 * mm + 2) // 5 + 365 * yy + yy // 4 - yy // 100 + yy // 400 - 32045
    jd_utc = jdn - 0.5 + (h * 3600 + mi * 60 + s) / 86400.0
    dat = 4.2131700 + (jd_utc - 2400000.5 - 39126.0) * 0.002592
    tai = (jd_utc - 2451545.0) * 86400.0 + dat
    return spice.unitim(tai, 'TAI', 'TDB')


def site_vector(lat, lon, alt_km):
    r = R_MOON + alt_km
    return [r * math.cos(lat * D2R) * math.cos(lon * D2R), r * math.cos(lat * D2R) * math.sin(lon * D2R), r * math.sin(lat * D2R)]


def az_el(lat, lon, v):
    la, lo = lat * D2R, lon * D2R
    east = (-math.sin(lo), math.cos(lo), 0.0)
    north = (-math.sin(la) * math.cos(lo), -math.sin(la) * math.sin(lo), math.cos(la))
    up = (math.cos(la) * math.cos(lo), math.cos(la) * math.sin(lo), math.sin(la))
    n = math.sqrt(sum(c * c for c in v))
    u = [c / n for c in v]
    dot = lambda a, b: sum(x * y for x, y in zip(a, b))
    return math.degrees(math.atan2(dot(u, east), dot(u, north))) % 360.0, math.degrees(math.asin(max(-1.0, min(1.0, dot(u, up)))))


def wrap180(x):
    return (x + 180.0) % 360.0 - 180.0


def arc(a, b):
    """Great-circle distance between two (lat, lon) points, deg."""
    va = (math.cos(a[0] * D2R) * math.cos(a[1] * D2R), math.cos(a[0] * D2R) * math.sin(a[1] * D2R), math.sin(a[0] * D2R))
    vb = (math.cos(b[0] * D2R) * math.cos(b[1] * D2R), math.cos(b[0] * D2R) * math.sin(b[1] * D2R), math.sin(b[0] * D2R))
    return math.degrees(math.acos(max(-1.0, min(1.0, sum(x * y for x, y in zip(va, vb))))))


def sub_point(method, et, abcorr):
    """(lat, lon) of the Moon's sub-Earth ('subpnt') or sub-solar ('subslr') point seen from Earth's centre."""
    fn = spice.subpnt if method == 'subpnt' else spice.subslr
    spoint, _, _ = fn('NEAR POINT/ELLIPSOID', 'MOON', et, 'MOON_ME', abcorr, 'EARTH')
    _, lon, lat = spice.reclat(spoint)
    return math.degrees(lat), math.degrees(lon)


with open(os.path.join(HERE, 'index.json')) as fh:
    index = json.load(fh)

big = lambda a, b: b if abs(b) > abs(a) else a
total = dict(rows=0, sunEl=0.0, sunAz=0.0, earthEl=0.0, earthAz=0.0, sunRange=0.0, earthRange=0.0)
per_set = {}
sub = {'subEarth': {'LT': 0.0, 'LT+S': 0.0, 'NONE': 0.0}, 'subSolar': {'LT': 0.0, 'LT+S': 0.0, 'NONE': 0.0}}
print('SPICE (DE440, MOON_ME, LT+S) minus Horizons: worst |difference| per set')
print('  set                                 rows    sun el    sun az*   earth el  earth az*   sun km  earth km   (deg; az* = azimuth arc)')
for entry in index['sets']:
    with open(os.path.join(HERE, entry['file'])) as fh:
        doc = json.load(fh)
    site = doc['site']
    pos = site_vector(site['lat'], site['lon'], site['altKm'])
    st = dict(rows=0, sunEl=0.0, sunAz=0.0, earthEl=0.0, earthAz=0.0, sunRange=0.0, earthRange=0.0)
    for row in doc['rows']:
        et = utc_to_et(row['utc'])
        for body, target in (('sun', 'SUN'), ('earth', 'EARTH')):
            state, lt = spice.spkcpo(target, et, 'MOON_ME', 'OBSERVER', 'LT+S', pos, 'MOON', 'MOON_ME')
            az, el = az_el(site['lat'], site['lon'], state[:3])
            ref = row[body]
            st[body + 'El'] = big(st[body + 'El'], el - ref['el'])
            st[body + 'Az'] = big(st[body + 'Az'], wrap180(az - ref['az']) * math.cos(ref['el'] * D2R))
            st[body + 'Range'] = big(st[body + 'Range'], lt * spice.clight() - ref['rangeKm'])
        for key, method in (('subEarth', 'subpnt'), ('subSolar', 'subslr')):
            ref = (row[key]['lat'], row[key]['lon'])
            for abcorr in sub[key]:
                sub[key][abcorr] = max(sub[key][abcorr], arc(sub_point(method, et, abcorr), ref))
        st['rows'] += 1
    per_set[doc['id']] = st
    total['rows'] += st['rows']
    for k in ('sunEl', 'sunAz', 'earthEl', 'earthAz', 'sunRange', 'earthRange'):
        total[k] = big(total[k], st[k])
    print('  %-35s %4d  %.6f  %.6f  %.6f  %.6f  %7.3f  %7.3f' % (doc['id'], st['rows'], abs(st['sunEl']), abs(st['sunAz']), abs(st['earthEl']), abs(st['earthAz']), abs(st['sunRange']), abs(st['earthRange'])))
print('  %-35s %4d  %.6f  %.6f  %.6f  %.6f  %7.3f  %7.3f' % ('ALL', total['rows'], abs(total['sunEl']), abs(total['sunAz']), abs(total['earthEl']), abs(total['earthAz']), abs(total['sunRange']), abs(total['earthRange'])))

print('\nWhich aberration correction reproduces Horizons\' sub-points (worst great-circle distance, deg):')
for key in ('subEarth', 'subSolar'):
    print('  %-9s' % key + '   '.join('%s %.6f' % (ab, sub[key][ab]) for ab in ('NONE', 'LT', 'LT+S')))

summary = {
    'what': 'SPICE recomputation of every fixture row minus the Horizons value; worst signed difference.',
    'method': "spkcpo(target, et, 'MOON_ME', 'OBSERVER', 'LT+S', site, 'MOON', 'MOON_ME'), site on the 1737.4 km sphere + altKm; az/el by east/north/up projection; range = light-time * c.",
    'spiceToolkit': spice.tkvrsn('TOOLKIT'),
    'kernels': kernel_hashes,
    'rows': total['rows'],
    'worst': {
        'sunElDeg': total['sunEl'], 'sunAzArcDeg': total['sunAz'], 'earthElDeg': total['earthEl'], 'earthAzArcDeg': total['earthAz'],
        'sunRangeKm': total['sunRange'], 'earthRangeKm': total['earthRange'],
    },
    'subPointArcDegByCorrection': sub,
    'perSet': {k: {'rows': v['rows'], 'sunElDeg': v['sunEl'], 'sunAzArcDeg': v['sunAz'], 'earthElDeg': v['earthEl'], 'earthAzArcDeg': v['earthAz']} for k, v in per_set.items()},
}
if args.sensitivity:
    # Each variant changes one thing in the exact computation; the number is the worst angular
    # distance from the Horizons value over all rows (sun / earth).
    variants = [
        ('exact (as above)', {}),
        ('no stellar aberration or light-time (geometric)', {'abcorr': 'NONE'}),
        ('light-time only, no stellar aberration', {'abcorr': 'LT'}),
        ('UTC used as if it were TDB (TT-UTC ignored)', {'utc_as_tdb': True}),
        ('principal-axis frame MOON_PA instead of MOON_ME', {'frame': 'MOON_PA'}),
        ('IAU_MOON rotation model instead of MOON_ME', {'frame': 'IAU_MOON'}),
        ('altitude ignored (site on the sphere)', {'no_alt': True}),
        ('direction from the Moon\'s centre (no parallax)', {'centre': True}),
    ]
    sens = {}
    print('\nSensitivity: worst angular distance from Horizons over all rows, deg')
    print('  %-52s %10s %10s' % ('variant', 'sun', 'earth'))
    for label, v in variants:
        worst_v = {'sun': 0.0, 'earth': 0.0}
        frame, abcorr = v.get('frame', 'MOON_ME'), v.get('abcorr', 'LT+S')
        for entry in index['sets']:
            with open(os.path.join(HERE, entry['file'])) as fh:
                doc = json.load(fh)
            site = doc['site']
            pos = site_vector(site['lat'], site['lon'], 0.0 if v.get('no_alt') else site['altKm'])
            for row in doc['rows']:
                et = utc_to_et(row['utc'])
                if v.get('utc_as_tdb'):
                    et = et - spice.deltet(et, 'ET')  # TDB - UTC: 40 s in 1969, 69 s now
                for body, target in (('sun', 'SUN'), ('earth', 'EARTH')):
                    if v.get('centre'):
                        state, _ = spice.spkezr(target, et, frame, abcorr, 'MOON')
                    else:
                        state, _ = spice.spkcpo(target, et, frame, 'OBSERVER', abcorr, pos, 'MOON', frame)
                    az, el = az_el(site['lat'], site['lon'], state[:3])
                    ref = row[body]
                    a = (math.cos(el * D2R) * math.sin(az * D2R), math.cos(el * D2R) * math.cos(az * D2R), math.sin(el * D2R))
                    b = (math.cos(ref['el'] * D2R) * math.sin(ref['az'] * D2R), math.cos(ref['el'] * D2R) * math.cos(ref['az'] * D2R), math.sin(ref['el'] * D2R))
                    cross = (a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0])
                    sep = math.degrees(math.atan2(math.sqrt(sum(c * c for c in cross)), sum(x * y for x, y in zip(a, b))))
                    worst_v[body] = max(worst_v[body], sep)
        sens[label] = worst_v
        print('  %-52s %10.6f %10.6f' % (label, worst_v['sun'], worst_v['earth']))
    summary['sensitivityArcDeg'] = sens

if args.write:
    with open(os.path.join(HERE, 'spice-crosscheck.json'), 'w') as fh:
        json.dump(summary, fh, indent=1)
        fh.write('\n')
    print('\nwrote spice-crosscheck.json')
worst = max(abs(total[k]) for k in ('sunEl', 'sunAz', 'earthEl', 'earthAz'))
print('\n%s: worst angular difference %.6f deg (limit 0.001)' % ('PASS' if worst <= 0.001 else 'FAIL', worst))
sys.exit(0 if worst <= 0.001 else 1)
