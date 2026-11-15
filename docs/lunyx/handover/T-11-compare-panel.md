# T-11 Compare panel: handover (@analysis)

Branch am/lunyx/agent/analysis. Code in `src/ui/compare/`. Screenshots: `screens/t11-*.png`.
Delivered in slices; this note grows with each one.

| Slice | What | State |
|---|---|---|
| 1 | A/B side by side, delayed arrival, mast heights, shared clock, saved comparisons | done |
| 2 | Nearby alternatives (`rankNearby`, `selectCandidate`) | done |
| 3 | Mission-window table, CSV / JSON export (`exportResults`) | done |
| 4 | Seasonal outlook chart (`showOutlook`) | done |

## How it is put together

- `panel.ts`: the launcher ("Compare", top left; top right on phones), the sheet, the tabs and the
  keyboard handling. The sheet is open while `store.comparing` is true. Escape closes it first
  (before the site card or the surface view react); keys pressed inside it do not reach the
  window listeners. Beside the assistant drawer on wide screens, hidden behind it on phones.
- `abTab.ts`: the "A and B" tab. `model.ts`: the rows and sentences, as pure functions of the
  science core's results (tested without a browser). `storage.ts`: localStorage.
  `actions.ts`: the registered actions. `widgets.ts`, `format.ts`: shared pieces.
- The differences in words are `analysis.comparison().diff.highlights`, the same object the
  `compare` action reports. The B − A column is the same subtraction, shown to one decimal.
- Nothing is computed here: a missing value is a dash or "not available", a slot that is still
  being analysed says so, a failed analysis shows its reason.

## For @assistant: actions and result shapes (slice 1)

Times are UTC (`...Utc`), longitudes east-positive, units in the key names. Actions marked
"waits" resolve when both analyses have finished and the comparison is on screen.

"compare result" below means exactly what `compare {}` returns (T-25 handover): `comparing, A, B,
scenarioA, scenarioB, analysisA, analysisB, diff | error`.

### `openCompare { tab?: "compare" }` (command, returns at once)

Opens the panel (or switches its tab) without changing any scenario. More tab names come with
the later slices.

```jsonc
{ "open": true, "tab": "compare", "A": "<label>" | null, "B": "<label>" | null,
  "comparison": "idle" | "loading" | "ready" | "error", "emptySlots": ["A", "B"] /* when idle */ }
```

Close with the existing `stopCompare {}`.

### `compareDelayedArrival { delayH?: number = 24, basis?: "A" | "current" }` (command, waits)

B becomes A arriving `delayH` hours later (0.1 to 720) at the same site, same window length and
mast. A is the scenario saved in slot A; when slot A is empty (or with `basis: "current"`) the
scenario on screen is saved as A first. The scenario on screen and `delayH` in the app state
are **not** changed.

```jsonc
{ /* compare result */, "basis": "A" | "current", "delayH": 24,
  "plannedArrivalUtc": "2025-03-06T17:28Z", "revisedArrivalUtc": "2025-03-07T17:28Z" }
```

### `compareMastHeights { heightBM: number, heightAM?: number, basis?: "A" | "current" }` (command, waits)

B becomes A with a `heightBM` metre mast (0 to 100), same site and window. With `heightAM`, A
gets that height too. The mast height of the scenario on screen is not changed. Two equal
heights are refused.

```jsonc
{ /* compare result */, "basis": "A" | "current", "mastHeightAM": 2, "mastHeightBM": 10 }
```

### `swapComparison {}` (command, waits when both slots are filled)

Compare result with the sides exchanged (the automatic labels are rewritten); with one slot
empty just `{ "A": ..., "B": ... }`.

### `clearComparison { slot?: "A" | "B" }` (command)

Empties one slot, or both without `slot`. Returns `{ "A": "<label>" | null, "B": ... }`.

### `saveComparison { name?: string }` (command)

Keeps the pair under a name in this browser, with the simulated clock and the requirements.
Default name "<A> vs <B>"; the same name replaces; at most 20.

```jsonc
{ "saved": { "name", "savedUtc", "A": "<site, arrival, window, mast>", "B": "...", "clockUtc" },
  "replaced": false, "droppedOldest"?: "<name>", "count": 1,
  "keptInBrowserStorage": true, "note"?: "…no storage, lasts until the page is closed" }
```

### `loadComparison { name: string }` (command, waits)

Puts the pair back exactly (same scenario ids, so the same analyses), restores the clock
(paused) and the requirements, opens the comparison.

```jsonc
{ /* compare result */, "loaded": "<name>", "savedUtc": "...",
  "restored": { "clockUtc": "2025-03-08T00:00Z" | null,
                "requirements": { "sunElMinDeg", "sunElMaxDeg", "maxEarthGapH", "slopeLimitDeg" } | null } }
```

### `deleteComparison { name }` → `{ "deleted", "count" }`; `listComparisons {}` (query)

```jsonc
{ "comparisons": [ { "name", "savedUtc", "A", "B", "clockUtc" } ], "keptInBrowserStorage": true }
```

### Labels

Automatic labels name what differs: "IM-2 Athena (earlier arrival)" / "IM-2 Athena (arrival 24 h
later)", "(2 m mast)" / "(10 m mast)". When A carries a label somebody typed ("Baseline"), a B made
from it is "Baseline (arrival 24 h later)" and `compare` keeps both.

## For @assistant: slice 2, nearby alternatives

### `rankNearby { radiusM?: number = 2000, spacingM?: number = 300, slopeLimitDeg?: number }` (command, waits)

Scans a square grid around the site on screen (the same mission window and mast), opens the
panel's "Nearby sites" tab with a progress bar, and resolves when the ranked list is on
screen. `slopeLimitDeg` also sets the app's slope limit (default: the current one). Refused
before it starts: no site, a grid of more than 2000 points, a grid holding only the site.
`radiusM` 50 to 50 000, `spacingM` 10 to 10 000.

Values from the browser check (IM-2, 24 h from touchdown, 1 km every 200 m):

```jsonc
{
  "scenario": { /* as getAnalysis.scenario: the scenario that was scanned */ },
  "options": { "radiusM": 1000, "spacingM": 200, "slopeLimitDeg": 10 },
  "scanned": 81,                        // points, the site itself included
  "rankedCount": 80,                    // alternatives within the limits, all ranked
  "reference": { "rank": 0, "id": "im-2", "name": "IM-2 Athena", "latDeg": -84.79, "lonDegEast": 29.2,
                 "distanceM": 0, "bearingDeg": null, "elevationM": 5321, "slopeDeg": 2.06,
                 "illuminationPct": 100, "longestDarknessH": 0, "earthVisiblePct": 100,
                 "longestEarthGapH": 0, "score": 100, "isReference": true, "overSlopeLimit": false },
  "betterThanReference": 0,             // alternatives scoring higher than the site; null if the site has no score
  "candidates": [ { "rank": 1, "id": "pin:-84.79660,29.20000", "name": "Candidate 200 m S of IM-2 Athena",
                    "latDeg": -84.7966, "lonDegEast": 29.2, "distanceM": 200, "bearingDeg": 180, "elevationM": 5329,
                    "slopeDeg": 2.44, "illuminationPct": 100, "longestDarknessH": 0, "earthVisiblePct": 100,
                    "longestEarthGapH": 0, "score": 100 }, /* … best first, at most 10 */ ],
  "rejected": { "slope": 0, "noData": 0 },    // alternatives left out (the site itself is not counted)
  "ranking": "score = mean of illuminationPct and earthVisiblePct over the mission window; rank 1 is the highest score",
  "basis": "Slope over 120 m from …, the same measure for every candidate. Skyline every 1 deg from …; window sampled every 30 min (scan settings, coarser than the main analysis).",
  "replacedByNewerScan"?: true          // another scan replaced this one on screen while it ran
}
// Row: { rank, id, name, latDeg, lonDegEast, distanceM, bearingDeg (null for the site itself),
//        elevationM, slopeDeg, illuminationPct, longestDarknessH, earthVisiblePct,
//        longestEarthGapH, score }     // null where a value does not exist
```

`rank` counts the alternatives only (1 = best); the site itself is `reference` with rank 0, as
in m107. Candidate ids are pin-style (`pin:<lat>,<lon>`) and names say where they are:
"Candidate 300 m W, 600 m S of IM-2 Athena".

### `selectCandidate { rank?: integer, id?: string, asB?: boolean }` (command)

Exactly one of `rank` / `id`, from the last scan. Pins the candidate as the site on screen
(kind `"candidate"`), flies the globe there (leaves the surface view if another site was shown).

```jsonc
{ "view": "globe",
  "site": { "id", "name", "kind": "candidate", "latDeg", "lonDegEast" },   // as selectSite
  "candidate": { /* Row from the scan */ },
  "scannedAround": "IM-2 Athena" }
```

With `asB: true` the candidate over the scanned window and mast becomes B (A stays; the
scanned site becomes A when slot A is empty), the comparison opens, the action waits for both
analyses and adds the compare result (`comparing, A, B, scenarioA, scenarioB, analysisA,
analysisB, diff`). Your sequence `saveScenario A → selectCandidate → saveScenario B → compare`
works too (tested). A pinned candidate gets the full analysis, finer than the scan, so its
figures can differ slightly from the list.

Errors (as `ActionError` sentences): no scan yet ("Run rankNearby first"), scan still running,
no candidate with that rank ("the last scan (around IM-2 Athena) ranked 98"), the id is the
scanned site itself.

### Wording (decision D-8)

The panel's event rows say which instant they are, in the time scrubber's words: "Sun fully
set" (last limb), "Sun starts rising" (first limb), "Earth's centre sets / rises"; the Earth
figure is "Earth's centre in view". The other end of each transition and an any-part Earth
figure come from Lunyx Science (@events, T-31 items 2-3); the panel will show them when they land.

## For @assistant: slice 3, the mission-window table and its export

### `openCompare { tab?: "compare" | "nearby" | "windows" | "outlook", table?: "current" | "A" | "B" }`

`table` chooses whose mission window the "windows" tab shows (giving it alone opens that tab);
the result then carries `"table": "B"`.

### `exportResults { format: "csv" | "json", slot?: "current" | "A" | "B" | "AB" }` (command, waits)

Waits for the analyses, builds the file and hands it to the browser as a download. Default
`slot`: whose table the "windows" tab shows (the scenario on screen unless changed).

```jsonc
{ "format": "csv", "filename": "lunyx_im-2_2025-03-06T1728Z_336h_2m.csv", "mimeType": "text/csv;charset=utf-8",
  "bytes": 2796, "scenarios": [ { "slot": "current", "label": "IM-2 Athena, arrival 2025-03-06 17:28 UTC, 14-day window, 2 m mast" } ],
  "spells": 7, "downloaded": true }
```

- CSV: one row per spell, columns `slot, scenario, site_id, site_name, lat_deg, lon_deg_east,
  mast_height_m, window_start_utc, window_end_utc, group (sun | earth), state (Sunlit | Dark |
  Earth in front of the Sun | Earth's centre in view | Earth's centre hidden), start_utc, end_utc,
  duration_h, start_found, end_found, in_window_start_utc, in_window_end_utc, in_window_h,
  runs_past_window_start, runs_past_window_end, note`. Times to the second. A spell that runs
  past an edge of the window is given in full (start/end/duration) with its in-window part
  beside it; `start_found` / `end_found` false means the search stopped 60 days out and the
  duration is a lower bound.
- JSON: `{ generator, exportedUtc, conventions, eventDefinitions, scenarios: [ { slot, scenario,
  metrics, slope, siteElevationM, events [ { type, label, timeUtc, azDeg } ], spells [ … ],
  requirements, provenance, warnings } ], comparison? }`; `comparison` is B minus A (as `compare`)
  when `slot` is `"AB"`.
- Errors: no site / empty slot, the analysis failed (its reason), "Files cannot be downloaded in
  this session" (no browser).

## For @assistant: slice 4, the seasonal outlook

### `showOutlook { months?: integer 1..60 = 12, slot?: "current" | "A" | "B" }` (command, waits)

Opens the "outlook" tab and waits for `outlook()` (a few seconds; cached afterwards). Defaults:
the span and the scenario last used (12 months, the scenario on screen). Refused when the span
would run past 2100 or the slot is empty.

```jsonc
{ "slot": "current",
  "scenario": { /* as getAnalysis.scenario */ }, "months": 12,
  "span": { "startUtc", "endUtc" }, "rowLengthDays": 29.531,
  "lunarDays": [ { "index": 1, "startUtc", "endUtc", "illuminationPct", "sunAnyPct", "earthVisiblePct",
                   "longestDarknessH", "darknessComplete", "longestEarthGapH", "earthGapComplete" } ],
  "missionH": 336,
  "planned": { "arrivalUtc", "endUtc", "slipDays": 0, "score", "illuminationPct", "earthVisiblePct", "longestDarknessH" },
  "best": { /* same */ }, "worst": { /* same */ },
  "slips": [ { /* same */, "scoreChange", "illuminationChangePct", "earthVisibleChangePct", "longestDarknessChangeH" } ],  // 1, 3, 7, 14, 28 days
  "longestDarkness": { "startUtc", "endUtc", "hours", "startFound", "endFound" } | null,
  "longestEarthGap": { /* same */ } | null,
  "scoring": "score = mean of illuminationPct and earthVisiblePct over a mission of missionH hours from each arrival (arrivals every 2 h); higher is better",
  "highlights": [ "…outlook()'s sentences…" ], "assumptions": [], "warnings": [],
  "replacedByNewerOutlook"?: true }
```

`earthVisiblePct` is Earth's centre (D-8); `illuminationPct` the time-averaged visible disc.

## Slice 2 checked in a browser (headless Chromium on the GPU, dev server, IM-2, 24 h from touchdown)

Save A → "Nearby sites" tab by keyboard (ArrowRight on the tab list) → radius 1000, spacing 200
(the field says "81 points: the site itself and 80 candidates…") → Scan: progress bar while it
runs, 19 s for 81 points on a busy machine → the list (the site itself first, then 1..80; all
100 % sunlit and Earth's centre in view in that day, so ranked by distance) → "Compare as B" on
row 1: the panel switches to "A and B" with A = IM-2 Athena, B = "Candidate 200 m S of IM-2
Athena", the candidate is the site on screen, and the sentence "The ground at Candidate 200 m
S … is 0.2 deg steeper than at IM-2 Athena (2.3 deg over 120 m vs 2.1 deg over 120 m)". The
rankNearby action returned the same rows as the screen. In the surface view the launcher sits
at the top centre; Escape closes the panel and leaves the surface view and the site as they
were. No console errors; no horizontal overflow at 390 px (the list becomes one card per site).
Screens: `t11-nearby-*.png`, `t11-candidate-as-b-*.png`, `t11-surface-1280.png`.

## Slice 1 checked in a browser (headless Chromium, dev server, IM-2, 7-day window)

Launcher → panel; delayed arrival by keyboard (type 24, Enter): result on screen in 14 s on a
busy machine, sentences and B − A equal to the `compare` action's `diff`; requirements typed
into the panel flag a breach in words ("Not met: A: the Sun's elevation leaves the required
band, 3° to 60° …"); the rows at the shared clock follow `setTime`; save → reload the page →
the pair in A and B is back, the panel stays closed; `loadComparison` gives an identical pair and
identical rows; mast heights; Escape closes the panel, keeps the site and returns focus to the
launcher; every control has an accessible name; no horizontal overflow at 390 px; no console
errors.
