# T-20 Science readouts on the site card and as actions: handover (@globe)

Branch am/lunyx/agent/globe, on top of T-13.

## Built
- **`src/core/siteScience.ts`**: one place that gathers the readouts for a point, used by the site
  card and by the actions, so both state the same numbers with the same sources and caveats.
  - `dsnReadout(status)`: from `analysis.dsn` (T-21). Per station and for "any station": percent
    of the window in view and the longest gap, for the receive and the transmit limit, with the
    core's own `assumptions` and the sentence "Geometric line of sight only: not a link budget,
    not a schedule, not antenna availability."
  - `averagesReadout(site)`: `polarAverageAt()` for sunlight and Earth visibility (T-14), with the
    reading's own sentence, the averaging period, caveats and citation from the maps' index.
    Labelled as an 18.6-year average, never mixed with the mission-window figures. Away from the
    poles it says no map is published there.
  - `iceReadout(site, count, maxKm)`: nearest mapped regions (T-19) with distance to the outline,
    bearing, nearest point, listed area, flagged objectives and data flags, plus the
    straight-line-distance sentence, the layer's data notes (outlines about 0.3 km wider than the
    listed areas; Wiechert J's listed centre) and the Lemelin et al. 2021 CC BY 4.0 credit.
- **Site card**: a "Site science" section under the mission-window results, three blocks, each
  with its values, one sentence saying what they are and are not, and a disclosure with sources
  and limits. It ends with the line that Diviner and ShadowCam are not packaged.
- **Globe**: `showIceTargets` outlines the 169 regions (`src/scene/globe/iceOutlines.ts`), vertex
  by vertex on the drawn surface, hidden behind the limb. Checkbox and legend under Filters,
  Terrain relief.

## Actions (for @assistant)
- `getSiteScience {}` (query, waits for the analysis). Result:
  `{ site: { id, name, latDeg, lonDegEast },
     dsn: { available, windowStartUtc, windowEndUtc, windowDurationH,
            stations: [{ id, name, complex, receive: { pctOfWindow, longestGapH, gapRunsIntoWindowEdge }, transmit: {...}, receiveLimitDeg, transmitLimitDeg }],
            anyStation: { receive, transmit }, meaning, assumptions } | { available: false, reason },
     longTermAverages: { available, sunlight: { available, pctOfTime, neverInModel, cellM, source, text }, earthVisibility: {...}, kind, averagingPeriod, caveats, citation },
     iceTargets: { available, nearest: [{ id, label, distanceKm, distanceText, insideOutline, bearingDeg, nearestPoint: { latDeg, lonDegEast }, measuredTo, listedAreaKm2, objectives, dataFlags? }], mappedRegions, distanceMeaning, whatTheseAre, dataNotes, credit },
     notIncluded: [...] }`
- `nearestIceTargets { lat?, lon?, count?, maxKm? }` (query): the `iceTargets` part for any point
  (default: the selected site), with `from: { latDeg, lonDegEast }`.
- `showIceTargets { show }` (command): returns the globe display summary, now with `iceTargetsShown`.

## Verified
- `npm run build` passes; `npm test`: 438 vitest tests pass (3 skipped) and the 10 science tests.
- New tests (`src/core/siteScience.test.ts`, `src/scene/globe/iceOutlines.test.ts`), on the bundled data:
  - The most sunlit ground on Shackleton's rim (89.686S 163.457W) reads above 60 % average sunlight
    in the 120 m map; Shackleton's floor reads "never"; Tranquility Base has no map.
  - Nearest ice targets from that rim point include Shackleton within 5 km; from Apollo 11 none
    within 500 km, and the readout says the database covers the south polar region only.
  - `getSiteScience` for IM-2 on the real analysis: three stations, "any station" at least as
    much as the best single one, transmit never above receive; the result is plain JSON.
  - 169 outlines, every vertex on the drawn surface and south of 75S, hidden from over the north pole.
- Headless Chromium against `vite preview` (1280x720), arrival 2025-03-06 17:28 UTC, 24 h window:
  - IM-2 card (`screens/t20-card-im2.jpg`): Goldstone 59.1 %, Tidbinbilla 32.7 %, Robledo de Chavela
    57.2 %, any station 100.0 %; average sunlight 45 %, average Earth visibility 90 % (120 m cell);
    nearest ice targets at 6.6, 10.4 and 16.2 km.
  - Pin on Shackleton's rim (`screens/t20-card-shackleton-rim.jpg`): average sunlight 73 %, average
    Earth visibility 52 %; Unnamed PSR 107 and Shackleton both 2.5 km away. `getSiteScience`
    returned the same figures.
  - Ice-target outlines over the polar close-up with their legend (`screens/t20-ice-targets.jpg`).
- Screenshots add 0.5 MB.

## Not done, and limits
- **Diviner temperatures and the ShadowCam link (item 4)**: the data is not packaged (T-23 has
  findings only). The card and `getSiteScience` say so in one line.
- The DSN block needs a finished analysis: it shows the reason while the analysis runs or fails.
- Ice-target outlines have no labels on the globe; names are in the card's list and in the actions.
- The section sits in the globe view's site card only. The surface view's panels are @surface's.
