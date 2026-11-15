#!/usr/bin/env python3
"""Independent check of the edge easing in src/terrain/api.ts (T-32, verified in Lunyx Science T-1).

Reads the bundled site grids in public/terrain with its own few lines of numpy and works in
the grids' own east/north metres (the 3 m model, the 60 m window and the 480 m window of a
site share one centre and one layout, so a node of one is a plain fractional index in the
other). It shares no code with src/terrain, src/analysis or src/scene.

    python3 -I scripts/terrain-seams-check.py seams [--json OUT.json]
        For the 19 sites with a 3 m model: the mismatch along the model's edge as stored,
        and after easing with this file's own implementation of the rule.

    python3 -I scripts/terrain-seams-check.py points --site apollo-17 --out IN.json
        Writes test points for `node scripts/terrain-seams.mjs --heights IN.json --out APP.json`.

    python3 -I scripts/terrain-seams-check.py compare --in IN.json --app APP.json
        Compares the heights the app returned at those points with this file's own: the stack in
        use (the stored grids, D-10) with the files, and the eased stack (easeEdges: true) with the
        rule as implemented here.

    python3 -I scripts/terrain-seams-check.py skyline [--sites a,b] [--az 1440] [--mast 2] [--json OUT.json]
        Skyline of an observer `mast` metres up, from the stored grids and from the eased
        ones, by a dense ray march of this file's own (0.1 m steps to 200 m, then 0.05 % of
        the distance, to 500 km). Layers beyond the site windows (whole-Moon grid) come from
        the independent reader in tests/fixtures/validation/ephemeris-check/lib.

    python3 -I scripts/terrain-seams-check.py lola [--sites a,b] [--fetch] [--json OUT.json]
        Both grids against LRO LOLA laser altimetry (RDR shots, the absolute reference both
        products were tied to), around each site with a 3 m model: inside the model, in its
        eased band, and just outside its edge, as stored, as eased, and with the other choice
        of reference (the 60 m window eased onto the model outside its edge). Shots come from
        the ODE Granular Data System (oderest.rsl.wustl.edu, query=lolardr) and are kept in
        scripts/.cache/terrain-lola/<site>/pts.csv; --fetch downloads the missing ones.

The rule under test (docs/lunyx/handover/T-32-edge-easing.md): in the 513 x 513 model at 3 m,
every node nearer than 43 samples to the edge of the square moves to
    h + (h60 - h) * t * t * (3 - 2 t),   t = 1 - fromEdge / 43,
h60 being the 60 m window read bilinearly at the node. Nothing else changes.
"""
import argparse
import json
import math
import os
import sys

ROOT = os.path.normpath(os.path.join(os.path.dirname(os.path.abspath(__file__)), '..'))
try:
    import numpy as np
except ModuleNotFoundError:
    # `python3 -I` leaves out the user's own packages: look where the validation scripts keep numpy, then there.
    import site

    sys.path[:0] = [p for p in (os.path.join(ROOT, 'scripts', '.cache', 'ephemeris-check', 'pylib'), site.getusersitepackages()) if os.path.isdir(p)]
    import numpy as np

TERRAIN = os.path.join(ROOT, 'public', 'terrain')
R_M = 1737400.0
D2R = math.pi / 180.0

with open(os.path.join(TERRAIN, 'index.json')) as fh:
    INDEX = json.load(fh)
SITES_WITH_MODEL = [sid for sid, e in INDEX['sites'].items() if 'fine' in e]


class Grid:
    """Square grid centred on the site: node (i, j) lies (i - c) * spacing east, (j - c) * spacing north."""

    def __init__(self, data, spacing):
        assert data.ndim == 2 and data.shape[0] == data.shape[1]
        self.data = data
        self.n = data.shape[0]
        self.spacing = float(spacing)
        self.c = (self.n - 1) / 2
        self.half = self.c * self.spacing

    def at(self, east, north):
        """Bilinear height at east/north metres; NaN outside the square."""
        east = np.asarray(east, dtype=np.float64)
        north = np.asarray(north, dtype=np.float64)
        fx = east / self.spacing + self.c
        fy = north / self.spacing + self.c
        eps = 1e-9 * self.n
        ok = (fx >= -eps) & (fy >= -eps) & (fx <= self.n - 1 + eps) & (fy <= self.n - 1 + eps)
        fx = np.clip(fx, 0, self.n - 1)
        fy = np.clip(fy, 0, self.n - 1)
        x = np.minimum(np.floor(fx).astype(np.int64), self.n - 2)
        y = np.minimum(np.floor(fy).astype(np.int64), self.n - 2)
        a = fx - x
        b = fy - y
        d = self.data
        v = (1 - b) * ((1 - a) * d[y, x] + a * d[y, x + 1]) + b * ((1 - a) * d[y + 1, x] + a * d[y + 1, x + 1])
        return np.where(ok, v, np.nan)


def load_site(sid):
    """(entry, 3 m model, 60 m window, 480 m window) of a site, float64 copies of the files."""
    entry = INDEX['sites'][sid]
    n = INDEX['size']
    spacings = [level['spacing'] for level in INDEX['levels']]
    assert spacings == [60, 480], spacings
    raw = np.fromfile(os.path.join(TERRAIN, sid + '.bin'), dtype='<f4')
    assert raw.size == n * n * 2, sid
    w60 = Grid(raw[: n * n].reshape(n, n).astype(np.float64), 60)
    w480 = Grid(raw[n * n:].reshape(n, n).astype(np.float64), 480)
    f = entry['fine']
    fine = Grid(np.fromfile(os.path.join(TERRAIN, sid + '_fine.bin'), dtype='<f4').reshape(f['size'], f['size']).astype(np.float64), f['spacing'])
    return entry, fine, w60, w480


def js_round(x):
    """Math.round: halves go up."""
    return int(math.floor(x + 0.5))


def ease(fine, outer):
    """This file's own implementation of the rule. Returns the eased copy, as float32 like the app's grid."""
    n = fine.n
    band = max(10, js_round(n / 12))
    idx = np.arange(n)
    edge = np.minimum(idx, n - 1 - idx)
    from_edge = np.minimum(edge[:, None], edge[None, :])
    t = np.clip(1 - from_edge / band, 0, 1)
    w = t * t * (3 - 2 * t)
    east = (idx - fine.c) * fine.spacing
    e, nn = np.meshgrid(east, east)  # [j, i]: east varies along a row, north down the rows
    h_outer = outer.at(e, nn)
    eased = fine.data + (h_outer - fine.data) * w
    return Grid(eased.astype(np.float32).astype(np.float64), fine.spacing), band, w


def ring(fine, scale=1.0):
    """The 4 x (n - 1) points along the edge of the model, optionally pulled in by a factor."""
    t = (np.arange(fine.n - 1) - fine.c) * fine.spacing
    half = np.full_like(t, fine.half)
    east = np.concatenate([t, half, -t, -half]) * scale
    north = np.concatenate([-half, t, half, -t]) * scale
    return east, north


def tenth(v):
    return js_round(v * 10) / 10 + 0.0


def seam_stats(inner, outer, scale):
    e, n = ring(inner, scale)
    d = outer.at(e, n) - inner.at(e, n)
    return {'minM': float(d.min()), 'maxM': float(d.max()), 'rmsM': float(math.sqrt(np.mean(d * d))), 'points': int(d.size)}


def cmd_seams(args):
    rows = {}
    print("3 m model against the 60 m window along the model's edge (60 m window minus model), metres.")
    print('%-14s %26s   %32s   %s' % ('site', 'as stored: low  high   RMS', 'eased here: low    high     RMS', 'nodes moved / largest move / worst edge node'))
    for sid in SITES_WITH_MODEL:
        entry, fine, w60, _ = load_site(sid)
        assert fine.n == 513 and fine.spacing == 3 and fine.half == 768
        eased, band, w = ease(fine, w60)
        assert band == 43
        # As the app measures it: both grids at the same point, a hair (0.01 %) inside the edge.
        stored = seam_stats(fine, w60, 0.9999)
        after = seam_stats(eased, w60, 0.9999)
        # And at the edge nodes themselves.
        e, n = ring(fine)
        node_stored = w60.at(e, n) - fine.at(e, n)
        node_after = w60.at(e, n) - eased.at(e, n)
        moved = eased.data - fine.data
        inside = w == 0
        assert np.all(moved[inside] == 0), sid  # nothing changes outside the band
        row = {
            'stored': {k: tenth(stored[k]) for k in ('minM', 'maxM', 'rmsM')},
            'storedExact': stored,
            'storedAtNodes': {'minM': float(node_stored.min()), 'maxM': float(node_stored.max()), 'rmsM': float(math.sqrt(np.mean(node_stored ** 2)))},
            'eased': {k: tenth(after[k]) for k in ('minM', 'maxM', 'rmsM')},
            'easedExact': after,
            'worstEdgeNodeM': float(np.abs(node_after).max()),
            'nodesMoved': int(np.count_nonzero(moved)),
            'nodesInBand': int(np.count_nonzero(~inside)),
            'largestMoveM': float(np.abs(moved).max()),
            'rmsMoveInBandM': float(math.sqrt(np.mean(moved[~inside] ** 2))),
            'overM': band * fine.spacing,
        }
        rows[sid] = row
        s, a = row['stored'], row['easedExact']
        print('%-14s %+9.1f %+6.1f %5.1f   %+11.4f %+8.4f %8.4f   %d of %d / %.2f m / %.3f mm' % (sid, s['minM'], s['maxM'], s['rmsM'], a['minM'], a['maxM'], a['rmsM'], row['nodesMoved'], row['nodesInBand'], row['largestMoveM'], row['worstEdgeNodeM'] * 1000))
    if args.json:
        with open(args.json, 'w') as fh:
            json.dump(rows, fh, indent=1)
            fh.write('\n')
    return rows


def offset_latlon(lat0, lon0, east, north):
    """The point reached by going east/north metres over the sphere (azimuthal equidistant about the site)."""
    la, lo = lat0 * D2R, lon0 * D2R
    e = np.array([-math.sin(lo), math.cos(lo), 0.0])
    n = np.array([-math.sin(la) * math.cos(lo), -math.sin(la) * math.sin(lo), math.cos(la)])
    u = np.array([math.cos(la) * math.cos(lo), math.cos(la) * math.sin(lo), math.sin(la)])
    east = np.asarray(east, dtype=np.float64)
    north = np.asarray(north, dtype=np.float64)
    dist = np.hypot(east, north)
    d = dist / R_M
    safe = np.maximum(dist, 1e-12)
    v = np.cos(d)[..., None] * u + np.sin(d)[..., None] * ((east / safe)[..., None] * e + (north / safe)[..., None] * n)
    return np.degrees(np.arcsin(np.clip(v[..., 2], -1, 1))), np.degrees(np.arctan2(v[..., 1], v[..., 0]))


def test_points(fine, seed):
    """East/north metres: rows and columns of nodes across the band, the edge ring, corners, random points inside and outside the model."""
    rng = np.random.default_rng(seed)
    t = (np.arange(fine.n) - fine.c) * fine.spacing
    pts = []
    for k in (0, 1, 7, 21, 22, 42, 43, 44, 100, 256, 400, 470, 491, 505, 511, 512):
        pts.append(np.stack([t, np.full_like(t, t[k])], axis=1))  # a row of nodes
        pts.append(np.stack([np.full_like(t, t[k]), t], axis=1))  # a column of nodes
    e, n = ring(fine)
    pts.append(np.stack([e, n], axis=1))
    pts.append(rng.uniform(-fine.half, fine.half, size=(4000, 2)))  # anywhere in the model, between nodes
    band = rng.uniform(-fine.half, fine.half, size=(6000, 2))
    side = rng.integers(0, 4, size=6000)
    depth = rng.uniform(0, 129, size=6000)
    band[side == 0, 0] = fine.half - depth[side == 0]
    band[side == 1, 0] = -fine.half + depth[side == 1]
    band[side == 2, 1] = fine.half - depth[side == 2]
    band[side == 3, 1] = -fine.half + depth[side == 3]
    pts.append(band)  # inside the eased band
    pts.append(rng.uniform(-3800, 3800, size=(3000, 2)))  # mostly outside the model: the 60 m window
    return np.concatenate(pts)


def cmd_points(args):
    entry, fine, _, _ = load_site(args.site)
    en = test_points(fine, args.seed)
    lat, lon = offset_latlon(entry['lat'], entry['lon'], en[:, 0], en[:, 1])
    with open(args.out, 'w') as fh:
        json.dump({'site': args.site, 'points': [[float(a), float(b)] for a, b in zip(lat, lon)], 'eastNorthM': en.tolist()}, fh)
    print('%d points at %s -> %s' % (len(en), args.site, args.out))


def cmd_compare(args):
    with open(args.inp) as fh:
        inp = json.load(fh)
    with open(args.app) as fh:
        app = json.load(fh)
    sid = inp['site']
    entry, fine, w60, _ = load_site(sid)
    eased, _, _ = ease(fine, w60)
    en = np.array(inp['eastNorthM'])
    e, n = en[:, 0], en[:, 1]
    in_model = (np.abs(e) <= fine.half) & (np.abs(n) <= fine.half)
    mine_stored = np.where(in_model, fine.at(e, n), w60.at(e, n))
    mine_eased = np.where(in_model, eased.at(e, n), w60.at(e, n))
    app_in_use = np.array([h['inUse'] for h in app['heights']], dtype=np.float64)
    app_stored = np.array([h['stored'] for h in app['heights']], dtype=np.float64)
    # Since D-10 the stack in use is the stored one, and the eased stack is asked for (easeEdges: true).
    app_eased = np.array([h.get('eased', h['inUse']) for h in app['heights']], dtype=np.float64)
    from_edge = fine.half - np.maximum(np.abs(e), np.abs(n))
    # A point within a micrometre of the model's edge can fall on either side of it after the round trip through latitude and longitude.
    sure = np.abs(from_edge) > 1e-3
    band = in_model & (from_edge < 129) & sure
    core = in_model & (from_edge >= 129)
    out = {
        'site': sid, 'points': int(en.shape[0]), 'inBand': int(band.sum()), 'inCore': int(core.sum()), 'outsideModel': int((~in_model).sum()),
        'storedWorstM': float(np.abs(app_stored - mine_stored)[sure].max()),
        'inUseWorstM': float(np.abs(app_in_use - mine_stored)[sure].max()),
        'easedWorstM': float(np.abs(app_eased - mine_eased)[sure].max()),
        'easedWorstInBandM': float(np.abs(app_eased - mine_eased)[band].max()),
        'coreMovedByAppM': float(np.abs(app_eased - app_stored)[core].max()),
        'outsideMovedByAppM': float(np.abs(app_eased - app_stored)[~in_model & sure].max()),
        'bandLargestMoveByAppM': float(np.abs(app_eased - app_stored)[band].max()),
    }
    print(json.dumps(out))
    return out


# ---------------------------------------------------------------- skyline

def march_distances(start, stop, min_step=0.1, frac=5e-4):
    d = [start]
    while d[-1] < stop:
        d.append(d[-1] + max(min_step, frac * d[-1]))
    return np.array(d)


def cmd_skyline(args):
    sys.path.insert(0, os.path.join(ROOT, 'tests', 'fixtures', 'validation', 'ephemeris-check', 'lib'))
    import lunyx_dem as dem  # the independent reader of the bundled grids (T-26)

    sites = args.sites.split(',') if args.sites else SITES_WITH_MODEL
    n_az = args.az
    az = np.arange(n_az) * (360.0 / n_az)
    split = 1100.0  # the model's corners are 1086 m out: beyond this nothing differs between the two stacks
    d_near = march_distances(0.1, split)
    d_far = march_distances(d_near[-1] + max(0.1, 5e-4 * d_near[-1]), 500e3)
    results = {}
    for sid in sites:
        entry, fine, w60, w480 = load_site(sid)
        eased, _, _ = ease(fine, w60)
        lat0, lon0 = entry['lat'], entry['lon']
        glob = dem.global_layer(ROOT)
        ground = float(fine.at(0.0, 0.0))
        r0 = R_M + ground + args.mast

        def elevation(h, d):
            # A point at ground distance d (central angle d / R) and height h, seen from the observer.
            th = d / R_M
            return np.degrees(np.arctan2((R_M + h) * np.cos(th) - r0, (R_M + h) * np.sin(th)))

        def near(model):
            best = np.full(n_az, -np.inf)
            where = np.zeros(n_az)
            for s in range(0, n_az, 96):
                a = az[s:s + 96] * D2R
                e = np.sin(a)[:, None] * d_near[None, :]
                n = np.cos(a)[:, None] * d_near[None, :]
                h = model.at(e, n)
                h = np.where(np.isnan(h), w60.at(e, n), h)
                el = elevation(h, d_near[None, :])
                k = np.argmax(el, axis=1)
                rows = np.arange(k.size)
                best[s:s + 96] = el[rows, k]
                where[s:s + 96] = d_near[k]
            return best, where

        def far():
            best = np.full(n_az, -np.inf)
            where = np.zeros(n_az)
            for s in range(0, n_az, 48):
                a = az[s:s + 48] * D2R
                e = np.sin(a)[:, None] * d_far[None, :]
                n = np.cos(a)[:, None] * d_far[None, :]
                h = w60.at(e, n)
                miss = np.isnan(h)
                h[miss] = w480.at(e[miss], n[miss])
                miss = np.isnan(h)
                if miss.any():
                    la, lo = offset_latlon(lat0, lon0, e[miss], n[miss])
                    h[miss] = glob.sample(la, lo)
                el = elevation(h, d_far[None, :])
                k = np.argmax(el, axis=1)
                rows = np.arange(k.size)
                best[s:s + 48] = el[rows, k]
                where[s:s + 48] = d_far[k]
            return best, where

        far_el, far_d = far()
        out = {}
        for name, model in (('stored', fine), ('eased', eased)):
            el, dd = near(model)
            use_far = far_el > el
            out[name] = (np.where(use_far, far_el, el), np.where(use_far, far_d, dd))
        change = out['eased'][0] - out['stored'][0]
        edge = fine.half / np.maximum(np.abs(np.cos(az * D2R)), np.abs(np.sin(az * D2R)))
        k = int(np.argmax(np.abs(change)))
        row = {
            'groundM': ground, 'mastM': args.mast, 'azimuths': n_az,
            'largestChangeDeg': float(change[k]), 'atAzDeg': float(az[k]),
            'rmsChangeDeg': float(math.sqrt(np.mean(change ** 2))),
            'movedOver001Share': float(np.mean(np.abs(change) > 0.01)),
            'onEdgeStoredShare': float(np.mean(np.abs(out['stored'][1] - edge) < 6)),
            'onEdgeEasedShare': float(np.mean(np.abs(out['eased'][1] - edge) < 6)),
            'inBandEasedShare': float(np.mean((out['eased'][1] > edge - 129 * edge / fine.half) & (out['eased'][1] <= edge + 1e-6))),
            'stored': {'elevDeg': [round(float(v), 5) for v in out['stored'][0]], 'distM': [round(float(v), 1) for v in out['stored'][1]]},
            'eased': {'elevDeg': [round(float(v), 5) for v in out['eased'][0]], 'distM': [round(float(v), 1) for v in out['eased'][1]]},
        }
        results[sid] = row
        print('%-14s largest change %+.3f deg at az %.2f, RMS %.3f, moved > 0.01 deg at %.1f %%, on the edge %.1f %% -> %.1f %%' % (sid, row['largestChangeDeg'], row['atAzDeg'], row['rmsChangeDeg'], 100 * row['movedOver001Share'], 100 * row['onEdgeStoredShare'], 100 * row['onEdgeEasedShare']), flush=True)
    if args.json:
        with open(args.json, 'w') as fh:
            json.dump(results, fh, separators=(',', ':'))
            fh.write('\n')
    return results


# ---------------------------------------------------------------- LOLA

LOLA_CACHE = os.path.join(ROOT, 'scripts', '.cache', 'terrain-lola')
LOLA_BOX_M = 1200.0


def lola_fetch(sid):
    """Downloads the LOLA RDR shots within 1.2 km of the site (both axes) into the cache. Returns the CSV path."""
    import urllib.request

    entry = INDEX['sites'][sid]
    d = os.path.join(LOLA_CACHE, sid)
    path = os.path.join(d, 'pts.csv')
    if os.path.exists(path):
        return path
    os.makedirs(d, exist_ok=True)
    dlat = LOLA_BOX_M / R_M / D2R
    dlon = dlat / math.cos(entry['lat'] * D2R)
    lon = entry['lon'] % 360
    url = ('https://oderest.rsl.wustl.edu/livegds/?query=lolardr&results=v&output=JSON&maxlat=%.5f&minlat=%.5f&westernlon=%.5f&easternlon=%.5f'
           % (entry['lat'] + dlat, entry['lat'] - dlat, lon - dlon, lon + dlon))
    head = {'User-Agent': 'lunyx-terrain-check/1.0'}
    with urllib.request.urlopen(urllib.request.Request(url, headers=head), timeout=120) as r:
        res = json.load(r)['GDSResults']
    if int(res.get('Count', 0)) == 0:
        data = b''  # no LOLA track crosses the box: an empty file, so the site is not asked for again
    else:
        files = res['ResultFiles']['ResultFile']
        files = files if isinstance(files, list) else [files]
        csv_url = next(f['URL'] for f in files if f['URL'].endswith('_pts_csv.csv'))
        with urllib.request.urlopen(urllib.request.Request(csv_url, headers=head), timeout=180) as r:
            data = r.read()
    with open(path, 'wb') as fh:
        fh.write(data)
    return path


def lola_shots(path, entry):
    """Valid shots (flag 0) as site-local east/north metres and heights above the 1737.4 km sphere."""
    import csv

    with open(path, newline='') as fh:
        rows = list(csv.reader(fh))
    if not rows:
        z = np.zeros(0)
        return z, z, z, np.zeros(0, dtype=str)
    head = [h.strip() for h in rows[0]]
    col = {k: head.index(k) for k in ('Pt_Longitude', 'Pt_Latitude', 'Pt_Radius', 'Flg', 'Coordinated_Universal_Time')}
    body = [r for r in rows[1:] if len(r) == len(head)]
    flag = np.array([int(r[col['Flg']]) for r in body])
    lon = np.array([float(r[col['Pt_Longitude']]) for r in body])[flag == 0]
    lat = np.array([float(r[col['Pt_Latitude']]) for r in body])[flag == 0]
    h = (np.array([float(r[col['Pt_Radius']]) for r in body])[flag == 0] - R_M / 1000) * 1000
    day = np.array([r[col['Coordinated_Universal_Time']].strip()[:10] for r in body])[flag == 0]
    la0, lo0 = entry['lat'] * D2R, entry['lon'] * D2R
    e = np.array([-math.sin(lo0), math.cos(lo0), 0.0])
    n = np.array([-math.sin(la0) * math.cos(lo0), -math.sin(la0) * math.sin(lo0), math.cos(la0)])
    u = np.array([math.cos(la0) * math.cos(lo0), math.cos(la0) * math.sin(lo0), math.sin(la0)])
    q = np.stack([np.cos(lat * D2R) * np.cos(lon * D2R), np.cos(lat * D2R) * np.sin(lon * D2R), np.sin(lat * D2R)], axis=1)
    ce, cn, cu = q @ e, q @ n, q @ u
    t = np.hypot(ce, cn)
    k = np.arctan2(t, cu) * R_M / np.maximum(t, 1e-15)
    return ce * k, cn * k, h, day


def smooth(t):
    t = np.clip(t, 0, 1)
    return t * t * (3 - 2 * t)


def ring_check(args):
    """The option B ring grid of the app's prototype against this file's own rule, at every ring node."""
    entry, fine, w60, _ = load_site(args.ring_site)
    extra = int(math.ceil(args.band / fine.spacing))
    n = fine.n + 2 * extra
    app = np.fromfile(args.ring, dtype='<f4').reshape(n, n).astype(np.float64)
    c = (n - 1) / 2
    e = (np.arange(n) - c) * fine.spacing
    E, N = np.meshgrid(e, e)
    inside = (np.abs(E) < fine.half) & (np.abs(N) < fine.half)
    d = np.hypot(np.maximum(0, np.abs(E) - fine.half), np.maximum(0, np.abs(N) - fine.half))
    Ec, Nc = np.clip(E, -fine.half, fine.half), np.clip(N, -fine.half, fine.half)
    mine = w60.at(E, N) + (fine.at(Ec, Nc) - w60.at(Ec, Nc)) * smooth(1 - d / args.band)
    ok = ~inside
    diff = np.abs(app[ok] - mine[ok])
    print('%s: ring %d x %d, %d nodes outside the model; app minus this file: largest %.2e m; inside the model the app has %s' % (args.ring_site, n, n, ok.sum(), diff.max(), 'NaN everywhere' if np.all(np.isnan(app[inside])) else 'values'))


def cmd_lola(args):
    if args.ring:
        return ring_check(args)
    sites = args.sites.split(',') if args.sites else SITES_WITH_MODEL
    rows = {}
    pooled = {'outErrWin': [], 'outStep': [], 'inErrModel': [], 'inStep': []}
    print('Heights minus LOLA, metres, after removing the 3 m model\'s own offset against LOLA at the site (median over the model\'s core),')
    print('so that zero means "right relative to an observer standing on the model". RMS over the shots in each region.')
    print('band = the outer 129 m of the model; outside = up to %g m beyond its edge. (a) = eased onto the 60 m window (T-32),' % args.reach)
    print('(b) = option B: model kept, the 60 m window eased onto the model over %g m outside the edge, (c) = as stored (in use).\n' % args.band)
    print('%-13s %5s %6s %6s | %5s %7s %7s %7s | %5s %7s %7s | %s' % ('site', 'shots', 'offset', 'core', 'band', '(a)', '(b,c)', '60 m', 'out', '(a,c)', '(b)', 'slope of 60 m error on the step just outside (1 = model right, 0 = window right)'))
    for sid in sites:
        path = lola_fetch(sid) if args.fetch else os.path.join(LOLA_CACHE, sid, 'pts.csv')
        if not os.path.exists(path):
            print('%-13s no LOLA file (run with --fetch)' % sid)
            continue
        entry, fine, w60, _ = load_site(sid)
        eased, band, _ = ease(fine, w60)
        E, N, h, day = lola_shots(path, entry)
        reach = np.maximum(np.abs(E), np.abs(N))
        inside = reach <= fine.half
        from_edge = fine.half - reach
        core = inside & (from_edge >= band * fine.spacing)
        in_band = inside & ~core
        out = (~inside) & (np.hypot(np.maximum(0, np.abs(E) - fine.half), np.maximum(0, np.abs(N) - fine.half)) < args.reach)
        hm, he, hw = fine.at(E, N), eased.at(E, N), w60.at(E, N)
        if core.sum() < 5:
            print('%-13s %5d  too few LOLA shots inside the model' % (sid, inside.sum()))
            continue
        m0 = float(np.median(hm[core] - h[core]))
        T = h + m0
        # The step at the nearest point of the model's edge (60 m window minus model there).
        Ec, Nc = np.clip(E, -fine.half, fine.half), np.clip(N, -fine.half, fine.half)
        step = w60.at(Ec, Nc) - fine.at(Ec, Nc)
        # (b), option B: outside the edge the window moves towards the model by the step, fading out
        # over the band (the rule of scripts/terrain-seams-option-b.mjs: d is the distance to the square).
        dist_out = np.hypot(np.maximum(0, np.abs(E) - fine.half), np.maximum(0, np.abs(N) - fine.half))
        hb = hw - step * smooth(1 - dist_out / args.band)
        rms = lambda x: float(np.sqrt(np.mean(x * x))) if x.size else float('nan')
        r = {
            'shots': int(h.size), 'inside': int(inside.sum()), 'core': int(core.sum()), 'band': int(in_band.sum()), 'outside': int(out.sum()), 'tracks': sorted(set(day.tolist())),
            'modelOffsetM': m0, 'coreModelRms': rms(hm[core] - T[core]), 'coreWindowRms': rms(hw[core] - T[core]),
            'bandEasedRms': rms(he[in_band] - T[in_band]), 'bandModelRms': rms(hm[in_band] - T[in_band]), 'bandWindowRms': rms(hw[in_band] - T[in_band]),
            'outWindowRms': rms(hw[out] - T[out]), 'outBRms': rms(hb[out] - T[out]),
        }
        if out.sum() >= 3 and np.ptp(step[out]) > 0:
            r['outSlope'] = float(np.polyfit(step[out], hw[out] - T[out], 1)[0])
        mad = lambda x: float(np.median(np.abs(x))) if x.size else float('nan')
        r['outWindowMedAbs'], r['outBMedAbs'] = mad(hw[out] - T[out]), mad(hb[out] - T[out])
        r['optionBBandM'], r['outsideReachM'] = args.band, args.reach
        pooled['outErrWin'] += (hw[out] - T[out]).tolist(); pooled['outStep'] += step[out].tolist()
        pooled['inErrModel'] += (hm[in_band] - T[in_band]).tolist(); pooled['inStep'] += step[in_band].tolist()
        rows[sid] = r
        f = lambda v: '%7.2f' % v if v == v else '      -'
        print('%-13s %5d %+6.2f %6.2f | %5d %s %s %s | %5d %s %s | %s' % (sid, r['inside'], m0, r['coreModelRms'], r['band'], f(r['bandEasedRms']), f(r['bandModelRms']), f(r['bandWindowRms']), r['outside'], f(r['outWindowRms']), f(r['outBRms']), ('%+.2f' % r['outSlope']) if 'outSlope' in r else '-'))
    s, e = np.array(pooled['outStep']), np.array(pooled['outErrWin'])
    if s.size >= 5:
        slope, icpt = np.polyfit(s, e, 1)
        print('\nAll sites, %d shots up to 129 m outside the edge: 60 m window error = %.2f x step %+.2f m (correlation %.2f).' % (s.size, slope, icpt, np.corrcoef(s, e)[0, 1]))
        print('If the model is right at its edge and the window wrong, the slope is near 1; if the window is right, near 0.')
    s, e = np.array(pooled['inStep']), np.array(pooled['inErrModel'])
    if s.size >= 5:
        slope, icpt = np.polyfit(-s, e, 1)
        print('All sites, %d shots in the band: model error = %.2f x (model minus window at the nearest edge point) %+.2f m (correlation %.2f).' % (s.size, slope, icpt, np.corrcoef(-s, e)[0, 1]))
    if args.json:
        with open(args.json, 'w') as fh:
            json.dump(rows, fh, indent=1)
            fh.write('\n')
    return rows


def main():
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    sub = ap.add_subparsers(dest='cmd', required=True)
    p = sub.add_parser('seams')
    p.add_argument('--json')
    p = sub.add_parser('points')
    p.add_argument('--site', required=True)
    p.add_argument('--out', required=True)
    p.add_argument('--seed', type=int, default=32)
    p = sub.add_parser('compare')
    p.add_argument('--in', dest='inp', required=True)
    p.add_argument('--app', required=True)
    p = sub.add_parser('lola')
    p.add_argument('--sites')
    p.add_argument('--fetch', action='store_true')
    p.add_argument('--band', type=float, default=129.0, help='option B: metres outside the edge over which the 60 m window is eased onto the model')
    p.add_argument('--reach', type=float, default=129.0, help='"outside" = shots up to this far beyond the edge')
    p.add_argument('--ring', help='a ring grid written by terrain-seams-option-b.mjs --ring: compared with this file\'s own rule')
    p.add_argument('--ring-site', default='blue-ghost-1')
    p.add_argument('--json')
    p = sub.add_parser('skyline')
    p.add_argument('--sites')
    p.add_argument('--az', type=int, default=1440)
    p.add_argument('--mast', type=float, default=2.0)
    p.add_argument('--json')
    args = ap.parse_args()
    {'seams': cmd_seams, 'points': cmd_points, 'compare': cmd_compare, 'skyline': cmd_skyline, 'lola': cmd_lola}[args.cmd](args)


if __name__ == '__main__':
    main()
