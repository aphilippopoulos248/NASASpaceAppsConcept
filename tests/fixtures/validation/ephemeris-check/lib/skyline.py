"""Independent terrain skyline: a fine ray march over lunyx_dem layers.

For every azimuth the great circle from the observer is sampled densely (0.1 m steps near
the site, 0.05 % of the distance far out, i.e. many samples per grid cell of every layer),
each sample is placed in 3-D at its own latitude, longitude and height, and its elevation
is the angle between the observer-to-sample vector and the observer's horizontal plane.
The skyline is the largest such angle. No formula is taken from src/analysis.
"""
import math

import numpy as np

from lunyx_dem import D2R, R_M, frame, unit

MAX_RANGE_M = 500e3


def march_distances(min_step=0.1, frac=5e-4, max_range=MAX_RANGE_M, start=0.1):
    d = [min(start, min_step)]
    while d[-1] < max_range:
        d.append(d[-1] + max(min_step, frac * d[-1]))
    return np.array(d)


def skyline(stack, lat, lon, mast_m, az_deg, min_step=0.1, frac=5e-4, max_range=MAX_RANGE_M, chunk=24):
    """Skyline seen from mast_m above the ground at (lat, lon).

    Returns a dict: ground_m (terrain height at the site), elev_deg, dist_m and height_m of the
    terrain that forms the skyline, and layer (index into stack.layers) for each azimuth.
    """
    az = np.asarray(az_deg, dtype=np.float64)
    east, north, up = frame(lat, lon)
    ground = float(stack.sample(lat, lon)[0])
    if not math.isfinite(ground):
        raise ValueError('no elevation data at the site')
    p0 = (R_M + ground + mast_m) * up
    d = march_distances(min_step, frac, max_range)
    theta = d / R_M
    cos_t, sin_t = np.cos(theta), np.sin(theta)
    out = {k: np.empty(az.size) for k in ('elev_deg', 'dist_m', 'height_m')}
    out['layer'] = np.empty(az.size, dtype=np.int64)
    out['az_check_deg'] = np.empty(az.size)
    for s in range(0, az.size, chunk):
        a = az[s:s + chunk] * D2R
        tang = np.cos(a)[:, None] * north[None, :] + np.sin(a)[:, None] * east[None, :]  # (c, 3)
        # Points on the sphere along each ray: u = up cos(theta) + tangent sin(theta).
        u = cos_t[None, :, None] * up[None, None, :] + sin_t[None, :, None] * tang[:, None, :]  # (c, n, 3)
        plat = np.arcsin(np.clip(u[..., 2], -1, 1)) / D2R
        plon = np.arctan2(u[..., 1], u[..., 0]) / D2R
        h, idx = stack.sample(plat.ravel(), plon.ravel(), with_layer=True)
        h = h.reshape(plat.shape)
        idx = idx.reshape(plat.shape)
        # Rebuild each sample's position from its latitude and longitude (not from u), so the
        # elevation depends only on where the height was actually read.
        v = (R_M + h)[..., None] * unit(plat, plon) - p0[None, None, :]
        vu = v @ up
        ve = v @ east
        vn = v @ north
        el = np.arctan2(vu, np.hypot(ve, vn)) / D2R
        el = np.where(np.isnan(h), -np.inf, el)
        k = np.argmax(el, axis=1)
        rows = np.arange(k.size)
        out['elev_deg'][s:s + chunk] = el[rows, k]
        out['dist_m'][s:s + chunk] = d[k]
        out['height_m'][s:s + chunk] = h[rows, k]
        out['layer'][s:s + chunk] = idx[rows, k]
        out['az_check_deg'][s:s + chunk] = np.mod(np.arctan2(ve[rows, k], vn[rows, k]) / D2R, 360.0)
    out['ground_m'] = ground
    out['samples_per_ray'] = int(d.size)
    return out


def skyline_at(profile_elev_deg, az_step_deg, az_deg):
    """Linear interpolation of a regularly sampled skyline at any azimuth."""
    e = np.asarray(profile_elev_deg, dtype=np.float64)
    x = np.mod(np.asarray(az_deg, dtype=np.float64), 360.0) / az_step_deg
    i = np.floor(x).astype(np.int64) % e.size
    f = x - np.floor(x)
    return e[i] * (1 - f) + e[(i + 1) % e.size] * f
