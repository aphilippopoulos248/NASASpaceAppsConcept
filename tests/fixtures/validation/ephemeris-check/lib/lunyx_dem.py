"""Independent reader for the elevation data Lunyx bundles.

Written from the file-format descriptions only (the LXG container comment in
src/terrain/lxg.ts, public/data/dem/index.json, public/terrain/index.json and the T-4
handover); it shares no code with src/terrain or src/analysis. Heights are metres above
the 1737.4 km sphere, Moon Mean Earth / polar axis frame, east-positive longitude.

Three layouts:
  equirect  whole-Moon grid, row 0 at the north edge, column 0 at 180 W, pixel centres
            half a pixel inside the bounds
  polar     LOLA polar stereographic (sphere, true scale at the pole), pole between the
            four middle pixels; south pole: x = r sin(lon) to the right, y = r cos(lon) up
  local     square site window, azimuthal equidistant about the site: column = metres
            east, row = metres north (row index increases northwards)
"""
import gzip
import json
import math
import os
import struct

import numpy as np

R_M = 1737400.0
D2R = math.pi / 180.0


def read_lxg(path):
    """Returns (header, [2-D arrays]) of an LXG file; int16 grids are returned as stored (apply scale/offset yourself)."""
    with open(path, 'rb') as fh:
        raw = fh.read()
    if raw[:2] == b'\x1f\x8b':
        raw = gzip.decompress(raw)
    if raw[:4] != b'LXG1':
        raise ValueError(path + ': not an LXG file')
    (hlen,) = struct.unpack('<I', raw[4:8])
    header = json.loads(raw[8:8 + hlen].decode('utf-8'))
    off = 8 + hlen
    arrays = []
    for g in header['grids']:
        w, h = g['width'], g['height']
        n = w * h
        if g['dtype'] == 'int16' and g['encoding'] == 'plane-delta':
            lo = np.frombuffer(raw, dtype=np.uint8, count=n, offset=off).astype(np.int64)
            hi = np.frombuffer(raw, dtype=np.uint8, count=n, offset=off + n).astype(np.int64)
            u = lo | (hi << 8)
            res = (u >> 1) ^ -(u & 1)  # zigzag
            # Each sample = residual + left + up - upper-left, i.e. the 2-D running sum of the
            # residuals, in 16-bit wrap-around arithmetic.
            v = np.cumsum(np.cumsum(res.reshape(h, w), axis=0), axis=1)
            arrays.append(((v + 32768) % 65536 - 32768).astype(np.int16))
            off += 2 * n
        elif g['encoding'] == 'raw':
            dt = np.dtype('<i2') if g['dtype'] == 'int16' else np.dtype('<f4')
            arrays.append(np.frombuffer(raw, dtype=dt, count=n, offset=off).reshape(h, w).copy())
            off += n * dt.itemsize
        else:
            raise ValueError('unsupported grid encoding')
    return header, arrays


def unit(lat, lon):
    la, lo = np.asarray(lat) * D2R, np.asarray(lon) * D2R
    return np.stack([np.cos(la) * np.cos(lo), np.cos(la) * np.sin(lo), np.sin(la)], axis=-1)


def frame(lat, lon):
    """East, north, up unit vectors at a point (at a pole 'north' follows the stated longitude)."""
    la, lo = lat * D2R, lon * D2R
    east = np.array([-math.sin(lo), math.cos(lo), 0.0])
    north = np.array([-math.sin(la) * math.cos(lo), -math.sin(la) * math.sin(lo), math.cos(la)])
    up = np.array([math.cos(la) * math.cos(lo), math.cos(la) * math.sin(lo), math.sin(la)])
    return east, north, up


def _bilinear(grid, fx, fy, wrap_x=False):
    """Bilinear sample of a 2-D array at fractional (column, row); NaN outside (unless wrap_x)."""
    h, w = grid.shape
    fx = np.asarray(fx, dtype=np.float64)
    fy = np.asarray(fy, dtype=np.float64)
    eps = 1e-9
    if wrap_x:
        ok = (fy >= -0.5 - eps) & (fy <= h - 0.5 + eps)
        fyc = np.clip(fy, 0, h - 1)
        y0 = np.clip(np.floor(fyc).astype(np.int64), 0, h - 2)
        x0 = np.floor(fx).astype(np.int64)
        a = fx - x0
        b = fyc - y0
        x0m = np.mod(x0, w)
        x1m = np.mod(x0 + 1, w)
    else:
        ok = (fx >= -eps) & (fy >= -eps) & (fx <= w - 1 + eps) & (fy <= h - 1 + eps)
        fxc = np.clip(fx, 0, w - 1)
        fyc = np.clip(fy, 0, h - 1)
        x0m = np.clip(np.floor(fxc).astype(np.int64), 0, w - 2)
        y0 = np.clip(np.floor(fyc).astype(np.int64), 0, h - 2)
        x1m = x0m + 1
        a = fxc - x0m
        b = fyc - y0
    v = (grid[y0, x0m] * (1 - a) * (1 - b) + grid[y0, x1m] * a * (1 - b)
         + grid[y0 + 1, x0m] * (1 - a) * b + grid[y0 + 1, x1m] * a * b)
    return np.where(ok, v, np.nan)


class Equirect:
    kind = 'equirect'

    def __init__(self, name, grid, ppd, scale=1.0, offset=0.0, resolution_m=None):
        self.name, self.grid, self.ppd, self.scale, self.offset = name, grid, ppd, scale, offset
        self.resolution_m = resolution_m if resolution_m else R_M * D2R / ppd

    def sample(self, lat, lon):
        fx = (np.mod(np.asarray(lon) + 180.0, 360.0)) * self.ppd - 0.5
        fy = (90.0 - np.asarray(lat)) * self.ppd - 0.5
        return _bilinear(self.grid, fx, fy, wrap_x=True) * self.scale + self.offset


class Polar:
    kind = 'polar'

    def __init__(self, name, grid, pole, metres_per_px, scale=1.0, offset=0.0):
        assert grid.shape[0] == grid.shape[1]
        self.name, self.grid, self.pole, self.mpp, self.scale, self.offset = name, grid, pole, metres_per_px, scale, offset
        self.resolution_m = metres_per_px
        self.half_width_m = (grid.shape[0] - 1) / 2 * metres_per_px

    def xy(self, lat, lon):
        lat, lon = np.asarray(lat, dtype=np.float64), np.asarray(lon, dtype=np.float64)
        colat = 90.0 + lat if self.pole == 'S' else 90.0 - lat
        r = 2 * R_M * np.tan(np.clip(colat, 0, 179.999) / 2 * D2R)
        x = r * np.sin(lon * D2R)
        y = r * np.cos(lon * D2R) * (1 if self.pole == 'S' else -1)
        return x, y, colat

    def sample(self, lat, lon):
        x, y, colat = self.xy(lat, lon)
        c = self.grid.shape[0] / 2 - 0.5
        v = _bilinear(self.grid, c + x / self.mpp, c - y / self.mpp)
        return np.where(colat < 90, v * self.scale + self.offset, np.nan)


class Local:
    kind = 'local'

    def __init__(self, name, grid, lat0, lon0, spacing_m, resolution_m=None):
        assert grid.shape[0] == grid.shape[1]
        self.name, self.grid, self.lat0, self.lon0, self.spacing = name, grid, lat0, lon0, spacing_m
        self.resolution_m = resolution_m if resolution_m else spacing_m
        self.half_width_m = (grid.shape[0] - 1) / 2 * spacing_m
        self.e, self.n, self.u = frame(lat0, lon0)

    def sample(self, lat, lon):
        q = unit(lat, lon)
        ce, cn, cu = q @ self.e, q @ self.n, q @ self.u
        t = np.hypot(ce, cn)
        ang = np.arctan2(t, cu)  # central angle from the window centre
        k = np.where(t > 1e-15, ang * R_M / np.where(t > 1e-15, t, 1.0), 0.0)
        c = (self.grid.shape[0] - 1) / 2
        return _bilinear(self.grid, c + ce * k / self.spacing, c + cn * k / self.spacing)


class Stack:
    """Layers ordered finest first; a point takes its height from the first layer that has data there."""

    def __init__(self, layers):
        self.layers = sorted(layers, key=lambda s: s.resolution_m)

    def sample(self, lat, lon, with_layer=False):
        lat = np.atleast_1d(np.asarray(lat, dtype=np.float64))
        lon = np.atleast_1d(np.asarray(lon, dtype=np.float64))
        h = np.full(lat.shape, np.nan)
        idx = np.full(lat.shape, -1, dtype=np.int64)
        for k, layer in enumerate(self.layers):
            need = np.isnan(h)
            if not need.any():
                break
            v = layer.sample(lat[need], lon[need])
            got = ~np.isnan(v)
            sub = np.flatnonzero(need)[got]
            h[sub] = v[got]
            idx[sub] = k
        return (h, idx) if with_layer else h


_cache = {}


def _lxg_layer(root, file):
    key = (root, file)
    if key not in _cache:
        header, arrays = read_lxg(os.path.join(root, 'public', 'data', 'dem', file))
        g = header['grids'][0]
        if g['kind'] == 'equirect':
            assert (g['latN'], g['latS'], g['lonW'], g['lonE']) == (90, -90, -180, 180)
            _cache[key] = Equirect(g['name'], arrays[0], g['pixelsPerDegree'], g['scale'], g['offset'], g['resolutionM'])
        else:
            _cache[key] = Polar(g['name'], arrays[0], g['pole'], g['metresPerPx'], g['scale'], g['offset'])
    return _cache[key]


def global_layer(root):
    return _lxg_layer(root, 'lola_global_16ppd.lxg')


def polar_layers(root):
    return [_lxg_layer(root, f) for f in ('lola_south_875s_40m.lxg', 'lola_south_85s_80m.lxg', 'lola_south_80s_160m.lxg')]


def site_windows(root, site_id):
    """The bundled windows of a catalogued landing site: NAC model (if any), 60 m and 480 m grids."""
    with open(os.path.join(root, 'public', 'terrain', 'index.json')) as fh:
        index = json.load(fh)
    if index['radius'] != 1737400:
        raise ValueError('site windows are not on the 1737.4 km sphere')
    entry = index['sites'][site_id]
    n = index['size']
    raw = np.fromfile(os.path.join(root, 'public', 'terrain', site_id + '.bin'), dtype='<f4')
    if raw.size != n * n * len(index['levels']):
        raise ValueError(site_id + '.bin: unexpected size')
    layers = []
    for k, level in enumerate(index['levels']):
        grid = raw[k * n * n:(k + 1) * n * n].reshape(n, n).astype(np.float64)
        layers.append(Local('%s, %d m site window' % (entry['source'], level['spacing']), grid, entry['lat'], entry['lon'], level['spacing']))
    fine = entry.get('fine')
    fine_path = os.path.join(root, 'public', 'terrain', site_id + '_fine.bin')
    if fine and os.path.exists(fine_path):
        m = fine['size']
        grid = np.fromfile(fine_path, dtype='<f4').reshape(m, m).astype(np.float64)
        layers.append(Local(fine['source'].split(',')[0] + ', %g m site window' % fine['spacing'], grid, entry['lat'], entry['lon'], fine['spacing']))
    return entry, layers


def stack_for(root, lat, lon, site_id=None):
    """Every bundled layer that can hold terrain visible from a point, finest first."""
    layers = [global_layer(root)]
    if lat < 0:
        layers += polar_layers(root)
    if site_id:
        layers += site_windows(root, site_id)[1]
    return Stack(layers)
