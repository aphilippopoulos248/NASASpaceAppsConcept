# T-18 handover: independent Horizons sky fixture

For whoever reviews or integrates this. The fixture itself is described in `README.md`.

## What to integrate

Branch `am/lunyx/agent/ephemeris-check` (already contains integration 45a0860). Only
`tests/fixtures/horizons/ephemeris-check/` is touched: 1.3 MB. `npm run build` and `npm test`
pass with it in place.

## What is there

- 1008 Horizons rows in 15 sets, 12 sites, 1969-07-20 .. 2035-04-23 (API 1.2, DE441,
  `CENTER='coord@301'`, `COORD_TYPE='GEODETIC'`, `APPARENT='AIRLESS'`, fetched 2026-11-14
  20:37-20:46 UTC). Each row: Sun and Earth azimuth/elevation, angular diameter, range, Earth's
  lit share, Sun-Earth separation, and the Moon's sub-Earth and sub-solar points.
- Sets: Blue Ghost 1 hourly 2025-03-02..17 (352 rows) and every 10 minutes through the 14 March
  eclipse (49); IM-2 hourly 2025-03-06..17 (247); and 30 instants across 1969-2035, including five
  touchdowns, at Apollo 11, Apollo 17, Blue Ghost 1, IM-2, Chang'e 4, both exact poles, 89.5 N,
  89.5 S, the east limb (0, 90), the west limb (-35, -88) and the antimeridian (0, 180).
- Landing sites use the real heights from `public/terrain/index.json`. The seven synthetic sites
  are at `altKm` 0; no terrain height was looked up for them.
- Every file carries its site (lat, lon, altKm), the exact query URLs, the retrieval time and the
  SHA-256 of the unmodified reply kept in `raw/`.
- `fetch.mjs` rebuilds everything from Horizons, `check.mjs` verifies it without network,
  `spice_crosscheck.py` recomputes it with SPICE. None of them import from `src/` or `scripts/`.

## How it was verified

| Check | Command | Result |
| --- | --- | --- |
| Rows equal their raw replies; headers state the site, `MEAN_ME`, the 1737.4 km sphere, `AIRLESS` | `node tests/fixtures/horizons/ephemeris-check/check.mjs` | PASS, 1008 rows |
| The check notices tampering | one digit changed in a row, one in a raw reply, one stray file | FAIL each time, as intended |
| Sun-Earth separation from the two az/el pairs equals Horizons' own S-O-T | same | within 5e-5 deg |
| Sun az/el rebuilt from the sub-solar point with this fixture's own geometry | same | within 0.0002 deg at every site, exact poles included |
| Independent recomputation of every row with SPICE (DE440 kernels, `MOON_ME`, `LT+S`) | `python3 -I tests/fixtures/horizons/ephemeris-check/spice_crosscheck.py` | worst 0.000002 deg, 7 m in range |

## Baseline result

`src/astro/ephemeris.ts` `moonGeometry()` at integration 45a0860, worst over 1008 rows (degrees):

| | Sun el | Sun az arc | Earth el | Earth az arc |
| --- | --- | --- | --- | --- |
| as it is (Moon-centre directions) | 0.0034 | 0.0033 | 0.2773 | 0.0035 |
| with the site parallax added by the checker | 0.0029 | 0.0033 | 0.0034 | 0.0035 |

The Sun was already right. Earth was wrong by the site parallax and nothing else. In two fixture
rows the Moon-centre direction puts Earth on the wrong side of the horizontal.

## Sky model (deliverable 4, preliminary)

`skyAt()` from `am/lunyx/agent/analysis` at 43731e3, run from a read-only snapshot of that branch
(nothing merged): PASS on all 1008 rows.

| | Sun el | Sun az arc | Earth el | Earth az arc |
| --- | --- | --- | --- | --- |
| worst (deg) | 0.0029 | 0.0033 | 0.0036 | 0.0034 |

Distance and angular radius within 0.0035 %, lit share within 0.007 percentage points, `subEarth`
0.0076 deg, `subSolar` 0.0033 deg. All rows reported `source: "model"`. Full output in `results/`.

This has to be repeated on the integration branch once the model is merged. Not done yet.

## Tolerance

0.01 deg on elevation and on azimuth arc. Measured basis (`spice_crosscheck.py --sensitivity`):
the floor for a model on the IAU lunar rotation series is 0.0035 deg; missing site parallax costs
0.28 deg; the principal-axis frame in place of Mean Earth 0.029 deg; a missing TT-UTC offset
0.0098 deg; missing stellar aberration 0.006 deg. The last two sit at or under the limit, so the
reported worst case matters, not only PASS/FAIL.

## Not done, and limits

- `check.mjs` is not part of `npm test`, because `package.json` is the coordinator's. If wanted:
  `"check-sky-fixture": "node tests/fixtures/horizons/ephemeris-check/check.mjs"`. The code parts
  need `node_modules`; `--data-only` does not.
- `spice_crosscheck.py` needs `spiceypy` and 46 MB of NAIF kernels in `scripts/.cache/`
  (git-ignored). It is a one-off confirmation, not part of any gate.
- No terrain. "Up" means above the horizontal of the sphere; the fixture says nothing about
  skylines, sunrise over a ridge, or clearance.
- The sub-Earth point from Horizons follows a light-time-only convention and sits up to 0.006 deg
  from the apparent direction of Earth, hence the 0.02 deg tolerance on sub-points (README,
  "Things to know").
- The IM-2 pin is marked approximate in `landings.json`. The fixture is exact for the coordinates
  it states (-84.79, 29.2, 5.321 km); if the pin moves, `check.mjs` prints a note and the
  fixture stays valid for its own site.
- Format sent to @analysis in hub messages m100 and m101.
