#!/usr/bin/env python3
"""Check 2: real events. Published mission facts, an independent computation, and the app.

Independent computation: Sun and Earth from JPL Horizons (hourly rows in horizons/, read
through unit-vector interpolation) against this fixture's own skyline (reference/).
Under test: analyse() events and series (events/app-*.json) and skyAt() (events/alsj-app-*.json).
Published statements with their wording and precision: events/sources.json.

    python3 -I tests/fixtures/validation/ephemeris-check/check2_events.py [--write]

Nothing is tuned to agree: the three columns are simply put side by side.
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
import skyline as sk  # noqa: E402
import skygeom as sg  # noqa: E402

ap = argparse.ArgumentParser()
ap.add_argument('--write', action='store_true')
args = ap.parse_args()
DIR = os.path.join(common.BASE, 'events')
hm = lambda t: sg.to_iso(t)[5:16].replace('T', ' ')
hms = lambda t: sg.to_iso(t)[5:19].replace('T', ' ')
lines = []
out = lines.append
report = {}


def load_apps(prefix):
    apps = {}
    for name in ('before', 'now'):
        p = os.path.join(DIR, '%s-%s.json' % (prefix, name))
        if os.path.exists(p):
            with open(p) as fh:
                apps[name] = json.load(fh)
    return apps


apps = load_apps('app')
by_id = {name: {r['id']: r for r in d['results']} for name, d in apps.items()}
commit = {name: d['app']['commit'] for name, d in apps.items()}


def sun_events(series, skyline, t0, t1):
    """Rise/set of the Sun's last limb, first cut by the skyline and half-covered instants."""
    def limbs(t):
        az, el, r = series.at(t)
        return sg.disc_edges(az, el, r, skyline)
    upper = lambda t: limbs(t)[1]
    lower = lambda t: limbs(t)[0]
    half = lambda t: sg.disc(*series.at(t), skyline)[0] - 0.5
    return {'limb': sg.crossings(upper, t0, t1), 'cut': sg.crossings(lower, t0, t1), 'half': sg.crossings(half, t0, t1)}


def app_series_times(r):
    """First sample where the app's visible fraction drops below 1, below 0.5 and to 0 (1-minute series)."""
    s = r['series']
    t = s['startMs'] / 1000.0 + np.arange(s['n']) * s['stepMs'] / 1000.0
    v = np.array(s['sunVisible'], dtype=np.float64)
    def first(cond):
        i = np.flatnonzero(cond)
        return float(t[i[0]]) if i.size else None
    return first(v < 0.9995), first(v < 0.5), first(v <= 0)


# ------------------------------------------------------------------ A. Blue Ghost sunset
out('A. Blue Ghost Mission 1, sunset of 16 March 2025 (site 18.562 N 61.81 E)')
out('   Published (Firefly press release): "346 hours of daylight", "operating just over 5 hours into the lunar night with the final')
out('   data received around 6:15 pm CDT on March 16". Read as: night began around 18:15-18:35 UTC, to a few tens of minutes;')
out('   the release does not say whether "sunset" is first contact, last limb or loss of power.')
hz = sg.load_horizons(os.path.join(common.BASE, 'horizons', 'blue-ghost-1.2025-03.json'))
t0, t1 = sg.to_unix('2025-03-16T16:00:00Z'), sg.to_unix('2025-03-17T00:00:00Z')
site = {'lat': 18.562, 'lon': 61.81}
stack = dem.stack_for(common.ROOT, site['lat'], site['lon'], 'blue-ghost-1')
smooth = sg.Skyline(np.zeros(8), 45.0)
ev = sun_events(hz['sun'], smooth, t0, t1)
out('   Smooth sphere, no terrain (Horizons only): first contact with the horizontal %s, half %s, last limb %s UTC' % (hm(ev['cut'][0][0]), hm(ev['half'][0][0]), hm(ev['limb'][0][0])))
out('')
out('   eye height | independent (Horizons + own skyline)            | app %s                     | app %s' % (commit.get('before', '-'), commit.get('now', '-')))
out('              | skyline cuts   half hidden   last limb           | cuts     half     last limb | cuts     half     last limb')
report['blueGhostSunset'] = {'published': 'night began around 18:15-18:35 UTC', 'rows': []}
arc_az = np.arange(255.0, 285.0001, 0.05)
for mast, sid in ((0.5, 'blue-ghost-1.sunset-1min.mast0.5'), (2.0, 'blue-ghost-1.sunset-1min'), (5.0, 'blue-ghost-1.sunset-1min.mast5')):
    arc = sk.skyline(stack, site['lat'], site['lon'], mast, arc_az)
    sky = sg.ArcSkyline(arc_az[0], 0.05, arc['elev_deg'])
    ev = sun_events(hz['sun'], sky, t0, t1)
    ref = (ev['cut'][0][0], ev['half'][0][0], ev['limb'][0][0])
    az_set = float(hz['sun'].at(np.array([ref[2]]))[0][0])
    j = int(round((az_set - arc_az[0]) / 0.05))
    row = {'mastM': mast, 'reference': {'cut': sg.to_iso(ref[0]), 'half': sg.to_iso(ref[1]), 'lastLimb': sg.to_iso(ref[2]), 'sunAzAtLastLimb': az_set,
                                        'skylineThereDeg': float(arc['elev_deg'][j]), 'formedAtM': float(arc['dist_m'][j]), 'heightM': float(arc['height_m'][j]), 'groundM': arc['ground_m']}, 'apps': {}}
    cols = []
    for name in ('before', 'now'):
        r = by_id.get(name, {}).get(sid)
        if not r:
            cols.append('-')
            continue
        cut, half, gone = app_series_times(r)
        sunset = [e['timeMs'] / 1000.0 for e in r['events'] if e['type'] == 'sunset']
        last = sunset[0] if sunset else gone
        row['apps'][name] = {'cut': sg.to_iso(cut), 'half': sg.to_iso(half), 'lastLimb': sg.to_iso(last), 'lastLimbMinusReferenceMin': (last - ref[2]) / 60.0}
        cols.append('%s  %s  %s (%+.1f min)' % (hm(cut)[6:], hm(half)[6:], hms(last)[6:], (last - ref[2]) / 60.0))
    out('   %5.1f m    | %s  %s  %s (%s)    | %s | %s' % (mast, hm(ref[0])[6:], hm(ref[1])[6:], hms(ref[2])[6:], '16 Mar', cols[0], cols[1]))
    report['blueGhostSunset']['rows'].append(row)
    if mast == 2.0:
        out('              the skyline at the setting Sun (azimuth %.1f) is %.3f deg, formed by ground %.0f m away at %.1f m (site %.1f m)' % (az_set, arc['elev_deg'][j], arc['dist_m'][j], arc['height_m'][j], arc['ground_m']))
out('   The app\'s series is sampled every minute, so its "cuts" and "half" columns are whole minutes.')

# ------------------------------------------------------------------ B. eclipses
def contacts(hzs, t0, t1):
    def gap(sign):
        def fn(t):
            a1, e1, r1 = hzs['sun'].at(t)
            a2, e2, r2 = hzs['earth'].at(t)
            return sg.separation(a1, e1, a2, e2) - (r2 + sign * r1)
        return fn
    outer = sg.crossings(gap(+1), t0, t1)
    inner = sg.crossings(gap(-1), t0, t1)
    c = {}
    c['C1'] = next((t for t, k in outer if k == 'set'), None)
    c['C4'] = next((t for t, k in outer if k == 'rise'), None)
    c['C2'] = next((t for t, k in inner if k == 'set'), None)
    c['C3'] = next((t for t, k in inner if k == 'rise'), None)
    return c


def app_eclipse(r):
    s = r['series']
    t = s['startMs'] / 1000.0 + np.arange(s['n']) * s['stepMs'] / 1000.0
    e = np.array(s['sunEclipsed'], dtype=np.float64)
    part = np.flatnonzero(e > 0)
    total = np.flatnonzero(e >= 1)
    return (float(t[part[0]]), float(t[total[0]]), float(t[total[-1]]), float(t[part[-1]])) if part.size and total.size else None


out('')
out('B. The 14 March 2025 eclipse seen from the Blue Ghost site (Earth in front of the Sun)')
c = contacts(hz, sg.to_unix('2025-03-14T03:00:00Z'), sg.to_unix('2025-03-14T12:00:00Z'))
out('   Published (KUT, citing Firefly; times read as CDT = UTC-5): eclipse "starting at 12 a.m." = 05:00, "ending around 4:52 a.m." = 09:52;')
out('   "Totality lasted just over 2 hours, beginning at 1:18 a.m." = 06:18; image "around 3:30 a.m." = 08:30 "as the sun prepared to emerge from totality".')
out('   Independent (Horizons, geometric discs): Earth\'s limb first touches the Sun %s, Sun wholly covered %s .. %s (%.0f min), last contact %s UTC'
    % (hms(c['C1'])[6:], hms(c['C2'])[6:], hms(c['C3'])[6:], (c['C3'] - c['C2']) / 60, hms(c['C4'])[6:]))
report['blueGhostEclipse'] = {'published': {'start': '05:00', 'totalityStart': '06:18', 'sunAboutToEmerge': '08:30', 'end': '09:52', 'assumedZone': 'CDT (UTC-5)'},
                              'reference': {k: sg.to_iso(v) for k, v in c.items()}, 'apps': {}}
for name in ('before', 'now'):
    r = by_id.get(name, {}).get('blue-ghost-1.eclipse-1min')
    if r:
        a = app_eclipse(r)
        dark = r['metrics']['darkIntervals'][0]
        out('   App %s: first sample with the Sun partly covered %s, wholly covered %s .. %s (dark interval %s .. %s), last partly covered sample %s'
            % (commit[name], hm(a[0])[6:], hm(a[1])[6:], hm(a[2])[6:], hms(dark['startMs'] / 1000)[6:], hms(dark['endMs'] / 1000)[6:], hm(a[3])[6:]))
        report['blueGhostEclipse']['apps'][name] = {'firstPartialSample': sg.to_iso(a[0]), 'darkStart': sg.to_iso(dark['startMs'] / 1000), 'darkEnd': sg.to_iso(dark['endMs'] / 1000), 'lastPartialSample': sg.to_iso(a[3]),
                                                    'darkStartMinusReferenceS': dark['startMs'] / 1000 - c['C2'], 'darkEndMinusReferenceS': dark['endMs'] / 1000 - c['C3']}
out('   Published minus independent: start %+.1f min, totality start %+.1f min, end %+.1f min; the "around 3:30" image is %.0f min before the Sun re-emerges.'
    % ((sg.to_unix('2025-03-14T05:00:00Z') - c['C1']) / 60, (sg.to_unix('2025-03-14T06:18:00Z') - c['C2']) / 60, (sg.to_unix('2025-03-14T09:52:00Z') - c['C4']) / 60, (c['C3'] - sg.to_unix('2025-03-14T08:30:00Z')) / 60))
out('   Earth\'s atmosphere is ignored on all sides here: discs are geometric (Horizons uses Earth\'s equatorial radius).')

# ------------------------------------------------------------------ C. Chandrayaan-3
out('')
out('C. Chandrayaan-3 (69.3741 S 32.32 E): end of the lunar day and the next sunrise, September 2023')
hz3 = sg.load_horizons(os.path.join(common.BASE, 'horizons', 'chandrayaan-3.2023-08-09.json'))
sky3 = sg.Skyline.load(os.path.join(common.BASE, 'reference', 'skyline.chandrayaan-3.m2.json'))
ev3 = sun_events(hz3['sun'], sky3, sg.to_unix('2023-08-23T12:33:00Z'), sg.to_unix('2023-09-25T12:00:00Z'))
sunset3 = next(t for t, k in ev3['limb'] if k == 'set')
sunrise3 = next(t for t, k in ev3['limb'] if k == 'rise')
cut3 = next(t for t, k in ev3['cut'] if k == 'set')
full3 = next(t for t, k in ev3['cut'] if k == 'rise' and t > sunrise3)
out('   Published: "the Sun would set at Shivshakti point on September 4" (Interesting Engineering); ISRO, 2 Sept: "the next sunrise expected on')
out('   September 22, 2023"; ISRO page, 4 Sept: "Awaiting their awakening around September 22, 2023". Dates only.')
out('   Independent (2 m): skyline starts to cut the Sun %s, last limb gone %s; first limb back %s, whole disc clear %s UTC' % (hm(cut3), hms(sunset3), hms(sunrise3), hm(full3)))
report['chandrayaan3'] = {'published': {'sunset': '2023-09-04', 'nextSunrise': '2023-09-22'}, 'reference': {'cut': sg.to_iso(cut3), 'sunset': sg.to_iso(sunset3), 'sunrise': sg.to_iso(sunrise3), 'wholeDiscClear': sg.to_iso(full3)}, 'apps': {}}
for name in ('before', 'now'):
    r = by_id.get(name, {}).get('chandrayaan-3.surface')
    if r:
        e = {x['type']: x['timeMs'] / 1000.0 for x in r['events']}
        out('   App %s: sunset %s (%+.1f min), sunrise %s (%+.1f min)' % (commit[name], hms(e['sunset']), (e['sunset'] - sunset3) / 60, hms(e['sunrise']), (e['sunrise'] - sunrise3) / 60))
        report['chandrayaan3']['apps'][name] = {'sunset': sg.to_iso(e['sunset']), 'sunrise': sg.to_iso(e['sunrise']), 'sunsetMinusReferenceMin': (e['sunset'] - sunset3) / 60, 'sunriseMinusReferenceMin': (e['sunrise'] - sunrise3) / 60}
for stamp in ('2023-09-21T18:30:00Z', '2023-09-22T18:30:00Z'):
    az, el, _ = hz3['sun'].at(np.array([sg.to_unix(stamp)]))
    out('   Sun at %s (= %s 00:00 IST): %.1f deg above the horizontal, %.1f deg above the skyline' % (stamp[:16], '22 Sept' if stamp.startswith('2023-09-21') else '23 Sept', el[0], el[0] - sky3.at(az)[0]))
out('   So the sunset date agrees (4 Sept, both UTC and IST). The first sunlight computed here falls at %s UTC = %s IST, two days' % (hm(sunrise3), hm(sunrise3 + 19800)))
out('   before the date ISRO gave for "the next sunrise"; through 22 Sept IST the Sun climbs from about 8 to 12 deg. ISRO\'s date may mean usable power rather than first light: not resolved here.')
r3 = report['chandrayaan3']

# ------------------------------------------------------------------ D. Apollo 15
out('')
out('D. Apollo 15 (26.13239 N 3.6333 E): no published sunset time was found; independent recomputation only')
hz15 = sg.load_horizons(os.path.join(common.BASE, 'horizons', 'apollo-15.1971-07-08.json'))
sky15 = sg.Skyline.load(os.path.join(common.BASE, 'reference', 'skyline.apollo-15.m2.json'))
ev15 = sun_events(hz15['sun'], sky15, sg.to_unix('1971-07-30T22:16:00Z'), sg.to_unix('1971-08-14T11:00:00Z'))
sunset15 = next(t for t, k in ev15['limb'] if k == 'set')
c15 = contacts(hz15, sg.to_unix('1971-08-06T15:00:00Z'), sg.to_unix('1971-08-07T00:00:00Z'))
out('   Independent (2 m): last limb gone %s UTC; eclipse of 6 August 1971 at the site: %s, total %s .. %s, ends %s' % (hms(sunset15), hms(c15['C1'])[6:], hms(c15['C2'])[6:], hms(c15['C3'])[6:], hms(c15['C4'])[6:]))
report['apollo15'] = {'reference': {'sunset': sg.to_iso(sunset15), 'eclipse': {k: sg.to_iso(v) for k, v in c15.items()}}, 'apps': {}}
for name in ('before', 'now'):
    r = by_id.get(name, {}).get('apollo-15.surface')
    if r:
        e = {x['type']: x['timeMs'] / 1000.0 for x in r['events']}
        dark = r['metrics']['darkIntervals'][0]
        out('   App %s: sunset %s (%+.1f min); Sun wholly covered %s .. %s (%+.0f s, %+.0f s)'
            % (commit[name], hms(e['sunset']), (e['sunset'] - sunset15) / 60, hms(dark['startMs'] / 1000)[6:], hms(dark['endMs'] / 1000)[6:], dark['startMs'] / 1000 - c15['C2'], dark['endMs'] / 1000 - c15['C3']))
        report['apollo15']['apps'][name] = {'sunset': sg.to_iso(e['sunset']), 'sunsetMinusReferenceMin': (e['sunset'] - sunset15) / 60, 'darkStart': sg.to_iso(dark['startMs'] / 1000), 'darkEnd': sg.to_iso(dark['endMs'] / 1000)}

# ------------------------------------------------------------------ F. the two bundled windows, as the browser runs them
out('')
out('F. The two flagship windows with the app reading its bundled Horizons tables (as in the browser; sections A-D ran its model)')
bundled = {}
for name in ('before', 'now'):
    p = os.path.join(DIR, 'app-%s-bundled.json' % name)
    if os.path.exists(p):
        with open(p) as fh:
            bundled[name] = json.load(fh)
hz2 = sg.load_horizons(os.path.join(common.BASE, 'horizons', 'im-2.2025-03-04.json'))
sky_im2 = sg.Skyline.load(os.path.join(common.BASE, 'reference', 'skyline.im-2.m2.json'))
w0, w1 = sg.to_unix('2025-03-06T17:28:00Z'), sg.to_unix('2025-03-20T17:28:00Z')
ev_im2 = sun_events(hz2['sun'], sky_im2, w0, w1)
im2_sunset = next(t for t, k in ev_im2['limb'] if k == 'set')
im2_earthset = next(t for t, k in sg.crossings(lambda t: sg.centre_clearance(*hz2['earth'].at(t)[:2], sky_im2), w0, w1) if k == 'set')
c_im2 = contacts(hz2, sg.to_unix('2025-03-14T03:00:00Z'), sg.to_unix('2025-03-14T12:00:00Z'))
bg_ref = report['blueGhostSunset']['rows'][1]['reference']['lastLimb']
out('   Independent: Blue Ghost last limb %s, Sun wholly covered %s .. %s; IM-2 Sun wholly covered %s .. %s, Earthset %s, sunset %s'
    % (bg_ref[11:19], hms(c['C2'])[6:], hms(c['C3'])[6:], hms(c_im2['C2'])[6:], hms(c_im2['C3'])[6:], hms(im2_earthset), hms(im2_sunset)))
report['bundledWindows'] = {'reference': {'im2Sunset': sg.to_iso(im2_sunset), 'im2Earthset': sg.to_iso(im2_earthset), 'im2Eclipse': {k: sg.to_iso(v) for k, v in c_im2.items()}}, 'apps': {}}
for name, d in bundled.items():
    rb = {r['id']: r for r in d['results']}
    bg = rb['blue-ghost-1.sunset-1min']
    ecl = rb['blue-ghost-1.eclipse-1min']['metrics']['darkIntervals'][0]
    im = rb['im-2.surface']
    e = {x['type']: x['timeMs'] / 1000.0 for x in im['events']}
    dk = im['metrics']['darkIntervals'][0]
    bg_set = next(x['timeMs'] / 1000.0 for x in bg['events'] if x['type'] == 'sunset')
    out('   App %s (%s): Blue Ghost last limb %s (%+.0f s), covered %s .. %s (%+.0f s, %+.0f s); IM-2 covered %s .. %s (%+.0f s, %+.0f s), Earthset %s (%+.1f min), sunset %s (%+.1f min)'
        % (d['app']['commit'], im['series']['source'], hms(bg_set)[6:], bg_set - sg.to_unix(bg_ref), hms(ecl['startMs'] / 1000)[6:], hms(ecl['endMs'] / 1000)[6:], ecl['startMs'] / 1000 - c['C2'], ecl['endMs'] / 1000 - c['C3'],
           hms(dk['startMs'] / 1000)[6:], hms(dk['endMs'] / 1000)[6:], dk['startMs'] / 1000 - c_im2['C2'], dk['endMs'] / 1000 - c_im2['C3'], hms(e['earthset']), (e['earthset'] - im2_earthset) / 60, hms(e['sunset']), (e['sunset'] - im2_sunset) / 60))
    report['bundledWindows']['apps'][name] = {'commit': d['app']['commit'], 'source': im['series']['source'], 'blueGhostSunsetMinusReferenceS': bg_set - sg.to_unix(bg_ref),
                                              'im2EarthsetMinusReferenceMin': (e['earthset'] - im2_earthset) / 60, 'im2SunsetMinusReferenceMin': (e['sunset'] - im2_sunset) / 60,
                                              'im2Metrics': {k: im['metrics'][k] for k in ('illuminationPct', 'sunAnyPct', 'earthVisiblePct')}}
out('   At IM-2 Earth sinks by about 0.05 deg per hour and the Sun by less, so one minute there is under 0.001 deg.')

# ------------------------------------------------------------------ E. ALSJ table
out('')
out('E. Apollo 11-17: Sun and Earth altitude/azimuth at 43 documented instants (Apollo Lunar Surface Journal table by J. Scotti, values to 0.01 deg)')
with open(os.path.join(DIR, 'alsj_rows.json')) as fh:
    rows = json.load(fh)
alsj = load_apps('alsj-app')
spice = None
try:
    import spiceypy as spice_mod
    kdir = os.path.join(common.CACHE, 'kernels')
    for k in ('naif0012.tls', 'pck00011.tpc', 'moon_pa_de440_200625.bpc', 'moon_de440_250416.tf', 'de440s.bsp'):
        spice_mod.furnsh(os.path.join(kdir, k))
    spice = spice_mod
except Exception as e:  # SPICE is optional: without it the third opinion is simply left out
    out('   (SPICE not available here: %s)' % e)


def spice_altaz(lat, lon, utc, centre):
    if utc >= '1972-01-01':
        et = spice.str2et(utc.replace('Z', ''))
    else:  # real pre-1972 UTC, as in tests/fixtures/horizons/ephemeris-check/spice_crosscheck.py
        y, mo, d, h, mi, s = int(utc[0:4]), int(utc[5:7]), int(utc[8:10]), int(utc[11:13]), int(utc[14:16]), int(utc[17:19])
        a = (14 - mo) // 12
        yy, mm = y + 4800 - a, mo + 12 * a - 3
        jd = d + (153 * mm + 2) // 5 + 365 * yy + yy // 4 - yy // 100 + yy // 400 - 32045 - 0.5 + (h * 3600 + mi * 60 + s) / 86400.0
        et = spice.unitim((jd - 2451545.0) * 86400.0 + 4.2131700 + (jd - 2400000.5 - 39126.0) * 0.002592, 'TAI', 'TDB')
    east, north, up = dem.frame(lat, lon)
    res = {}
    for body in ('SUN', 'EARTH'):
        if centre:
            v = spice.spkezr(body, et, 'MOON_ME', 'LT+S', 'MOON')[0][:3]
        else:
            v = spice.spkcpo(body, et, 'MOON_ME', 'OBSERVER', 'LT+S', list(1737.4 * up), 'MOON', 'MOON_ME')[0][:3]
        v = np.array(v)
        res[body.lower()] = (math.degrees(math.atan2(v @ east, v @ north)) % 360.0, math.degrees(math.asin((v @ up) / np.linalg.norm(v))))
    return res


def stats(pairs):
    """Worst |altitude difference| and |azimuth arc difference| over (got, published) pairs of (az, alt)."""
    d_alt = max(abs(g[1] - p[1]) for g, p in pairs)
    d_az = max(abs(((g[0] - p[0] + 180) % 360 - 180) * math.cos(math.radians(p[1]))) for g, p in pairs)
    return d_alt, d_az


pub_sun = [(r['published']['sunAz'], r['published']['sunAlt']) for r in rows]
pub_earth = [(r['published']['earthAz'], r['published']['earthAlt']) for r in rows]
report['alsj'] = {'rows': len(rows), 'apps': {}}
out('   worst difference over the 43 instants, deg (altitude / azimuth arc):')
for name, d in alsj.items():
    got_sun = [(x['sun']['az'], x['sun']['el']) for x in d['rows']]
    got_earth = [(x['earth']['az'], x['earth']['el']) for x in d['rows']]
    s, e = stats(list(zip(got_sun, pub_sun))), stats(list(zip(got_earth, pub_earth)))
    out('     app %s skyAt minus published:            Sun %.3f / %.3f   Earth %.3f / %.3f' % (d['app']['commit'], s[0], s[1], e[0], e[1]))
    report['alsj']['apps'][name] = {'commit': d['app']['commit'], 'sunAltDeg': s[0], 'sunAzArcDeg': s[1], 'earthAltDeg': e[0], 'earthAzArcDeg': e[1]}
    if spice:
        topo = [spice_altaz(r['lat'], r['lon'], r['utc'], False) for r in rows]
        s2 = stats([(g, t['sun']) for g, t in zip(got_sun, topo)])
        e2 = stats([(g, t['earth']) for g, t in zip(got_earth, topo)])
        out('     app %s skyAt minus SPICE at the site:     Sun %.4f / %.4f Earth %.4f / %.4f' % (d['app']['commit'], s2[0], s2[1], e2[0], e2[1]))
        report['alsj']['apps'][name].update({'vsSpiceSunAltDeg': s2[0], 'vsSpiceSunAzArcDeg': s2[1], 'vsSpiceEarthAltDeg': e2[0], 'vsSpiceEarthAzArcDeg': e2[1]})
if spice:
    topo = [spice_altaz(r['lat'], r['lon'], r['utc'], False) for r in rows]
    cen = [spice_altaz(r['lat'], r['lon'], r['utc'], True) for r in rows]
    s3 = stats([(t['sun'], p) for t, p in zip(topo, pub_sun)])
    e3 = stats([(t['earth'], p) for t, p in zip(topo, pub_earth)])
    s4 = stats([(t['sun'], p) for t, p in zip(cen, pub_sun)])
    e4 = stats([(t['earth'], p) for t, p in zip(cen, pub_earth)])
    out('     SPICE at the site minus published:               Sun %.3f / %.3f   Earth %.3f / %.3f' % (s3[0], s3[1], e3[0], e3[1]))
    out('     SPICE from the Moon\'s centre minus published:    Sun %.3f / %.3f   Earth %.3f / %.3f   (the table\'s own method)' % (s4[0], s4[1], e4[0], e4[1]))
    report['alsj']['spiceSiteMinusPublished'] = {'sunAltDeg': s3[0], 'sunAzArcDeg': s3[1], 'earthAltDeg': e3[0], 'earthAzArcDeg': e3[1]}
    report['alsj']['spiceCentreMinusPublished'] = {'sunAltDeg': s4[0], 'sunAzArcDeg': s4[1], 'earthAltDeg': e4[0], 'earthAzArcDeg': e4[1]}
out('   The table is built from sub-Earth and sub-solar points, i.e. from the Moon\'s centre, so its Earth altitudes lack the site parallax.')

text = '\n'.join(lines)
print(text)
if args.write:
    with open(os.path.join(DIR, 'results.json'), 'w') as fh:
        json.dump(report, fh, indent=1)
        fh.write('\n')
    with open(os.path.join(DIR, 'results.txt'), 'w') as fh:
        fh.write(text + '\n')
