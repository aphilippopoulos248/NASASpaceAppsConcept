# T-14 handover: PGDA 69 average sunlight and Earth visibility

Owner: @ice-targets. Module `src/science/polarAverages.ts`, data `public/data/heatmap/`,
builder `scripts/build-heatmap.mjs`. What the product contains is recorded separately in
`T-14-pgda69-findings.md`.

## The one thing every label must say

These are **multi-year averages**, not the geometry of the date on screen. A value is the share
of time, over hourly steps spanning 18.6 years (one lunar nutation cycle; the files do not give
the calendar dates), in which **any part** of the Sun's disc (or Earth's disc) is above the
terrain horizon. It is not an energy fraction, and Earth visibility is geometric (a sliver of
Earth counts), not a radio link. Ready-made wording: `index.quantities[q].label`,
`.meaning`, `index.averagingPeriod`, `index.caveats`, `index.citation`, and the `text` of a
point reading.

## What to call

```ts
import { loadPolarAverage, loadPolarAverageIndex, polarAverageAt, polarAverageUv } from './science/polarAverages';

const map = await loadPolarAverage('illumination', 'S', 'wide');   // or 'earth-visibility', 'N', 'detail'
map.data          // Uint8Array, size x size, row 0 first: 0 = never lit, 1..100 = percent of time
map.size          // 1605 (wide) or 2529 (detail)
map.info          // halfWidthM, latCompleteTo, latCornersTo, source, processing, stats, checks...
map.percentAt(lat, lon)   // value of the cell that contains the point, NaN outside
map.pixelOf(lat, lon) / map.latLonOf(x, y)

const r = await polarAverageAt('illumination', lat, lon);
// { available, percent, neverLit, cellM, layerId, sourceProduct, text }
// r.text is a full sentence, e.g. "Any part of the Sun's disc is above the terrain horizon 81 % of
// the time here (multi-year average over 18.6 years, mean of a 120 m cell, NASA PGDA product 69; not
// the Sun's position on the date shown)."  Away from the poles: available = false and the text says why.
```

Runs in the browser, in a worker and under vitest (same file readers as `src/terrain`).

### As a texture

```ts
const tex = new DataTexture(map.data, map.size, map.size, RedFormat, UnsignedByteType);
tex.flipY = false; tex.unpackAlignment = 1; tex.minFilter = tex.magFilter = LinearFilter; tex.needsUpdate = true;
// sampled value * 255 = percent (0..100)
```

Texture coordinates of a point (also exported as `polarAverageUv(pole, lat, lon, halfWidthM)`):

```
colat = 90 + lat (south) or 90 - lat (north), degrees
r = 2 * 1737400 * tan(colat / 2) / (2 * map.info.halfWidthM)
u = 0.5 + r * sin(lon)
v = 0.5 - r * cos(lon)   south        v = 0.5 + r * cos(lon)   north
```

Draw only where 0 <= u, v <= 1 and the fragment is in that hemisphere. `halfWidthM` is 770 400
(wide) and 151 740 (detail).

The detail layer is 2529 cells on a side. Where one texture must stay smaller,
`map.texture(2048)` returns `{ data, size, metresPerPx, halfWidthM, factor }`: here 1265 cells of
240 m, merged about the pole as area-weighted means (0 still means never lit), with the
`halfWidthM` to use in the formula above (151 800). A map that already fits is returned
untouched. Point values should still come from `percentAt()`. Checked in headless Chromium: an R8 texture built from `map.data`
reads back the stored byte at the expected texel.

## Packaged files (13.41 MB added, largest 2.77 MB)

| Layer | Source product | Cells | Complete to | Corners to | Size |
| --- | --- | --- | --- | --- | --- |
| south illumination detail | AVGVISIB_85S_060M_201608 (60 m, 2x2 means) | 2529 px, 120 m | 85S | 83S | 2.39 MB |
| south illumination wide | AVGVISIB_65S_240M_201608 (240 m, 4x4 means) | 1605 px, 960 m | 65S | 55.2S | 1.19 MB |
| south Earth visibility detail | AVGVISIB_85S_060M_201608_EARTH | 2529 px, 120 m | 85S | 83S | 1.98 MB |
| south Earth visibility wide | AVGVISIB_65S_240M_201608_EARTH | 1605 px, 960 m | 65S | 55.2S | 0.70 MB |
| north illumination detail | AVGVISIB_85N_060M_201608 | 2529 px, 120 m | 85N | 83N | 2.77 MB |
| north illumination wide | AVGVISIB_65N_240M_201608 | 1605 px, 960 m | 65N | 55.2N | 1.22 MB |
| north Earth visibility detail | AVGVISIB_85N_060M_201608_EARTH | 2529 px, 120 m | 85N | 83N | 2.41 MB |
| north Earth visibility wide | AVGVISIB_65N_240M_201608_EARTH | 1605 px, 960 m | 65N | 55.2N | 0.74 MB |

Source: https://imbrium.mit.edu/EXTRAS/ILLUMINATION/IMG/ (IMG + PDS label per product), listed
on https://pgda.gsfc.nasa.gov/products/69 . Values are stored as whole percents (the source has
0.004 % steps); 0 is reserved for cells in which no source pixel is ever lit.

Not packaged: the 60 m and 240 m maps at full resolution (51 and 82 MB each), the 75-degree /
120 m maps, the permanent-shadow masks, sky visibility. Nothing exists equatorward of 55.2
degrees, and between 65 and 55.2 degrees only the corners of the square.

## Check values

- Recorded from the source files at build time (`checks` and `brightest` of each layer in
  `index.json`) and asserted by the tests against the packaged maps, with the projection written
  out a second time in the test. A live test (`LUNYX_LIVE=1`) re-read the same 44 source pixels
  from the server by range request: all as recorded.
- Shackleton's floor (89.67S 129.78E): 0 % sunlight in both layers (permanent shadow), Earth
  never in view.
- The brightest pixel of the 60 m south map is 88.4 % at 89.4749S 137.443W, on the ridge between
  Shackleton and de Gerlache, where Mazarico et al. (2011) place the most illuminated
  south-polar site (89.45S 222.69E). Its 120 m cell holds 81 %. The 240 m map peaks at 93.5 % at
  89.4455S 137.314W; its 960 m cell holds 60 %.
- North: brightest 60 m pixel 89.7 % at 89.3673N 128.142E (120 m cell: 67 %).
- Earth visibility at 70 degrees on the near-side meridian: 100 % (both poles); at 70 degrees
  on the far-side meridian: 0 %.
- Orientation, from data that does not share the projection code: mean Earth visibility
  2 to 12 degrees from the pole is 62 % (S) and 74 % (N) in the near-side sector against 4 % in
  the far-side sector; never-lit cells lie 824 m (S) and 697 m (N) below their surroundings in
  the whole-Moon LOLA grid, and 21 to 29 m when east and west are swapped.

## Limits to show

- Averaged cells dilute small bright spots (numbers above). The value is the mean of the cell,
  not of the exact point.
- The 60 m and 240 m source maps were computed from different elevation models and disagree in
  detail: at 89.45S 137.31W the 240 m map says 93 % while the 60 m map's pixel there is in
  permanent shadow (its own peak is 0.8 km away).
- "EXTRAS" products: "not supported by the PDS or the LOLA Science Team"; some maps show linear
  artefacts inherited from the elevation models.
