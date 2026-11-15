# T-23 handover: Diviner annual temperatures and the ShadowCam mosaic index

Owner: @ice-targets. What exists in the archives and why these two forms were chosen is in
`T-23-findings.md`. Decisions (coordinator, m211): build both layers below; do not bundle
ShadowCam imagery; separate summer and winter temperature maxima are out of scope.

## 1. Diviner: annual maximum and annual mean temperature

Module `src/science/polarTemperatures.ts`, data `public/data/science/diviner/`, builder
`scripts/build-diviner.mjs`.

```ts
import { polarTemperatureAt, loadPolarTemperature, loadPolarTemperatureIndex } from './science/polarTemperatures';

const r = await polarTemperatureAt(lat, lon);
// { status: 'ok' | 'empty' | 'outside', annualMaxK, annualMeanK, cellM, period, text }
// r.text, e.g.: "Annual maximum temperature 92 K, annual mean 58 K here (LRO Diviner, 240 m cell,
// measurements from July 2009 to February 2019; Schorghofer & Williams, Harvard Dataverse, CC0).
// Annual values, not the temperature on the date shown; separate summer and winter maps are not included."

const map = await loadPolarTemperature('annual-max' | 'annual-mean', 'S' | 'N');
map.data                  // Int16Array, 2533 x 2533, kelvin; map.info.noData (-32768) where there is no value
map.kelvinAt(lat, lon)    // NaN outside the map and in empty cells
map.texture(minK, maxK)   // Uint8Array for drawing: 0 = no value, 1..255 across the range you state in the legend
```

Texture coordinates are those of the PGDA maps: `polarAverageUv(pole, lat, lon, map.info.halfWidthM)`
from `./polarAverages` (half-width 304 005.5 m; the map is the circle poleward of 80 degrees
inside that square).

**Wording that must travel with the numbers** (all in `index.json` and in `r.text`): "annual
maximum" / "annual mean"; LRO Diviner, 240 m cells; Schorghofer & Williams, Harvard Dataverse
(CC0); measurements July 2009 to February 2019 (south) or January 2024 (north); **separate
summer and winter maps are not included**; not the temperature on the date shown.
`index.quantities[q].label`, `.meaning`, `index.notIncluded`, `index.caveats`, `index.citation`.

| File | Range | Empty inside 80 deg | Size |
| --- | --- | --- | --- |
| `diviner_south_annual_max_240m.lxg` | 45 to 391 K | 1.84 % | 3.24 MB |
| `diviner_south_annual_mean_240m.lxg` | 30 to 191 K | 1.84 % | 2.36 MB |
| `diviner_north_annual_max_240m.lxg` | 50 to 329 K | 0.01 % | 2.55 MB |
| `diviner_north_annual_mean_240m.lxg` | 38 to 193 K | 0.01 % | 1.40 MB |

9.54 MB added. Source: https://doi.org/10.7910/DVN/EGOOCL version 3.0, files
`polar_south_96x2/polar_south_80_{Tmax,Tmean}.grd` and `polar_north_96x2_2024/polar_north_80_{Tmax,Tmean}.grd`,
MD5-checked. The published 240 m grid is kept as it is (no resampling); temperatures are rounded
to 1 K; cells the authors left empty stay empty.

Checks:
- 30 cells recorded from the source files at build time; the tests assert the packaged values
  against them, with the projection written out a second time. A live test (`LUNYX_LIVE=1`)
  re-read the same 30 cells from Harvard Dataverse by range request: all as recorded.
- Shackleton's floor (89.67S 129.78E): annual maximum 92 K, annual mean 58 K. The pole, on the
  sunlit rim: maximum 244 K.
- The warmest annual mean of the south map (191 K) is 0.3 km from 89.78S 204.27E on Shackleton's
  rim, one of the most illuminated places at the pole.
- Orientation, against an independent product: where the PGDA 69 map says the Sun never shines,
  the annual maximum averages 101 K (south) and 122 K (north), against 253 K and 246 K where the
  Sun is up at least 30 % of the time. With east and west swapped the first figure becomes
  211 K and 221 K.

Limits: annual values only; the maximum is taken after the authors interpolate and smooth each
cell's time series, so it is not the highest single measurement; 240 m cells; nothing
equatorward of 80 degrees. The south files carry the internal title "polar_south_80_24x6"
although they come from the 96 x 2 folder (recorded in `index.json`).

## 2. ShadowCam: index of controlled mosaics, with links

Module `src/science/shadowCam.ts`, data `public/data/science/shadowcam/` (134 kB: `index.json`
60 kB, `shadowcam_coverage.lxg` 74 kB), builder `scripts/build-shadowcam-index.mjs`.

```ts
import { shadowCamMosaicsAt, loadShadowCam } from './science/shadowCam';

const r = await shadowCamMosaicsAt(lat, lon);
// { hits: [{ mosaic, label, url, text }], credit, text }
// hit.text, e.g.: "ShadowCam controlled mosaic of Shackleton Crater: local summer, about 11 am local time,
// images of 2023-02-22 to 2023-02-23, 2 m per pixel."   hit.url is the product's folder in the PDS archive.

const layer = await loadShadowCam();
layer.index.mosaics          // 26 entries: site, season, local time, image dates, pixel scale, PSR ids, links, outline...
layer.outlineLatLon(mosaic)  // the authors' bounding polygon as lat/lon, for drawing
layer.covers(mosaic, lat, lon)
```

**No imagery is bundled.** What the operator needs to decide about bundling later:

- **Licence:** no licence or usage statement was found in the archive: not in the bundle label
  (`bundle_kplo-shadowcam.xml`), not in the archive SIS (`document/archsis.pdf`, searched for
  licence, copyright, credit, terms, citation), not in the product readmes. It is a public NASA
  PDS archive (doi:10.17189/y89z-kt98, author "ShadowCam SOC").
- **Credit line:** the ShadowCam site prints "NASA/KARI/Arizona State University" under its
  images up to mid-2025 (for example the Hermite A mosaic post of 23 June 2025) and
  "NASA/KARI/Intuitive Machines" in 2026 (post of 27 October 2026). The index uses the first
  and records the second in `creditNote`.
- **Citation requested** by the product readmes: Grieser et al. (2025), LPSC 56, abstract 2523.
- If bundling is approved: each mosaic has a 20 m Cloud-Optimized GeoTIFF in the archive
  (`preview20m` in the index: 1.8 to 70 MB; Shackleton 4.6 and 4.0 MB; the one inspected is
  1246 x 1246 px of 32-bit float). An 8-bit copy of a Shackleton mosaic would be under 1 MB.

Checks:
- All 78 links (product folder, readme and 20 m version of each mosaic) answered in a live test.
- The 200 m coverage grids reproduce the area of the published footprint polygons to within
  1 % (the archive table's own area figure differs from its polygons by up to 3.4 %).
- Axes and orientation at both poles: every covered cell lies inside the latitude/longitude box
  the archive states for its mosaic (projected to a rectangle); mirrored east-west, 23 of the 26
  footprints have no cell inside their box.
- Shackleton's centre is covered by both Shackleton mosaics, Faustini's by all eleven Faustini
  mosaics, Hermite A's by both of its mosaics; the equator and the IM-2 site by none.

Things a UI should know:
- A footprint follows the image strips. Amundsen's stated centre falls in a gap of its own
  mosaic; "covered" is exact only to 200 m.
- Three entries carry `sourceDisagreements` (the archive's table and readme differ): pixel scale
  of Amundsen (2 m against 1.00 m), image count of Shoemaker (34 against 35), month of Cabeus B
  (title says August 2023, images dated 2 to 3 September 2023).
- Seasons are local to each pole and defined by the archive (`index.seasonDefinition`); local
  time is for the mosaic centre.
- None of the 28 catalogued landing sites is covered; this layer serves custom pins in or near
  the 14 shadowed sites.

## Not done

- Separate summer and winter temperature maps (out of scope by decision: they exist only as
  192.7 GB of PDS tables).
- No temperature overlay mode and no readout in the UI: @globe wires those after T-13.
- No ShadowCam imagery (see above).

## npm scripts wanted

```
"build-diviner": "node --experimental-strip-types --no-warnings scripts/build-diviner.mjs",
"build-shadowcam-index": "node --experimental-strip-types --no-warnings scripts/build-shadowcam-index.mjs"
```
