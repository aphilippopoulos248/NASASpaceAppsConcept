#!/usr/bin/env python3
"""Build public/data/ice-targets/lemelin2021-psr.geojson from Zenodo record 4646092.

Source: Lemelin, M., Li, S., Mazarico, E., Siegler, M. A., Kring, D. A., Paige, D. A. (2021).
"Database of water ice-bearing permanently shaded regions in the lunar south polar region".
Zenodo, doi:10.5281/zenodo.4646092, CC BY 4.0. Companion to Lemelin et al. (2021),
Planetary Science Journal 2:103, doi:10.3847/PSJ/abf3c5.

Run with:  npm run build-ice-targets
Needs:     python3 (stdlib) + xlrd 2.x for the .xls attribute table
           (python3 -m pip install --target scripts/.cache/pylib xlrd==2.0.1)

Downloads go to scripts/.cache/ice-targets/ (gitignored) and are checked against
the MD5 sums Zenodo publishes. The shapefile supplies the polygons; the .xls
supplies the attributes, because the DBF stores blank cells as 0 and the .xls keeps
them blank (null). Rows are joined by FID, which is checked against the record order and
the centre coordinates.
"""
import hashlib
import json
import math
import os
import struct
import sys
import urllib.request

ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), '..'))
CACHE = os.path.join(ROOT, 'scripts', '.cache', 'ice-targets')
sys.path.insert(0, os.path.join(ROOT, 'scripts', '.cache', 'pylib'))
OUT_DIR = os.path.join(ROOT, 'public', 'data', 'ice-targets')
OUT = os.path.join(OUT_DIR, 'lemelin2021-psr.geojson')

RECORD = 4646092
STEM = 'Lemelin_et_al_2021_PSJ_south_pole_volatiles_ROIs_supp'
FILES = {f'{STEM}.zip': '1461935ab7273f4e907bed38b2d31a30', f'{STEM}.xls': '29c7bb951cde8e3dac9388deb4457a4e'}
# Zenodo answers 403 to some default client User-Agents; a browser-like UA works.
UA = 'Mozilla/5.0 (X11; Linux x86_64) lunyx-data-build'

R_MOON = 1737400.0  # m, from the shapefile .prj (Moon_2000_IAU_IAG sphere)
# Douglas-Peucker tolerance in projected metres. The polygons are traced from a
# raster (stair-stepped edges); a 30 m tolerance is a quarter of the 120 m
# slope-map pixel and well below the 240 m Diviner temperature pixels.
SIMPLIFY_M = 30.0
# FID 154 (Wiechert J): the listed centre (-85.03, -136.68) lies ~100 km from its
# polygon (centred near -85.0, -176.7), while the polygon area agrees with Area_km2
# like every other region does. Kept as published and flagged; distances use the polygon.
KNOWN_CENTRE_MISMATCH = {154}


def fetch(name, md5):
    os.makedirs(CACHE, exist_ok=True)
    path = os.path.join(CACHE, name)
    if not os.path.exists(path):
        url = f'https://zenodo.org/api/records/{RECORD}/files/{name}/content'
        req = urllib.request.Request(url, headers={'User-Agent': UA})
        with urllib.request.urlopen(req, timeout=120) as r, open(path + '.part', 'wb') as f:
            f.write(r.read())
        os.replace(path + '.part', path)
    got = hashlib.md5(open(path, 'rb').read()).hexdigest()
    if got != md5:
        raise SystemExit(f'{name}: md5 {got} != published {md5}')
    return path


def read_zip_member(zpath, suffix):
    import zipfile
    with zipfile.ZipFile(zpath) as z:
        [n] = [n for n in z.namelist() if n.endswith(suffix)]
        return z.read(n)


def parse_shp(buf):
    stype, = struct.unpack('<i', buf[32:36])
    if stype != 5:
        raise SystemExit(f'expected Polygon shapefile (type 5), got {stype}')
    off, recs = 100, []
    while off < len(buf):
        _, clen = struct.unpack('>2i', buf[off:off + 8])
        c = buf[off + 8:off + 8 + clen * 2]
        st, = struct.unpack('<i', c[:4])
        if st != 5:
            raise SystemExit(f'unexpected shape type {st}')
        nparts, npts = struct.unpack('<2i', c[36:44])
        parts = list(struct.unpack(f'<{nparts}i', c[44:44 + 4 * nparts])) + [npts]
        p0 = 44 + 4 * nparts
        pts = [struct.unpack('<2d', c[p0 + 16 * i:p0 + 16 * i + 16]) for i in range(npts)]
        recs.append([pts[parts[i]:parts[i + 1]] for i in range(nparts)])
        off += 8 + clen * 2
    return recs


def inv_stereo_south(x, y):
    """Esri Stereographic_South_Pole, k0 = 1 at the pole, central meridian 0."""
    rho = math.hypot(x, y)
    lat = 2 * math.atan(rho / (2 * R_MOON)) - math.pi / 2
    lon = math.atan2(x, y)
    return math.degrees(lon), math.degrees(lat)


def signed_area(ring):
    return 0.5 * sum(ring[i][0] * ring[i + 1][1] - ring[i + 1][0] * ring[i][1] for i in range(len(ring) - 1))


def dp(points, tol):
    """Douglas-Peucker on an open polyline; keeps both endpoints."""
    keep = [False] * len(points)
    keep[0] = keep[-1] = True
    stack = [(0, len(points) - 1)]
    while stack:
        a, b = stack.pop()
        ax, ay = points[a]
        bx, by = points[b]
        dx, dy = bx - ax, by - ay
        L = math.hypot(dx, dy)
        best, idx = -1.0, -1
        for i in range(a + 1, b):
            px, py = points[i]
            d = abs(dx * (py - ay) - dy * (px - ax)) / L if L else math.hypot(px - ax, py - ay)
            if d > best:
                best, idx = d, i
        if best > tol:
            keep[idx] = True
            stack += [(a, idx), (idx, b)]
    return [p for p, k in zip(points, keep) if k]


def simplify_ring(ring, tol):
    # Split the closed ring at the vertex farthest from its start so DP has two
    # well-separated anchors; fall back to the original if it would collapse.
    pts = ring[:-1]
    far = max(range(len(pts)), key=lambda i: (pts[i][0] - pts[0][0]) ** 2 + (pts[i][1] - pts[0][1]) ** 2)
    out = dp(pts[:far + 1], tol)[:-1] + dp(pts[far:] + [pts[0]], tol)
    if len(out) < 4 or abs(signed_area(out)) < 0.5 * abs(signed_area(ring)):
        return ring
    return out


def main():
    zpath = fetch(f'{STEM}.zip', FILES[f'{STEM}.zip'])
    xpath = fetch(f'{STEM}.xls', FILES[f'{STEM}.xls'])
    prj = read_zip_member(zpath, '.prj').decode()
    if 'Stereographic_South_Pole' not in prj or '1737400.0' not in prj:
        raise SystemExit('unexpected projection: ' + prj)
    shapes = parse_shp(read_zip_member(zpath, '.shp'))

    import xlrd
    book = xlrd.open_workbook(xpath)
    sh = book.sheet_by_name('PSR_database')
    head = [c.value for c in sh.row(0)]
    rows = [dict(zip(head, (c.value for c in sh.row(r)))) for r in range(1, sh.nrows)]
    ds = book.sheet_by_name('Column_description')
    descriptions = {ds.cell_value(r, 0): ds.cell_value(r, 1).strip() for r in range(1, ds.nrows)}
    if len(rows) != len(shapes):
        raise SystemExit(f'{len(rows)} attribute rows vs {len(shapes)} shapes')

    features, n_in, n_out, worst_area, buffers = [], 0, 0, 0.0, []
    for i, (row, rings) in enumerate(zip(rows, shapes)):
        if int(row['FID']) != i:
            raise SystemExit(f'row {i} has FID {row["FID"]}')
        outers, holes = [], []
        for ring in rings:
            s = simplify_ring(ring, SIMPLIFY_M)
            n_in += len(ring)
            n_out += len(s)
            # Shapefile convention: outer rings clockwise (negative signed area).
            (outers if signed_area(ring) < 0 else holes).append((ring, s))
        if len(outers) != 1 and holes:
            raise SystemExit(f'FID {i}: {len(outers)} outers with holes; assignment not implemented')
        area_src = sum(-signed_area(r) for r, _ in outers) - sum(signed_area(r) for r, _ in holes)
        area_simp = sum(-signed_area(s) for _, s in outers) - sum(signed_area(s) for _, s in holes)
        worst_area = max(worst_area, abs(area_simp - area_src) / area_src)

        def ll(ring, reverse):
            pts = [inv_stereo_south(x, y) for x, y in ring]
            if reverse:  # GeoJSON (RFC 7946): exterior counter-clockwise, holes clockwise
                pts = pts[::-1]
            return [[round(lon, 4), round(lat, 4)] for lon, lat in pts]

        polys = [[ll(s, True)] for _, s in outers]
        for _, s in holes:
            polys[0].append(ll(s, False))
        geom = {'type': 'Polygon', 'coordinates': polys[0]} if len(polys) == 1 else \
            {'type': 'MultiPolygon', 'coordinates': polys}

        # Sanity: the published centre should sit within the region's extent.
        xs = [x for r in rings for x, _ in r]
        ys = [y for r in rings for _, y in r]
        lat, lon = row['Latitude'], row['Longitude']
        rho = 2 * R_MOON * math.tan(math.pi / 4 + math.radians(lat) / 2)
        cx, cy = rho * math.sin(math.radians(lon)), rho * math.cos(math.radians(lon))
        pad = 2000
        flags = []
        if not (min(xs) - pad <= cx <= max(xs) + pad and min(ys) - pad <= cy <= max(ys) + pad):
            if i not in KNOWN_CENTRE_MISMATCH:
                raise SystemExit(f'FID {i}: centre ({lat},{lon}) outside its polygon bbox — projection mismatch?')
            flags.append('center-outside-polygon')
        # Equivalent-circle estimate of how far the outline extends beyond the listed PSR area.
        buffers.append(math.sqrt(area_src / math.pi) - math.sqrt(row['Area_m2'] / math.pi))

        props = {'id': f'lemelin2021-psr-{i}'}
        for k in head:
            v = row[k]
            if v == '':
                v = None
            elif k == 'Slope_access' or k == 'Name':
                v = str(v)
            elif k in ('FID', 'Near_side', 'Count_M3', 'Hydrogen_class', 'HIGHEST', 'LATERAL', 'VERTICAL',
                       'FASTEST', 'TOTAL_Obj'):
                v = int(v)
            else:
                v = float(v)
            props[k] = v
        if flags:
            props['lunyxFlags'] = flags
        features.append({'type': 'Feature', 'id': props['id'], 'properties': props, 'geometry': geom})

    buffers.sort()
    buf_note = (f'The published outlines are larger than the listed PSR areas (Area_km2): the equivalent-circle '
                f'difference is {buffers[0]:.0f}-{buffers[-1]:.0f} m (median {buffers[len(buffers) // 2]:.0f} m), '
                'consistent with region-of-interest outlines that extend ~0.3 km beyond each PSR. This is our '
                'inference; the record does not document it. A distance of 0 means inside the mapped outline, '
                'not necessarily inside the PSR.')
    fc = {
        'type': 'FeatureCollection',
        'lunyx': {
            'kind': 'area',
            'title': 'Water ice-bearing permanently shaded regions (PSRs), lunar south polar region',
            'citation': 'Lemelin, M., Li, S., Mazarico, E., Siegler, M. A., Kring, D. A., & Paige, D. A. (2021). '
                        'Database of water ice-bearing permanently shaded regions in the lunar south polar region '
                        '[Data set]. Zenodo. https://doi.org/10.5281/zenodo.4646092',
            'paper': 'Lemelin, M., et al. (2021). Framework for Coordinated Efforts in the Exploration of Volatiles '
                     'in the South Polar Region of the Moon. Planetary Science Journal, 2, 103. '
                     'https://doi.org/10.3847/PSJ/abf3c5',
            'license': 'CC-BY-4.0',
            'licenseUrl': 'https://creativecommons.org/licenses/by/4.0/',
            'source': {
                'record': f'https://zenodo.org/records/{RECORD}',
                'files': [{'name': n, 'md5': m} for n, m in FILES.items()],
                'published': '2021-03-29',
            },
            'changes': [
                'Polygons from the shapefile; attributes from the .xls (blank cells kept as null; the DBF stores them as 0).',
                'Reprojected from Moon2000 south-polar stereographic (sphere R = 1737400 m, true scale at the pole) '
                'to planetocentric lat/lon degrees (east-positive, -180..180) on the same sphere.',
                f'Ring vertices simplified with Douglas-Peucker at {SIMPLIFY_M:g} m (projected); '
                f'{n_in} -> {n_out} vertices; worst per-region area change {worst_area * 100:.2f}%. '
                'Area_m2/Area_km2 are the authors\' values, not recomputed.',
                'Coordinates rounded to 1e-4 degree (<= 11 m). Feature ids "lemelin2021-psr-<FID>" added.',
            ],
            'geometryNotes': [
                'Each feature is an AREA (polygon), not a point. Latitude/Longitude are the authors\' "center" of '
                'the region, for labelling only; distances should be measured to the polygon.',
                buf_note,
                'FID 154 (Wiechert J): the listed centre is ~100 km from the polygon; flagged "center-outside-polygon". '
                'Use the polygon for position.',
                'Polygons near the pole may span many longitudes; render per-vertex on the sphere, not on a flat '
                'lon/lat map.',
            ],
            'units': {
                'Latitude': 'deg', 'Longitude': 'deg (east-positive)', 'Area_m2': 'm^2', 'Area_km2': 'km^2',
                'M3_per_km2': 'detections/km^2', 'MIN_slope': 'deg', 'MAX_slope': 'deg', 'MEAN_slope': 'deg',
                'Slope_access': 'deg range', 'MIN_H': 'ppm H', 'MAX_H': 'ppm H', 'MEAN_H': 'ppm H',
                'WEH_max_wt%': 'wt% water-equivalent hydrogen', 'MIN_an_T': 'K', 'MAX_an_T': 'K', 'MEAN_T': 'K',
                'H2O_depth_min': 'm (stability depth, top metre)', 'H2O_depth_max': 'm', 'CO2_depth_min': 'm',
                'CO2_depth_max': 'm',
                'MAX_illum_1km': 'fraction of time 0..1 (source text says 0-100%, stored values are 0..1)',
                'MAX_illum_5km': 'fraction 0..1', 'MAX_illum_10km': 'fraction 0..1',
                'MIN_dist_5deg': 'm (inferred; slope-limited traverse distance, null = no route under that slope)',
                'MIN_dist_10deg': 'm', 'MIN_dist_15deg': 'm', 'MIN_dist_20deg': 'm', 'MIN_dist_25deg': 'm',
                'HIGHEST': '1 = flagged, null = not', 'LATERAL': '1 = flagged, null = not',
                'VERTICAL': '1 = flagged, null = not', 'FASTEST': '1 = flagged, null = not',
            },
            'columns': descriptions,
        },
        'features': features,
    }
    os.makedirs(OUT_DIR, exist_ok=True)
    with open(OUT, 'w') as f:
        json.dump(fc, f, separators=(',', ':'), ensure_ascii=False)
        f.write('\n')
    print(f'{len(features)} regions, {n_in} -> {n_out} vertices, worst area change {worst_area * 100:.2f}%, '
          f'{os.path.getsize(OUT) / 1024:.0f} KiB -> {os.path.relpath(OUT, ROOT)}')


if __name__ == '__main__':
    main()
