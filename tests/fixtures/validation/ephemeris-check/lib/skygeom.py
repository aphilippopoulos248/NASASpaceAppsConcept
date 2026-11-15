"""Sun and Earth against a skyline: this fixture's own visibility and event maths.

Inputs are an ephemeris series (JPL Horizons rows from horizons/*.json, or SPICE) and a
skyline from make_reference_skyline.py. Nothing here comes from src/analysis.
"""
import json
import math
from datetime import datetime, timezone

import numpy as np

D2R = math.pi / 180.0


def to_unix(iso):
    return datetime.strptime(iso, '%Y-%m-%dT%H:%M:%SZ').replace(tzinfo=timezone.utc).timestamp()


def to_iso(t, seconds=True):
    fmt = '%Y-%m-%dT%H:%M:%SZ' if seconds else '%Y-%m-%dT%H:%MZ'
    return datetime.fromtimestamp(round(float(t)), tz=timezone.utc).strftime(fmt)


def _enu(az, el):
    az, el = np.asarray(az) * D2R, np.asarray(el) * D2R
    return np.stack([np.cos(el) * np.sin(az), np.cos(el) * np.cos(az), np.sin(el)], axis=-1)


class Series:
    """Hourly (or any regular) az/el/angular-radius rows of one body, interpolated through unit vectors."""

    def __init__(self, t0, step_s, az, el, radius_deg):
        self.t0, self.step = float(t0), float(step_s)
        self.v = _enu(az, el)
        self.r = np.asarray(radius_deg, dtype=np.float64)
        self.n = self.r.size
        self.t1 = self.t0 + self.step * (self.n - 1)

    def at(self, t):
        x = (np.asarray(t, dtype=np.float64) - self.t0) / self.step
        if np.any(x < -1e-9) or np.any(x > self.n - 1 + 1e-9):
            raise ValueError('time outside the ephemeris series')
        i = np.clip(np.floor(x).astype(np.int64), 0, self.n - 2)
        f = (x - i)[..., None]
        v = self.v[i] * (1 - f) + self.v[i + 1] * f
        v /= np.linalg.norm(v, axis=-1, keepdims=True)
        az = np.mod(np.arctan2(v[..., 0], v[..., 1]) / D2R, 360.0)
        el = np.arcsin(np.clip(v[..., 2], -1, 1)) / D2R
        r = self.r[i] * (1 - f[..., 0]) + self.r[i + 1] * f[..., 0]
        return az, el, r


def load_horizons(path):
    """{'sun': Series, 'earth': Series, 'meta': {...}} from a horizons/<id>.json file."""
    with open(path) as fh:
        d = json.load(fh)
    t0, step = to_unix(d['start']), d['stepMinutes'] * 60.0
    out = {'meta': {k: d[k] for k in ('id', 'site', 'start', 'stop', 'stepMinutes', 'count')}}
    for body in ('sun', 'earth'):
        b = d[body]
        out[body] = Series(t0, step, b['az'], b['el'], np.asarray(b['angDiamArcsec']) / 7200.0)
    return out


class Skyline:
    def __init__(self, elev_deg, az_step_deg, extra=None):
        self.e = np.asarray(elev_deg, dtype=np.float64)
        self.step = float(az_step_deg)
        self.extra = extra or {}

    @classmethod
    def load(cls, path):
        with open(path) as fh:
            d = json.load(fh)
        return cls(d['elevDeg'], d['azStepDeg'], d)

    def at(self, az):
        x = np.mod(np.asarray(az, dtype=np.float64), 360.0) / self.step
        i = np.floor(x).astype(np.int64) % self.e.size
        f = x - np.floor(x)
        return self.e[i] * (1 - f) + self.e[(i + 1) % self.e.size] * f

    def resampled(self, step_deg):
        """The same skyline read only every step_deg (as a coarser profile would hold it)."""
        k = int(round(step_deg / self.step))
        return Skyline(self.e[::k], self.step * k, self.extra)


def disc(az, el, r, skyline, strips=61):
    """(fraction of the disc above the skyline, highest clearance of any limb point), for arrays of instants.

    The disc is cut into vertical strips of equal width; each strip is compared with the skyline
    at its own azimuth. The second value is > 0 exactly when some part of the disc shows.
    """
    az, el, r = (np.asarray(v, dtype=np.float64) for v in (az, el, r))
    k = (2 * np.arange(strips) + 1 - strips) / strips          # strip centres, -1..1 of the radius
    x = r[..., None] * k
    half = np.sqrt(np.maximum(r[..., None] ** 2 - x ** 2, 0.0))
    cosel = np.maximum(np.cos(el * D2R), 1e-6)[..., None]
    sky = skyline.at(az[..., None] + x / cosel)
    top = el[..., None] + half
    bottom = el[..., None] - half
    shown = np.clip(top - np.maximum(sky, bottom), 0.0, None)
    frac = shown.sum(axis=-1) / np.maximum((2 * half).sum(axis=-1), 1e-30)
    return frac, (top - sky).max(axis=-1)


def disc_edges(az, el, r, skyline, strips=61):
    """(lowest clearance of the disc's lower edge, highest clearance of its upper edge): the first is < 0 as soon as the skyline cuts the disc."""
    az, el, r = (np.asarray(v, dtype=np.float64) for v in (az, el, r))
    k = (2 * np.arange(strips) + 1 - strips) / strips
    x = r[..., None] * k
    half = np.sqrt(np.maximum(r[..., None] ** 2 - x ** 2, 0.0))
    cosel = np.maximum(np.cos(el * D2R), 1e-6)[..., None]
    sky = skyline.at(az[..., None] + x / cosel)
    return (el[..., None] - half - sky).min(axis=-1), (el[..., None] + half - sky).max(axis=-1)


class ArcSkyline:
    """A skyline known only over an azimuth range (used for extra observer heights around one event)."""

    def __init__(self, az0, step, elev_deg):
        self.az0, self.step, self.e = float(az0), float(step), np.asarray(elev_deg, dtype=np.float64)

    def at(self, az):
        x = (np.mod(np.asarray(az, dtype=np.float64) - self.az0, 360.0)) / self.step
        if np.any(x > self.e.size - 1):
            raise ValueError('azimuth outside the computed arc')
        i = np.clip(np.floor(x).astype(np.int64), 0, self.e.size - 2)
        f = x - i
        return self.e[i] * (1 - f) + self.e[i + 1] * f


def separation(az1, el1, az2, el2):
    """Angle between two sky directions, deg."""
    a, b = _enu(az1, el1), _enu(az2, el2)
    c = np.cross(a, b)
    return np.degrees(np.arctan2(np.linalg.norm(c, axis=-1), (a * b).sum(axis=-1)))


def centre_clearance(az, el, skyline):
    return np.asarray(el, dtype=np.float64) - skyline.at(az)


def intervals(t, g):
    """Spans where g > 0 on a sampled grid, edges placed by linear interpolation of g. Returns [(t_start, t_end, open_start, open_end)]."""
    up = g > 0
    out = []
    start, open_start = (t[0], True) if up[0] else (None, False)
    for i in range(1, t.size):
        if up[i] != up[i - 1]:
            tc = t[i - 1] + (t[i] - t[i - 1]) * (0 - g[i - 1]) / (g[i] - g[i - 1])
            if up[i]:
                start, open_start = tc, False
            else:
                out.append((start, tc, open_start, False))
                start = None
    if start is not None:
        out.append((start, t[-1], open_start, True))
    return out


def refine(fn, t_lo, t_hi, tol=1.0):
    """Root of fn between t_lo and t_hi (opposite signs) by bisection, to tol seconds."""
    f_lo = fn(t_lo)
    while t_hi - t_lo > tol:
        mid = 0.5 * (t_lo + t_hi)
        f_mid = fn(mid)
        if (f_mid > 0) == (f_lo > 0):
            t_lo, f_lo = mid, f_mid
        else:
            t_hi = mid
    return 0.5 * (t_lo + t_hi)


def crossings(fn, t_start, t_end, step=60.0, tol=1.0):
    """Every sign change of fn on [t_start, t_end]: [(time, 'rise'|'set')], found on a `step` grid then bisected."""
    t = np.arange(t_start, t_end + 0.5 * step, step)
    t = t[t <= t_end]
    g = fn(t)
    out = []
    for i in np.flatnonzero((g[1:] > 0) != (g[:-1] > 0)):
        tc = refine(lambda x: float(fn(np.array([x]))[0]), t[i], t[i + 1], tol)
        out.append((tc, 'rise' if g[i + 1] > 0 else 'set'))
    return out
