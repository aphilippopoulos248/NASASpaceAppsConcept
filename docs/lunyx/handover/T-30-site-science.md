# T-30 handover: the "Site science" section and its query actions

Owner: @ice-targets. Readouts in `src/science/siteScience.ts`, section and actions in
`src/ui/science/siteScience.ts` (+ `.css`). The DSN, long-term-average and ice-target readouts
and both actions were written by @globe for T-20 (`src/core/siteScience.ts`,
`src/core/scienceActions.ts` on their branch) and moved here by agreement (m252, m255); this
task adds the Diviner and ShadowCam blocks, the standalone section and the tests.

## For @globe: mounting it

```ts
import { mountSiteScience, registerSiteScienceActions } from './ui/science/siteScience';

registerSiteScienceActions();          // at boot; safe to call more than once
mountSiteScience(el);                  // el: an empty element in the site card
mountSiteScience(el, { heading: false });   // without the "Site science" title, if your block has its own
```

- `mountSiteScience` builds the section inside `el`, imports its own CSS, reads `store.site`
  and `analysis.get('current')` itself, re-renders on site and analysis changes, hides itself
  when no site is selected, returns nothing. It also calls `registerSiteScienceActions()`.
- The action names are `getSiteScience` and `nearestIceTargets`, the same as in
  `src/core/scienceActions.ts`. A name can be registered once, so the swap is one change:
  mount this section, and delete `src/core/scienceActions.ts`, its registration in `main.ts`,
  `src/core/siteScience.ts` with its test, and the "Site science" render code in the site card.
  Until then nothing calls this module and the integrated build keeps your section.
- Width: built for the card (320 px) and for a phone (390 px); no horizontal overflow at either.
  Classes are prefixed `ss-`; it uses `ly-section-title`, `ly-kv`, `ly-note`, `ly-value` and the tokens.

## What the section shows

Screens (scratch mount with the app's styles, store, actions and analysis; arrival
2025-03-06 17:28 UTC, 24 h window): `screens/t30-im2-1280.png`, `t30-shackleton-rim-1280.png`,
`t30-shackleton-rim-390.png`, `t30-apollo-11-1280.png`, `t30-faustini-1280.png`.

1. **Deep Space Network stations** (from the current analysis): a small table, share of the
   window in view and longest gap for Goldstone, Canberra, Madrid and any station (receive
   limits), with the sentence "Geometric line of sight only: not a link budget, not a schedule,
   not antenna availability." Transmit figures and the analysis' own assumptions are behind
   "Stations, transmit limits and assumptions". While the analysis runs it shows its status.
2. **Long-term averages**, set apart by a rule and the tag "18.6-year average, not this date":
   any sunlight and any of Earth in view, percent of time and cell size.
3. **Nearest mapped ice targets**: three nearest regions with distance and bearing (or "inside
   its mapped outline"), the straight-line sentence, credit (Lemelin et al. 2021, CC BY 4.0)
   and the data notes behind a disclosure.
4. **Surface temperature (Diviner, annual)**: annual maximum and annual mean in kelvin, with
   "Not the temperature on the date shown; separate summer and winter maps are not included."
5. **ShadowCam mosaics covering this point**: up to three links (newest images first) with
   image dates and pixel scale, the rest behind the disclosure, the sentence that the images are
   not included in the app, the credit line, and the missing-licence note.

A layer with no data at the site takes no rows. One closing line names it with the reason, e.g.
for Apollo 11: "No data at this site: long-term averages (NASA PGDA product 69 maps only the
polar regions); mapped ice targets (none within 500 km: the database covers the south polar
region only); Diviner annual temperatures (the maps cover only latitudes poleward of 80°);
ShadowCam mosaics (none of the 26 controlled mosaics covers this point)."

## For @assistant: actions and result shapes

Both are queries; results are plain JSON; numbers are rounded; a value that does not exist is `null`.

### `getSiteScience {}` (waits for the site analysis)

```jsonc
{
  "site": { "id", "name", "latDeg", "lonDegEast" },
  "dsn": {                                  // unchanged from T-20
    "available": true, "windowStartUtc", "windowEndUtc", "windowDurationH",
    "stations": [ { "id": "DSS-14", "name", "complex",
                    "receive":  { "pctOfWindow", "longestGapH", "gapRunsIntoWindowEdge" },
                    "transmit": { ... }, "receiveLimitDeg", "transmitLimitDeg" } ],
    "anyStation": { "receive": { ... }, "transmit": { ... } },
    "meaning", "assumptions": []
  },                                        // or { "available": false, "reason" }
  "longTermAverages": {                     // unchanged from T-20
    "available", "sunlight": { "available", "pctOfTime", "neverInModel", "cellM", "source", "text" },
    "earthVisibility": { ... }, "kind", "averagingPeriod", "caveats": [], "citation"
  },
  "iceTargets": {                           // unchanged from T-20
    "available": true,
    "nearest": [ { "id", "label", "distanceKm", "distanceText", "insideOutline", "bearingDeg",
                   "nearestPoint": { "latDeg", "lonDegEast" }, "measuredTo", "listedAreaKm2",
                   "objectives": [], "dataFlags"? } ],
    "note"?, "mappedRegions", "distanceMeaning", "whatTheseAre", "dataNotes": [], "credit"
  },
  "surfaceTemperature": {                   // NEW: LRO Diviner, annual values
    "available": true,                      // true only when status is "ok"
    "status": "ok" | "empty" | "outside",   // empty: the published 240 m cell has no value; outside: not poleward of 80 degrees
    "annualMaxK": 226, "annualMeanK": 127,  // kelvin, or null
    "cellM": 240, "measuredOver": "July 2009 to February 2019",
    "text",                                 // a full sentence that says "annual" and names the source
    "kind", "notIncluded", "caveats": [], "citation", "licence"
  },
  "shadowCam": {                            // NEW: links only, no imagery in the app
    "available": true,                      // false when no mosaic covers the site ("mosaics": [])
    "mosaics": [ { "id", "productId", "site", "label", "text", "url",
                   "season", "localTime", "imagesFrom", "imagesTo", "pixelScaleM",
                   "archiveDisagreements"? } ],        // newest images first
    "text", "imagesBundled": false, "credit", "creditNote", "licence", "citation": [],
    "archiveUrl", "mosaicsInIndex": 26, "coverageMeaning"
  },
  "notIncluded": [ "Diviner temperatures are annual values: separate summer and winter maps are not included.",
                   "ShadowCam images are not bundled with the app: ..." ]
}
```

Any block can instead be `{ "available": false, "reason" }` if its data could not be read.
When quoting: `surfaceTemperature` is annual (never "today's temperature");
`longTermAverages` is an 18.6-year average (never the mission window); `dsn` is geometry (never
a link); `shadowCam.mosaics[].url` is a link to the archive, the app shows no image.

### `nearestIceTargets { lat?, lon?, count?, limit?, maxKm? }`

The `iceTargets` block for any point (default: the selected site), with
`"from": { "latDeg", "lonDegEast" }`. `count` (default 5, 1 to 20) and `limit` mean the same;
give one. `maxKm` defaults to 500. Give both `lat` and `lon` or neither.

## Verified

- `npm run build` passes. vitest: `src/science/siteScience.test.ts` (9) and
  `src/ui/science/siteScience.test.ts` (7), on the bundled data and the real science core:
  - IM-2, 24 h from touchdown: three stations, any station at least the best single one,
    transmit never above receive; averages 45 % sunlight and 90 % Earth visibility (120 m
    cells); nearest ice target 6.6 km; Diviner annual maximum 226 K, mean 127 K; no ShadowCam mosaic.
  - Pin on Shackleton's rim (89.686S 163.457W): averages 73 % and 52 %; Shackleton's outline
    2.5 km away; Diviner annual maximum 277 K, mean 185 K; one ShadowCam mosaic (shackleton01,
    images of 2023-02-22 to 2023-02-23, 2 m per pixel), credit and licence note present.
  - Apollo 11: DSN geometry for July 1969; no averages, no ice target within 500 km, Diviner
    status "outside", no mosaic; each block says why.
  - `nearestIceTargets`: selected site, explicit coordinates, `count` and `limit`, a point inside
    Shackleton's outline (distance 0), refusal of half a coordinate.
- Headless Chromium, scratch mount (1280 and 390 px wide): the section's figures equal the
  action's (Goldstone 59.1 %, Canberra 32.7 %, Madrid 57.2 %, any station 100.0 %; the same
  numbers @globe's T-20 screenshots show). First render after selecting IM-2 on a cold page:
  3.7 s including the analysis; a second site 0.8 to 1.9 s. Faustini's floor lists 11 mosaics
  (3 shown, 8 behind the disclosure). No horizontal overflow; headings h3/h4; links carry an
  accessible name that says they open the archive in a new tab; the section is hidden without a site.

## Not done / limits

- Not mounted in the app: that is @globe's swap (above). Until then the integrated build shows
  @globe's own section, without Diviner and ShadowCam.
- No unit test of the DOM (vitest runs without a DOM here); the rendering is covered by the
  browser check and the screenshots.
- The section sits wherever it is mounted; the surface view has none.
- Ice targets are listed to 500 km and three at a time in the section (`nearestIceTargets` gives more).
