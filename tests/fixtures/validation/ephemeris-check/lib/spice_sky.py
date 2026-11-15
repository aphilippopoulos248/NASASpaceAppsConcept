"""Sun and Earth in a lunar site's sky from NAIF SPICE (DE440, Moon ME frame, LT+S).

Same computation as tests/fixtures/horizons/ephemeris-check/spice_crosscheck.py, which
reproduces JPL Horizons' airless topocentric values to 0.000002 deg on 1008 rows. Needs
spiceypy and the five kernels in scripts/.cache/ephemeris-check/ (see README.md).
"""
import math
import os

import numpy as np

import common
from lunyx_dem import R_M, frame

KERNELS = ('naif0012.tls', 'pck00011.tpc', 'moon_pa_de440_200625.bpc', 'moon_de440_250416.tf', 'de440s.bsp')
RADIUS_KM = {'sun': 695700.0, 'earth': 6378.137}
_spice = None


def spice():
    global _spice
    if _spice is None:
        import spiceypy
        for k in KERNELS:
            spiceypy.furnsh(os.path.join(common.CACHE, 'kernels', k))
        _spice = spiceypy
    return _spice


def et_of(t_unix):
    """TDB seconds past J2000 for a UTC instant given as Unix seconds (leap seconds not counted, like a JavaScript Date)."""
    sp = spice()
    utc = float(t_unix) - 946728000.0
    if t_unix >= 63072000.0:  # 1972-01-01: the leap-second kernel applies
        return utc + sp.deltet(utc, 'UTC')
    # Before 1972 UTC ran at its own rate: TAI-UTC = 4.2131700 s + (MJD - 39126) * 0.002592 s (1968-02-01 .. 1972-01-01).
    mjd = t_unix / 86400.0 + 40587.0
    return sp.unitim(utc + 4.2131700 + (mjd - 39126.0) * 0.002592, 'TAI', 'TDB')


class Site:
    """Azimuth, elevation and angular radius of the Sun or Earth at a site, for arrays of Unix times."""

    def __init__(self, lat, lon, alt_m):
        self.east, self.north, self.up = frame(lat, lon)
        self.pos = list((R_M + alt_m) / 1000.0 * self.up)

    def body(self, name, t_unix):
        sp = spice()
        t = np.atleast_1d(np.asarray(t_unix, dtype=np.float64))
        out = np.empty((t.size, 3))
        for i, ti in enumerate(t):
            v = np.array(sp.spkcpo(name.upper(), et_of(ti), 'MOON_ME', 'OBSERVER', 'LT+S', self.pos, 'MOON', 'MOON_ME')[0][:3])
            d = math.sqrt(float(v @ v))
            out[i] = (math.degrees(math.atan2(v @ self.east, v @ self.north)) % 360.0, math.degrees(math.asin((v @ self.up) / d)), math.degrees(math.asin(RADIUS_KM[name] / d)))
        return out[:, 0], out[:, 1], out[:, 2]

    def series(self, t_unix, cache_key=None):
        """{'sun': (n, 3), 'earth': (n, 3)} of az, el, radius; kept in the git-ignored cache when cache_key is given."""
        path = os.path.join(common.CACHE, 'spice-series', cache_key + '.npz') if cache_key else None
        if path and os.path.exists(path):
            z = np.load(path)
            if z['sun'].shape[0] == len(t_unix):
                return {'sun': z['sun'], 'earth': z['earth']}
        out = {b: np.stack(self.body(b, t_unix), axis=-1) for b in ('sun', 'earth')}
        if path:
            os.makedirs(os.path.dirname(path), exist_ok=True)
            np.savez(path, **out)
        return out
