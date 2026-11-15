"""The skyline formed within the first metres, without a sampling step that can miss a crease.

Round 1's march (../ephemeris-check/lib/skyline.py) samples every 0.1 m near the observer. On a
bilinear grid the ground along a ray is smooth inside a cell and has a crease where the ray crosses
a grid line; when the skyline is formed by such a crease a few metres away, a 0.1 m step can miss
its top by several hundredths of a degree (seen at the fresh pins: 0.08 deg at 8.6 m, T-3).

Here the ray is sampled every `step` metres AND at every point where it crosses a grid line of the
layer that answers there (found between consecutive samples and placed by linear interpolation of
the grid coordinate, exact to ~1e-9 m over a 0.01 m step). Inside a cell the elevation angle is a
smooth function of distance, so the remaining error is second order in the step (< 1e-5 deg at
0.01 m). Same geometry as skyline.py: each point placed in 3-D from its own latitude, longitude and
height; elevation = angle between the observer-to-point vector and the observer's horizontal plane.
"""
import math

import numpy as np

import lunyx_dem as dem
from lunyx_dem import D2R, R_M, frame, unit


def grid_coords(layer, lat, lon):
    """Fractional (column, row) of points in a layer's own grid, as its sample() uses them."""
    lat, lon = np.asarray(lat, dtype=np.float64), np.asarray(lon, dtype=np.float64)
    if isinstance(layer, dem.Polar):
        x, y, _ = layer.xy(lat, lon)
        c = layer.grid.shape[0] / 2 - 0.5
        return c + x / layer.mpp, c - y / layer.mpp
    if isinstance(layer, dem.Local):
        q = unit(lat, lon)
        ce, cn, cu = q @ layer.e, q @ layer.n, q @ layer.u
        t = np.hypot(ce, cn)
        ang = np.arctan2(t, cu)
        k = np.where(t > 1e-15, ang * R_M / np.where(t > 1e-15, t, 1.0), 0.0)
        c = (layer.grid.shape[0] - 1) / 2
        return c + ce * k / layer.spacing, c + cn * k / layer.spacing
    if isinstance(layer, dem.Equirect):
        return np.mod(lon + 180.0, 360.0) * layer.ppd - 0.5, (90.0 - lat) * layer.ppd - 0.5
    raise TypeError(type(layer))


def near_skyline(stack, lat, lon, mast_m, az_deg, max_range=60.0, step=0.01, start=0.01):
    """Highest elevation angle (deg) of the ground within max_range metres, per azimuth, with its distance and height."""
    az = np.asarray(az_deg, dtype=np.float64)
    east, north, up = frame(lat, lon)
    ground = float(stack.sample(lat, lon)[0])
    p0 = (R_M + ground + mast_m) * up
    d = np.arange(start, max_range + 1e-9, step)
    out = {'elev_deg': np.full(az.size, -np.inf), 'dist_m': np.zeros(az.size), 'height_m': np.zeros(az.size), 'creases': np.zeros(az.size, dtype=np.int64)}
    for k, a_deg in enumerate(az):
        a = a_deg * D2R
        tang = math.cos(a) * north + math.sin(a) * east

        def points(dist):
            th = dist / R_M
            u = np.cos(th)[:, None] * up[None, :] + np.sin(th)[:, None] * tang[None, :]
            return np.degrees(np.arcsin(np.clip(u[:, 2], -1, 1))), np.degrees(np.arctan2(u[:, 1], u[:, 0]))

        plat, plon = points(d)
        h, idx = stack.sample(plat, plon, with_layer=True)
        extra = []
        for li in np.unique(idx[idx >= 0]):
            layer = stack.layers[int(li)]
            sel = np.flatnonzero(idx == li)
            gx, gy = grid_coords(layer, plat[sel], plon[sel])
            for g in (gx, gy):
                f0, f1 = np.floor(g[:-1]), np.floor(g[1:])
                j = np.flatnonzero((f0 != f1) & (np.diff(sel) == 1))
                for jj in j:
                    m = max(f0[jj], f1[jj])  # the grid line between the two samples
                    frac = (m - g[jj]) / (g[jj + 1] - g[jj])
                    extra.append(d[sel[jj]] + frac * (d[sel[jj + 1]] - d[sel[jj]]))
        if extra:
            de = np.array(extra)
            elat, elon = points(de)
            he = stack.sample(elat, elon)
            dd = np.concatenate([d, de])
            hh = np.concatenate([h, he])
            la = np.concatenate([plat, elat])
            lo = np.concatenate([plon, elon])
        else:
            dd, hh, la, lo = d, h, plat, plon
        v = (R_M + hh)[:, None] * unit(la, lo) - p0[None, :]
        el = np.degrees(np.arctan2(v @ up, np.hypot(v @ east, v @ north)))
        el = np.where(np.isnan(hh), -np.inf, el)
        i = int(np.argmax(el))
        out['elev_deg'][k], out['dist_m'][k], out['height_m'][k], out['creases'][k] = el[i], dd[i], hh[i], len(extra)
    out['ground_m'] = ground
    return out
