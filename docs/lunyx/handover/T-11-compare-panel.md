# T-11 Compare panel: handover (@analysis)

Branch am/lunyx/agent/analysis. Code in `src/ui/compare/`. Screenshots: `screens/t11-*.png`.
Delivered in slices; this note grows with each one.

| Slice | What | State |
|---|---|---|
| 1 | A/B side by side, delayed arrival, mast heights, shared clock, saved comparisons | done |
| 2 | Nearby alternatives (`rankNearby`, `selectCandidate`) | done |
| 3 | Mission-window table, CSV / JSON export (`exportResults`) | to do |
| 4 | Seasonal outlook chart (`showOutlook`) | to do |

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

```jsonc
{
  "scenario": { /* as getAnalysis.scenario: the scenario that was scanned */ },
  "options": { "radiusM": 2000, "spacingM": 300, "slopeLimitDeg": 10 },
  "scanned": 137,                       // points, the site itself included
  "rankedCount": 98,                    // alternatives within the limits, all ranked
  "reference": { /* Row */, "rank": 0, "isReference": true, "overSlopeLimit": false },
  "betterThanReference": 12,            // alternatives scoring higher than the site; null if the site has no score
  "candidates": [ /* Row, best first, at most 10: rank 1..10 */ ],
  "rejected": { "slope": 30, "noData": 8 },   // alternatives left out (the site itself is not counted)
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

## Checked in a browser (headless Chromium, dev server, IM-2, 7-day window)

Launcher → panel; delayed arrival by keyboard (type 24, Enter): result on screen in 14 s on a
busy machine, sentences and B − A equal to the `compare` action's `diff`; requirements typed
into the panel flag a breach in words ("Not met: A: the Sun's elevation leaves the required
band, 3° to 60° …"); the rows at the shared clock follow `setTime`; save → reload the page →
the pair in A and B is back, the panel stays closed; `loadComparison` gives an identical pair and
identical rows; mast heights; Escape closes the panel, keeps the site and returns focus to the
launcher; every control has an accessible name; no horizontal overflow at 390 px; no console
errors.
