# Horizons sky fixture

Reference values from JPL Horizons for where the **Sun and Earth sit in the sky of a site on the
Moon**: 1008 instants at 12 sites between 1969 and 2035. It exists to check the app's sky model
(`skyAt()` and whatever feeds it) against numbers the app's authors did not produce.

Owner: @ephemeris-check (independent validation, task T-18). Nothing here imports from `src/` or
`scripts/`, and nothing in `src/` should be changed to make this pass without asking why it failed.

## Using it

```ts
const dir = 'tests/fixtures/horizons/ephemeris-check';
const index = JSON.parse(readFileSync(`${dir}/index.json`, 'utf8'));
for (const entry of index.sets) {
  const set = JSON.parse(readFileSync(`${dir}/${entry.file}`, 'utf8'));
  for (const row of set.rows) {
    const sky = skyAt({ lat: set.site.lat, lon: set.site.lon }, set.site.altKm * 1000, Date.parse(row.utc));
    // elevation:  |sky.sun.elDeg - row.sun.el|                                   <= 0.01
    // azimuth:    |wrap180(sky.sun.azDeg - row.sun.az)| * cos(row.sun.el)        <= 0.01
  }
}
```

| `SkyInstant` | fixture row |
| --- | --- |
| `sun.azDeg`, `earth.azDeg` | `sun.az`, `earth.az` |
| `sun.elDeg`, `earth.elDeg` | `sun.el`, `earth.el` |
| `sun.angularRadiusDeg`, `earth.angularRadiusDeg` | `angDiamArcsec / 7200` |
| `sun.distanceKm`, `earth.distanceKm` | `rangeKm` |
| `earthLitFraction` | `earth.illumPct / 100` |
| `subEarth`, `subSolar` | `subEarth`, `subSolar` |

Or run the checker, which does all of this and prints the worst case per set:

```
node tests/fixtures/horizons/ephemeris-check/check.mjs               # fixture + baseline + skyAt
node tests/fixtures/horizons/ephemeris-check/check.mjs --data-only   # fixture only, no node_modules needed
node tests/fixtures/horizons/ephemeris-check/check.mjs --root DIR    # test the code of another checkout
```

## Files

| File | What |
| --- | --- |
| `index.json` | Conventions, field list, tolerances, and the list of sets. Start here. |
| `data/<set>.json` | One site and one list of instants per file: the site, the exact queries, the rows. |
| `raw/*.txt` | The unmodified Horizons replies. `raw/retrieval-log.json` has each URL, fetch time and SHA-256. |
| `sets.json` | Which sites and instants to fetch (input of `fetch.mjs`), plus the authored conventions and tolerances. |
| `fetch.mjs` | Builds everything above from Horizons. Node built-ins only. |
| `check.mjs` | Re-derives every row from `raw/`, tests the values against each other, then tests the app code. |
| `lib.mjs` | Reading Horizons tables; the fixture's own east/north/up geometry. |
| `spice_crosscheck.py`, `spice-crosscheck.json` | Offline recomputation of every row with NAIF SPICE, and its result. |
| `results/` | Checker output for the code as it stood when the fixture was built. |

1.3 MB in total (0.44 MB data, 0.75 MB raw replies).

## Conventions

- **Time**: UTC, ISO 8601 strings (`Date.parse` reads them exactly).
- **Site**: latitude north-positive, longitude **east-positive in -180..180**, in the Moon's Mean
  Earth / polar axis frame (Horizons `MEAN_ME`, DE441 lunar orientation). `altKm` is height above
  the **1737.4 km** sphere, so geodetic and planetocentric latitude are the same thing.
- **Azimuth**: degrees clockwise from local north (N 0, E 90, S 180, W 270).
- **Elevation**: degrees above the plane perpendicular to the local vertical of that sphere, for
  the **centre** of the body. No terrain, no horizon dip.
- **Airless apparent place** (`APPARENT='AIRLESS'`): light-time, stellar aberration and
  gravitational light bending applied; no refraction.
- **Topocentric**: the observer is the site itself (`CENTER='coord@301'`), so Earth includes its
  parallax across the Moon.

These are the conventions of `src/core/types.ts`.

## Row format (`lunyx.horizons-sky/1`)

```json
{
 "schema": "lunyx.horizons-sky/1",
 "id": "blue-ghost-1.eclipse-2025-03-14",
 "title": "...",
 "site": { "id": "blue-ghost-1", "name": "Blue Ghost Mission 1", "kind": "landing",
           "lat": 18.562, "lon": 61.81, "altKm": -3.652, "altSource": "...", "pinSource": "..." },
 "time": { "scale": "UTC", "start": "...", "stop": "...", "stepMinutes": 10, "count": 49 },
 "source": { "service": "...", "apiVersion": "1.2", "ephemeris": "DE441",
             "moonFrame": "MEAN_ME (high precision)", "moonRadiiKm": "1737.4, 1737.4, 1737.4",
             "refraction": "NO (AIRLESS)", "retrievedUtc": "2026-11-14T20:37:02Z" },
 "query": { "sun": { "url": "...", "raw": "raw/....sun.txt", "sha256": "...", "retrievedUtc": "..." },
            "earth": { ... }, "moon": { ... } },
 "rows": [
  { "utc": "2025-03-14T07:20:00Z",
    "sun":   { "az": 259.156492351, "el": 29.02256414, "angDiamArcsec": 1924.472, "rangeKm": 149130746.61 },
    "earth": { "az": 258.759730908, "el": 28.887850755, "angDiamArcsec": 6566.723, "rangeKm": 400699.27899,
               "illumPct": 0.00106, "sunElongDeg": 0.3724 },
    "subEarth": { "lat": -0.37916, "lon": 2.82381 },
    "subSolar": { "lat": -0.086125, "lon": 2.626773 } }
 ]
}
```

Every row of a file is for that file's `site` (including its altitude) and comes from that file's
three `query` entries. Values are Horizons' own digits; the only conversions are the time stamp to
ISO 8601 and sub-point longitude from 0..360 to -180..180.

| Field | Unit | Horizons quantity |
| --- | --- | --- |
| `az`, `el` | deg | 4, airless apparent azimuth and elevation |
| `angDiamArcsec` | arcsec | 13. Equals `2 asin(R / range)` with R = 695 700 km (Sun), 6378.137 km (Earth, equatorial) |
| `rangeKm` | km | 20, site to body centre |
| `earth.illumPct` | % | 10, sunlit share of Earth's disc seen from the site |
| `earth.sunElongDeg` | deg | 23, angle between the Sun's and Earth's centres in the site's sky |
| `subEarth`, `subSolar` | deg | 14 and 15 of the Moon (301) seen from Earth's centre (`500@399`). Site-independent. |

## What is covered

| Set | lat, lon | altKm | Rows | Instants (UTC) |
| --- | --- | --- | --- | --- |
| `blue-ghost-1.surface-2025-03` | 18.562, 61.81 | -3.652 | 352 | 2025-03-02T09:00 .. 2025-03-17T00:00, hourly |
| `blue-ghost-1.eclipse-2025-03-14` | 18.562, 61.81 | -3.652 | 49 | 2025-03-14T03:00 .. 11:00, every 10 min |
| `im-2.surface-2025-03` | -84.79, 29.2 | 5.321 | 247 | 2025-03-06T18:00 .. 2025-03-17T00:00, hourly |
| `apollo-11.epochs-1969-2035` | 0.67416, 23.47314 | -1.93 | 30 | 30 instants 1969-07-20 .. 2035-04-23 |
| `apollo-17.epochs-1969-2035` | 20.1911, 30.7723 | -2.628 | 30 | same 30 |
| `blue-ghost-1.epochs-1969-2035` | 18.562, 61.81 | -3.652 | 30 | same 30 |
| `im-2.epochs-1969-2035` | -84.79, 29.2 | 5.321 | 30 | same 30 |
| `change-4.epochs-1969-2035` (far side) | -45.4446, 177.5991 | -5.93 | 30 | same 30 |
| `north-pole.epochs-1969-2035` | 90, 0 | 0 | 30 | same 30 |
| `south-pole.epochs-1969-2035` | -90, 0 | 0 | 30 | same 30 |
| `near-north-pole.epochs-1969-2035` | 89.5, 120 | 0 | 30 | same 30 |
| `near-south-pole.epochs-1969-2035` | -89.5, -137.3 | 0 | 30 | same 30 |
| `limb-east.epochs-1969-2035` | 0, 90 | 0 | 30 | same 30 |
| `limb-west.epochs-1969-2035` | -35, -88 | 0 | 30 | same 30 |
| `antimeridian.epochs-1969-2035` | 0, 180 | 0 | 30 | same 30 |

- **Landing pins** are copied from `public/data/landings.json` and their heights from
  `public/terrain/index.json` (metres above the 1737.4 km sphere). The other seven sites are
  synthetic and sit on the sphere (`altKm` 0); no terrain height was looked up for them.
- **The 30 instants** are 26 on a fixed step of 960 d 17 h 15 min from Apollo 11's touchdown, plus
  the touchdowns of Apollo 17, Chang'e 4, Blue Ghost 1 and IM-2. The step was searched for so the
  samples spread evenly over the lunar month (phase), the anomalistic and draconic months
  (distance, libration), the eclipse year (lunar seasons) and the calendar year. In these rows the
  sub-solar latitude runs -1.52..+1.54, the sub-Earth point -6.7..+6.8 in latitude and -7.3..+6.2
  in longitude, Earth's distance from 359 700 to 404 400 km and its lit share 1..99.9 %.
- **Blue Ghost window**: first full hour after touchdown (Sun 3.6 deg up in the east) to after
  sunset. On the smooth sphere the Sun's centre crosses the horizontal at about 2025-03-16T20:11Z.
- **Blue Ghost eclipse**: Earth passes in front of the Sun. The discs overlap in the samples from
  05:10 to 09:50 and the Sun is wholly behind Earth's disc from 06:20 to 08:30 (centres 0.37 deg
  apart at 07:30; radii 0.912 and 0.267 deg). Geometry only: Earth's atmosphere is not modelled.
- **IM-2 window**: hourly for ten days from the first full hour after touchdown. This is a
  sampling choice for a polar site (Sun 2.5..5.4 deg up while it swings 125 deg, from azimuth 65
  through north to 301; Earth 1..11 deg up), not a statement about how long the lander operated. The IM-2 pin
  is marked approximate in `landings.json`; the fixture is exact for the coordinates it states.
- **Hard cases on purpose**: 86 rows have a body within 1 deg of the horizontal, 14 have one
  beyond +-85 deg, the two limb sites and four polar sites have Earth up in about half their
  rows, and at the far-side sites Earth is never up (-37 to -88 deg).

## Where the numbers come from

NASA/JPL Horizons API 1.2, `https://ssd.jpl.nasa.gov/api/horizons.api`, ephemeris DE441, fetched
2026-11-14 20:37-20:46 UTC. Three requests per set; the exact URLs are in each file's `query`:

```
Sun / Earth from the site                      Moon sub-points from Earth's centre
  COMMAND='10' or '399'                          COMMAND='301'
  CENTER='coord@301'                             CENTER='500@399'
  COORD_TYPE='GEODETIC'                          QUANTITIES='14,15'
  SITE_COORD='<lon E>,<lat>,<alt km>'
  QUANTITIES='4,10,13,20,23,24'
common: EPHEM_TYPE='OBSERVER' APPARENT='AIRLESS' TIME_TYPE='UT' TIME_DIGITS='FRACSEC' CAL_FORMAT='BOTH'
        ANG_FORMAT='DEG' RANGE_UNITS='KM' EXTRA_PREC='YES' CSV_FORMAT='YES' OBJ_DATA='NO' format=text
times:  START_TIME / STOP_TIME / STEP_SIZE, or TLIST for the 30 instants
```

Each reply's header is checked for: target, `Center body name: Moon (301)`, the site echoed back,
`Center pole/equ : MEAN_ME (high precision)`, `Center radii : 1737.4, 1737.4, 1737.4 km` and
`Atmos refraction: NO (AIRLESS)`.

## Tolerance

Compare elevation directly and **azimuth as an arc on the sky**, `|wrap180(az - ref.az)| * cos(ref.el)`.
Raw azimuth differences blow up near the zenith and nadir, and the fixture goes there on purpose.

| What | Tolerance | Why |
| --- | --- | --- |
| Sun and Earth, elevation and azimuth arc, model evaluated at the site | **0.01 deg** | below |
| Same, for a model that takes directions from the Moon's centre | Sun 0.01, Earth 0.30 deg | parallax up to 0.28 deg |
| Angular diameter | 0.2 % | covers the usual choices of radius |
| Distance | 0.01 % | 38 km on Earth; a Moon-centre distance is off by up to 1743 km and should fail |
| Earth lit share | 0.5 percentage points | the site's parallax changes the phase by up to 0.23 |
| `subEarth`, `subSolar` | 0.02 deg great-circle | see "Things to know" |

How far each modelling mistake moves the answer, measured over all 1008 rows by changing one thing
in the SPICE recomputation (`spice_crosscheck.py --sensitivity`):

| Change from the exact computation | Sun | Earth |
| --- | --- | --- |
| none | 0.000002 | 0.000001 |
| site altitude ignored | 0.000004 | 0.0008 |
| IAU lunar rotation series (`IAU_MOON`) instead of the DE orientation | 0.0035 | 0.0034 |
| geometric direction (no light-time, no aberration) | 0.0060 | 0.0002 |
| light-time without stellar aberration | 0.0060 | 0.0059 |
| TT-UTC ignored (UTC used as dynamical time) | 0.0098 | 0.0019 |
| principal-axis frame (`MOON_PA`) instead of Mean Earth | 0.029 | 0.029 |
| direction from the Moon's centre | 0.0007 | 0.276 |

(worst angular distance, deg.) An analytic model built on the IAU rotation series cannot do better
than 0.0035 deg against this reference; 0.01 deg is three times that floor. It fails a frame
mix-up and missing parallax outright. A missing TT-UTC offset or aberration correction lands at or
under the limit, so read the reported worst case, not only PASS/FAIL. For scale: the Sun's radius
is 0.27 deg, and 0.01 deg is well under what a 60 m terrain model resolves in a skyline.

## How the fixture itself was checked

1. **Against its raw replies** (`check.mjs`, part 1): every row is re-derived from `raw/`, each
   reply matches its recorded SHA-256, the stored URL names the site, body and options that the
   reply's header echoes, and Horizons' calendar stamp and Julian date both equal the requested
   instant.
2. **Against itself** (`check.mjs`, part 2), with geometry written here and not taken from the app:
   - Sun-Earth separation computed from the two az/el pairs equals Horizons' own S-O-T to 5e-5 deg
     (S-O-T is printed to 1e-4).
   - Angular diameters equal `2 asin(R / range)` to 0.001 arcsec.
   - Sun az/el rebuilt from `subSolar` and the range agree to 0.0002 deg, at every site including
     the exact poles. This ties the east/north/up convention to a second Horizons product.
3. **Against SPICE** (`spice_crosscheck.py`): every row recomputed offline from the JPL kernels
   (`de440s.bsp`, `moon_pa_de440_200625.bpc`, `moon_de440_250416.tf`, `pck00011.tpc`,
   `naif0012.tls`; SHA-256 in `spice-crosscheck.json`) with
   `spkcpo(target, et, 'MOON_ME', 'OBSERVER', 'LT+S', site, 'MOON', 'MOON_ME')`. Worst difference
   over 1008 rows: **0.000002 deg** in elevation, 0.000001 deg in azimuth arc, 7 m in range.
   So the values mean what this page says they mean.

## Results against the code

Full output in `results/`.

**Baseline `src/astro/ephemeris.ts` `moonGeometry()`** (integration branch at 45a0860; directions
from the Moon's centre), worst over 1008 rows:

| | Sun el | Sun az arc | Earth el | Earth az arc |
| --- | --- | --- | --- | --- |
| as it is | 0.0034 | 0.0033 | **0.2773** | 0.0035 |
| with the site parallax added by the checker | 0.0029 | 0.0033 | 0.0034 | 0.0035 |

The Sun was already right. Earth was wrong by the parallax and nothing else: in two of the
fixture's rows (east limb 2025-03-02T08:34Z, near south pole 1977-06-11T00:02Z) the Moon-centre
direction puts Earth's centre above the horizontal when it is below. Its sub-points are within
0.0078 deg (`subEarth`) and 0.0032 deg (`subSolar`).

**`src/analysis/api.ts` `skyAt()`** on branch `am/lunyx/agent/analysis` at 43731e3 (not yet
integrated when this was run; all 1008 rows reported `source: "model"`):

| | Sun el | Sun az arc | Earth el | Earth az arc |
| --- | --- | --- | --- | --- |
| worst over 1008 rows | 0.0029 | 0.0033 | 0.0036 | 0.0034 |

Angular radii and distances within 0.0035 %, Earth's lit share within 0.007 percentage points,
`subEarth` 0.0076 deg, `subSolar` 0.0033 deg. Everything is inside tolerance, and the residual is
the IAU-series floor in the table above. Re-run after it is merged:
`node tests/fixtures/horizons/ephemeris-check/check.mjs`.

## Things to know

- **Exact poles.** Horizons accepts latitude +-90. Azimuth there is measured from the meridian of
  the longitude you state (0 E in this fixture): at the north pole az 0 points along 180 E and az 90
  along 90 E; at the south pole az 0 points along 0 E and az 90 along 90 E. That is the ordinary
  `north = (-sin lat cos lon, -sin lat sin lon, cos lat)` evaluated at the pole, so no special
  case is needed as long as the same longitude is passed.
- **`subEarth` is 20 arcsec from where the site rows see Earth.** Horizons corrects the
  sub-observer point for light-time only, and the sub-solar point for light-time and stellar
  aberration (SPICE reproduces them with `subpnt(..., 'LT')` to 0.00003 deg and
  `subslr(..., 'LT+S')` to 0.000003 deg, and with nothing else). The two corrections nearly cancel
  for the Earth-Moon pair, so a sub-Earth point taken from the apparent direction of Earth differs
  from Horizons' by up to 0.0059 deg. Neither is wrong; hence the 0.02 deg tolerance.
- **Altitude hardly matters for angles** (0.0008 deg at most, on Earth), but it is in every query
  and every file so the numbers are exact for the stated site.
- **UTC.** For 1969 Horizons uses the real UTC of the time (TAI-UTC was 7.57 s and drifting); for
  instants after the last announced leap second it holds TAI-UTC constant, as JavaScript `Date`
  does. One second of time moves the Sun by 0.00014 deg, so none of this is visible at 0.01 deg.
- **No terrain.** "Up" here means above the horizontal plane of the sphere at the site. Whether a
  ridge hides the body is the skyline's job, and this fixture says nothing about it.
- **Horizons' daylight and "interfering body" markers** are in the raw replies but not in the
  rows: their exact rule for a site with non-zero altitude was not verified.

## Regenerating or extending

Edit `sets.json`, then:

```
node tests/fixtures/horizons/ephemeris-check/fetch.mjs            # fetches only what is new
node tests/fixtures/horizons/ephemeris-check/fetch.mjs --refresh  # asks Horizons again for everything
node tests/fixtures/horizons/ephemeris-check/check.mjs
python3 -I tests/fixtures/horizons/ephemeris-check/spice_crosscheck.py --sensitivity --write
```

Never edit `data/*.json` by hand: `check.mjs` will reject rows that differ from the raw replies.
Horizons answers one request at a time; `fetch.mjs` waits between requests and needs about a
minute for the full set. The SPICE script needs `spiceypy` and 46 MB of kernels in
`scripts/.cache/ephemeris-check/` (git-ignored); its docstring has the commands.
