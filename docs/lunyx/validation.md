# Lunyx validation record

Owner: @analysis. Every number below is reproduced by a command in this repository.
Conventions: UTC; latitude north-positive; longitude east-positive (ME frame); heights in
metres above the 1737.4 km sphere; azimuth clockwise from north; elevation above the local
horizontal, airless (no refraction).

## 1. Sun and Earth in a site's sky (`skyAt`, `src/astro/topocentric.ts`)

**Model.** astronomy-engine heliocentric Earth and Moon states (VSOP87 / its lunar theory),
the IAU (WGCCRE) lunar rotation model for the Moon-fixed frame, observer on the 1737.4 km
sphere + height. Apparent directions: light-time (Earth's retarded position) and stellar
aberration from the observer's barycentric velocity; no refraction. Earth's parallax across
the Moon (up to ~0.26 deg) is included because the observer is placed on the surface.

**Reference.** JPL Horizons (DE441), observer table, `CENTER='coord@301'`,
`COORD_TYPE='GEODETIC'`, `SITE_COORD='lon,lat,alt_km'`, `QUANTITIES='4,20'`,
`APPARENT='AIRLESS'`, `EXTRA_PREC='YES'`. Horizons reports the site frame as
`MEAN_ME (high precision)` with radii 1737.4 km (a sphere).

**Reference set** (`src/analysis/__fixtures__/horizons-topo-check.json`, built by
`node scripts/fetch-horizons-topo-check.mjs`): 11 sites x 16 dates = 176 instants, both bodies.
Sites: equator 0/0, Apollo 15 (26.1N), mid-latitude 45S 60W, east limb 5N 89E, west limb
10S 88.5W, far side (Chang'e 4), antimeridian 12N 180, the exact south and north poles,
89.9S, IM-2 (84.8S). Dates 1950-06-01 ... 2099-12-01 (13 of them 1969-2035).

| Span | Worst Sun error | Worst Earth error | Worst elevation-only error |
| --- | --- | --- | --- |
| 1950-2035 (154 instants per body) | 12.2" = 0.0034 deg | 12.2" = 0.0034 deg | 11.3" (Sun), 12.0" (Earth) |
| 2060-02-29 | 20.6" = 0.0057 deg | (same) | |
| 2099-12-01 | 74.2" = 0.021 deg | (same) | |

Errors are great-circle separations between the model's and Horizons' (az, el) directions.
Earth distance agrees within 12 km (of ~380 000 km); Sun distance within 2 000 km (1.4e-5,
VSOP87 truncation) — irrelevant for the disc sizes (< 0.0001 deg).

*Why the error grows after 2035:* both systems predict Delta-T (TT - UT) for future dates,
differently. Shifting the model's time by the best-fit offset (-40 s in 2060, -155 s in 2099)
brings the agreement back to 7.5" and 9.9". Up to 2035 the best-fit offset is 0-20 s and
removes < 1.3". The residual ~12" is mostly the IAU rotation model vs DE441's MEAN_ME frame.

*Poles:* at exactly +-90 deg latitude, "north" is defined as the limit along the site's own
meridian; this matches Horizons' azimuths at lon 0 to < 0.003 deg (26 instants).

**Bundled Horizons tables vs model** (every row): Blue Ghost Mission 1 window
(4 465 rows) worst 11.3"; IM-2 window (4 465 rows) worst 11.3".

Tests: `src/analysis/sky.test.ts` (fails above 0.01 deg to 2035 and 0.03 deg after).
Development table with live (cached) queries: `node scripts/compare-topocentric.mjs`.

Independent fixtures from @ephemeris-check (`tests/fixtures/`, task T-18): pending; the
suite will be extended to run against them as soon as they land.

## 2. Bundled Horizons windows (`public/data/horizons/`)

Built by `node scripts/build-horizons-bundle.mjs` (raw replies cached in `scripts/.cache/`).
10 min step, Sun and Earth az/el (1e-4 deg), hourly light-time distance.

| Window | Site (lat, lon, height) | Span (UTC) | Rows | Size |
| --- | --- | --- | --- | --- |
| `blue-ghost-1-2025-03` | 18.562, 61.81, -3652 m | 2025-03-01 00:00 - 2025-04-01 00:00 | 4 465 | 159 KB |
| `im-2-2025-03` | -84.79, 29.2, +5321 m | 2025-03-05 00:00 - 2025-04-05 00:00 | 4 465 | 154 KB |

Total 0.32 MB. A table is used when the scenario's site is within 100 m of the table's site
(100 m tilts the local vertical by 0.0033 deg) and the whole window lies inside it; the
series then reports `source: 'horizons'`. Between rows directions are interpolated
linearly through unit vectors (the 10 min chord error is < 0.0001 deg). The table's height
is the terrain height; a mast of a few metres changes Earth's parallax by < 1e-5 deg.

## 3. Skyline (`computeHorizon`, `src/analysis/horizon.ts`)

Exact spherical geometry: elevation of terrain at ground distance d and height h from an
observer at h0 = site height + mast is `atan2((R+h)cos(d/R) - (R+h0), (R+h)sin(d/R))`.

Analytic checks (`src/analysis/horizon.test.ts`):

| Case | Expected | Measured error |
| --- | --- | --- |
| Smooth sphere, mast 2 / 10 / 100 m | -acos(R/(R+h)) = -0.0275 / -0.0615 / -0.1945 deg | < 0.002 deg at all 720 azimuths |
| Smooth sphere, mast 0 | 0 deg | < 0.01 deg |
| Ring ridge 1500 m high, 20 km away | exact formula | < 0.02 deg; distance within 200 m, height within 5 m |
| Bowl crater, rim 800 m above floor at 5 km | exact formula | < 0.05 deg |
| Poles (+-90) and antimeridian | smooth-sphere value | < 0.002 deg |

**Real data: Apollo 15** (`public/terrain/apollo-15.bin` + `_fine.bin`: LROC NAC DTM 3 m grid
to ~1.1 km, SLDEM2015 60 m to ~5.4 km, SLDEM2015 480 m to ~43 km; observer 2 m above the LM
site at -1928 m).

| Feature | Published | Lunyx skyline from the DEM |
| --- | --- | --- |
| Mons Hadley (NE) | "Two major Apennine massifs tower over the Hadley plain to heights of 4.5 and 3.5 km. These are Mt. Hadley to the northeast and Hadley Delta just south of the landing site" (NASA SP-289, Apollo 15 Preliminary Science Report, p. 5-4); ~4 km (LROC, lroc.im-ldi.com/images/783); 4.1 km (NASA SVS 4918). Gazetteer feature centre ~21 km at bearing ~38 deg. | Highest skyline in 20-60 deg: **11.13 deg at azimuth 43 deg**, set by terrain **19.7 km** away, **4.0 km** above the site. |
| Hadley Delta (S) | ~3.5 km (SP-289; LROC); 3.6 km (LTO-41B4 via Wikipedia); "about 5 kilometers northwest of Hadley Delta" (NASA SP-4214). Feature centre ~12.7 km at ~170 deg. | Highest skyline in 150-210 deg: **13.46 deg at azimuth 180 deg**, set by terrain **10.6 km** away, **2.57 km** above the site. |

Mons Hadley agrees with the published height and position. For Hadley Delta the skyline is
formed by its north face, 2.6 km above the site, about 1 km lower than the published summit
height: the summit lies beyond the face as seen from the LM, and from 10 km out the data is
the 480 m grid, which flattens peaks. No published elevation angle from the LM was found.

Runtime: full 720-azimuth profile for Apollo 15 (three layers, out to where no lunar terrain
could rise above the skyline) 260-500 ms on this machine (4 cores, Node 22, single thread).

## 4. Mission-window analysis (`src/analysis/window.ts`)

See `src/analysis/window.test.ts`. Recorded results (2 m mast, 10 min step, 14 days):

| Scenario | Ephemeris | Illumination | Sun any | Longest darkness | Earth LOS | Longest Earth gap | Runtime |
| --- | --- | --- | --- | --- | --- | --- | --- |
| Blue Ghost 1, from 2025-03-02 08:34 | Horizons (bundled) | 98.9 % | 99.3 % | 2.3 h (Earth eclipse of the Sun, 2025-03-14) | 100 % | 0 h | ~0.3-0.5 s |
| IM-2, from 2025-03-06 17:28 | Horizons (bundled) | 92.5 % | 93.8 % | 18.2 h (runs into the window edge) | 89.2 % | 36.3 h (edge) | ~0.2-0.5 s |
| Apollo 15, from 1971-07-30 22:16 | model | 95.6 % | | sunset 1971-08-13 11:37 | | | ~0.3-0.8 s |

Eclipse check: at the Blue Ghost site the Sun is fully behind Earth (geometric discs) from
2025-03-14 06:17 to 08:34 UTC, inside the published umbral phase of that lunar eclipse
(05:09-08:47 UTC); Mare Crisium lies on the Moon's trailing limb, so it enters the shadow late.
Convergence: halving the step (10 -> 5 min) changes Apollo 15 illumination by 0.001 points
and event times by < 1 min.

## 5. Nearby alternatives (`rankNearby`, `src/analysis/nearby.ts`)

Default scan: radius 2 km, spacing 300 m (137 candidates including the site itself), slope
limit 10 deg over a baseline of 2x the finest grid, skyline every 1 deg (main analysis:
0.5 deg) with coarser far-field marching, window sampled every 30 min (main: 10 min). The
Sun/Earth directions are computed once for the site and re-projected into each candidate's
local horizon (checked against a direct computation 2 km away: < 0.001 deg).

| Site, 14-day window | Candidates within slope limit | Runtime (Node, one thread) |
| --- | --- | --- |
| IM-2 (LOLA 60 m / 480 m) | 131 of 137 | 6.9 s |
| Apollo 15 (NAC 3 m near field, SLDEM 60 m / 480 m) | 130 of 137 | 8.5 s |

Synthetic checks: a ridge crest outranks the valley floor; a 20 deg wall is rejected at a
10 deg limit and accepted at 30 deg; candidates without data are rejected as `no-data`.
Resolution caveat, stated in every candidate's `basis`: slope and skyline rest on 60 m
grids (3 m only where a NAC model exists near an Apollo site); metre-scale boulders,
craters and slopes are invisible to this scan.
