# T-31 items 2 and 3: both ends of every rise and set, and Earth by disc (UI contract)

Owner: @events (project lunyx-science, task T-2), on `am/lunyx-science/agent/events`.
Decision D-8 of the Lunyx hub: wherever Lunyx reports a sunset, sunrise, Earthset or Earthrise it
says which instant it means, and a set is shown as "starts setting HH:MM, fully set HH:MM UTC".
Earth visibility figures say "Earth's centre" wherever they sit next to PGDA's long-term map,
which counts any part of Earth's disc.

Everything below is **additive**. No existing field, event or function changes its meaning or its
value; every new field is optional in `src/analysis/types.ts`, so code that builds these objects
by hand (tests, `src/assistant/testing/fakeApp.ts`) still compiles. The science entry points are
in `src/analysis/api.ts`; consumers import from there and from `./types` only.

## 1. Which instant each existing field is (unchanged)

| Field | Instant / meaning |
| --- | --- |
| `SkyEvent` type `sunrise` | The **first part** of the Sun's disc appears above the terrain skyline ("Sun starts rising" in `src/core/skyEvents.ts`) |
| `SkyEvent` type `sunset` | The **last part** of the Sun's disc goes behind the terrain skyline ("Sun fully set") |
| `SkyEvent` type `earthrise` / `earthset` | The **centre** of Earth's disc crosses the skyline ("Earth's centre rises / sets") |
| `nextEvents(a, t)` | The first event of each type after `t`, **inside the analysed window**; null when none is |
| `metrics.sunAnyPct` | Share of the window with any part of the Sun above the skyline and not wholly behind Earth |
| `metrics.illuminationPct` | Time-averaged visible fraction of the Sun's disc (terrain and Earth's eclipses) |
| `metrics.earthVisiblePct`, `longestEarthGapH`, `earthIntervals`, `earthGapIntervals`, `longestEarthGapFull` | Line of sight to **Earth's centre** |
| `series.sunVisible` / `series.earthVisible` | Fraction of each disc above the skyline, per sample (the Sun's also net of Earth covering it) |
| `blockageAt(...).blocked` | About the **centre** only; `discVisibleFraction` says how much of the disc shows |

Rise and set times are against the terrain skyline (eye height = mast height above the ground),
airless, refined to 10 s; Earth in front of the Sun is an eclipse (`metrics.eclipseIntervals`), never
a sunset.

## 2. New: passages through the skyline (item 2)

A rise or a set takes time: about an hour for the Sun at mid latitudes, many hours near the poles,
and a day or more for Earth (four times wider, slow in the lunar sky). Each **passage** of a disc
through the skyline is the span in which the disc is neither wholly clear of the skyline nor wholly
behind it.

```
whole disc clear --first cut--> partly hidden --last limb--> wholly hidden        kind 'set'
wholly hidden --first limb--> partly visible --whole disc clear--> clear         kind 'rise'
clear --first cut--> partly hidden --whole disc clear--> clear (never fully set)  kind 'graze'
hidden --first limb--> partly visible --last limb--> hidden (never fully risen)   kind 'peek'
```

### Types (`src/analysis/types.ts`)

| Field | Type | Unit | Meaning |
| --- | --- | --- | --- |
| `SiteAnalysis.transitions` | `SkyTransition[]` | | Every passage of the Sun and Earth overlapping the window, sorted by start. Empty when there is no skyline |
| `SkyEvent.span` | `SkyTransition` | | The passage this event is one instant of (the same object as in `transitions`). On every event of `analyse()` |
| `SkyTransition.body` | `'sun' \| 'earth'` | | |
| `SkyTransition.kind` | `'set' \| 'rise' \| 'graze' \| 'peek' \| 'unresolved'` | | As drawn above; `'unresolved'` when an end was not found (below) |
| `SkyTransition.start` | `{ timeMs, azDeg, inWindow, edge }` | UTC ms, deg | `edge`: `'first-cut'` (set, graze), `'first-limb'` (rise, peek) or `'unresolved'` |
| `SkyTransition.end` | `{ timeMs, azDeg, inWindow, edge }` | UTC ms, deg | `edge`: `'last-limb'` (set, peek), `'whole-clear'` (rise, graze) or `'unresolved'` |
| `SkyTransition.hours` | `number` | h | `end - start` (a lower bound when an end is unresolved) |
| `SkyTransition.centre` | `{ timeMs, azDeg, inWindow, up }[]` | | The disc's centre crossing the skyline during the passage, in time order. For Earth these are the `earthrise` / `earthset` events (inside the window). Earth near the skyline can cross several times in one passage |
| `SkyTransition.minVisibleFraction`, `maxVisibleFraction` | `number` | 0..1 | Least / largest fraction of the disc above the skyline at the analysis' samples in the window during the passage (NaN if no sample falls inside). Graze: at most `1 - min` of the disc is hidden; peek: at most `max` shows |
| `SkyTransition.limitDays` | `number` | days | How far beyond a window edge an end was searched |

How the existing events map onto passages:

| Event | Where it sits in its `span` |
| --- | --- |
| `sunset` | `span.end` (edge `'last-limb'`), `span.end.timeMs === event.timeMs`; `span.kind` is `'set'` (or `'peek'` if the Sun was never wholly clear) |
| `sunrise` | `span.start` (edge `'first-limb'`), `span.start.timeMs === event.timeMs`; kind `'rise'` (or `'peek'`) |
| `earthset` / `earthrise` | One entry of `span.centre` with the same `timeMs` (`up` false / true); kind any of the four |

`inWindow: false` on an instant means it lies before or after the analysed window and was found by
following the passage with the in-app model (up to 60 days, as `longestDarknessFull` does). Edge
`'unresolved'` means not found within that limit; its `timeMs` is where the search stopped, and must
not be shown as an event time. Grazes and peeks of the Sun usually have no event at all (a graze never
hides the disc); they appear only in `transitions`.

### Functions (`src/analysis/api.ts`)

| Function | Returns |
| --- | --- |
| `nextTransitions(a, timeMs)` | `{ sun: SkyTransition \| null, earth: SkyTransition \| null }`: the passage of each body in progress at `timeMs` (`start <= timeMs < end`), else the next one to start after it. Unlike `nextEvents` it also returns passages whose end lies beyond the window |
| `transitionSummary(tr)` | The D-8 short form, `starts setting YYYY-MM-DD HH:MM, fully set HH:MM UTC` (the second date written out when the ends fall on different UTC days; grazes: `partly hidden ... to ... UTC, never fully set`) |
| `transitionText(tr)` | One full sentence naming each instant |
| `eventText(e)` | An event with its span: `Sunset: starts setting ..., fully set ... UTC` |
| `TRANSITION_WORDS` | The label and clause of each edge per body, for buttons and marks |

## 3. New: Earth by disc (item 3)

| Field | Type | Unit | Meaning |
| --- | --- | --- | --- |
| `metrics.earthAnyPct` | `number` | % of window | Any part of Earth's disc above the skyline: PGDA product 69's definition. Always >= `earthVisiblePct` |
| `metrics.longestEarthAnyGapH` | `number` | h | Longest spell with Earth's disc wholly hidden (lower bound if `earthAnyGapOpenEnded`). Always <= `longestEarthGapH` |
| `metrics.earthAnyGapOpenEnded` | `boolean` | | That spell runs into a window edge |
| `metrics.earthAnyIntervals`, `earthAnyGapIntervals` | `Interval[]` | | The spans with some / none of Earth's disc above the skyline |
| `metrics.longestEarthAnyGapFull` | `FullSpan` | | That spell followed past the window edges (as `longestEarthGapFull`) |
| `OutlookRow.earthAnyPct` | `number` | % of row | Per lunar day of `outlook()` |
| `ComparisonDiff.earthAnyPct` | `number` | points | B minus A |

These are filled for `analyse()`, every nearby candidate's `metrics` and every outlook row. The
centre figures stay as they are; the two are shown side by side, labelled "Earth's centre" and "any
part of Earth's disc".

## 4. Wording rule

1. Never a rise or set time without its instant. A set is "starts setting HH:MM, fully set HH:MM UTC"
   (D-8); a rise "starts rising HH:MM, fully risen HH:MM UTC"; for Earth the centre may be named in
   between ("centre sets HH:MM"), because `earthset` is that instant.
2. A single instant is quoted only with its label: "Sun fully set 19:30 UTC", never "sunset 19:30".
3. Grazes and peeks are not sets or rises: "partly hidden from ... to ..., never fully set".
4. An end outside the window says so ("after the analysed window"); an unresolved end gets no time:
   "began more than 60 days before the analysed window", "not over within 60 days after the analysed
   window" (or, where nothing was followed, "already under way when the analysed window starts").
5. Earth figures say which definition: "Earth's centre in view 88.9 %" and "any part of Earth's disc
   in view ..." (the IM-2 centre figure is from `docs/lunyx/validation.md`, section 4).

Example sentences from real results: section 6 (added with the implementation commit).

## 5. Where consumers quote a single instant or an unlabelled time today (integration bbaa93d)

None of these is changed by @events (D-1 of lunyx-science: consumers' files belong to their owners).
Since T-33 most of them label the one instant they show ("Sun fully set"); what D-8 still needs is
the other end, which `span` / `nextTransitions` now provide.

| File and line | Owner | What it shows now | What D-8 needs from the new fields |
| --- | --- | --- | --- |
| `src/core/skyEvents.ts:27-32` (`EVENT_INFO`) | @globe | One label per event type, each naming its own instant ("Sun fully set") | The other end comes from `e.span`; labels for it in `TRANSITION_WORDS` |
| `src/core/analysisReport.ts:141` and `:170-171` (`nextEvents`, `events` of getAnalysis) | @globe | `{ label, timeUtc, azDeg, inHours }`: one instant | Add the span (kind, start and end times and edges) so the assistant can say "starts setting ..., fully set ..."; `:155` add `earthAnyPct` beside `earthVisiblePct` |
| `src/core/coreActions.ts:249-273` (`jumpToEvent`) | @globe | Jumps to and reports one instant (labelled) | Report the span of the event jumped to |
| `src/ui/shared/timeScrubber.ts:128-130, 166-172` (jump buttons, marks) | @globe | One mark and one time per event, labelled with its instant | Draw/describe the span (first cut to last limb); grazes from `transitions` |
| `src/ui/globe/siteCard.ts:106, 258, 261` ("Earth in view") | @globe | Earth's centre figure, in the same card as PGDA's "Any of Earth in view" (`src/ui/science/siteScience.ts:239`) | Label it "Earth's centre in view" and add `earthAnyPct` ("any part of Earth's disc") |
| `src/ui/surface/metricsModel.ts:73-86, 139-160` (countdowns) | @surface | "Sunset in 3 h ..." with the instant named in `instant` / `detail` ("Sunset at HH:MM UTC: the last limb ...") | "starts setting HH:MM, fully set HH:MM UTC" from `next[type].span` (or `transitionSummary`); near the window's end `nextTransitions(a, t)` still has the passage when `nextEvents` returns null |
| `src/ui/surface/metrics.ts:94-95, 180` ("Earth's centre in sight") | @surface | Already labelled Earth's centre | `earthAnyPct` beside it if wanted |
| `src/assistant/deterministic/intents.ts:444, 484` | @assistant | "Moved the clock to the next sunset: HH:MM UTC" | Name the instant and the other end |
| `src/assistant/deterministic/intents.ts:495` | @assistant | "The next sunset is at HH:MM UTC": an **unlabelled sunset time** | "The Sun starts setting ... and is fully set ... UTC" from the span (once `analysisReport.ts` passes it) |
| `src/ui/compare/model.ts:160, 187-200` (event rows) | @analysis | Labelled single instant ("Sun fully set") | Both ends; `ComparisonDiff.earthAnyPct` row if wanted |

## 6. Verification and example sentences

### How the new instants are found

- **First cut / whole disc clear** (both bodies): the lowest point of the disc, over the same 24
  strips `discVisibility()` integrates (`bottomClearance`, exactly when the visible fraction is 1),
  crossing the skyline; sampled at the analysis' step and refined to 10 s like the existing events.
  The strips nearest the centre sit 1/24 of a radius off it, so the disc is tested 0.09 % of a radius
  (0.0002 deg for the Sun) short of its true lowest point: about 2 s of time where the Sun moves
  0.48 deg an hour (Blue Ghost), over a minute where it climbs a hundredth of a degree an hour.
- **First and last limb**: for the Sun, the existing `sunrise` / `sunset` events, unchanged; for
  Earth, the ends of `metrics.earthAnyIntervals` (same sampling and refinement).
- **Centre**: Earth's `earthrise` / `earthset` events, unchanged; the Sun's computed the same way.
- **Beyond the window**: followed with the in-app model in 20 min (Sun) / 60 min (Earth) steps up to
  60 days, as `longestDarknessFull` is.
- **Limits**: terrain skyline only (eclipses are separate); a graze or peek shorter than the
  sampling step can be missed, as can an event; `min/maxVisibleFraction` are sample values.

### Against the independent validation (`tests/fixtures/validation/ephemeris-check/events/results.json`)

Run on am/lunyx/integration 2ade856 plus this work, `npx vitest run src/analysis/transitions.test.ts`
(the instants are printed with `--silent=false`). The validator's skyline is its own ray march at
0.1 deg with 61 strips; its "half hidden" is half of the disc's area, which equals the centre
crossing only where the skyline runs straight across the disc.

| Site, eye height | Instant | Validator (UTC) | App | App minus validator |
| --- | --- | --- | --- | --- |
| Blue Ghost 1, 0.5 m (Horizons table) | first cut | 2025-03-16 18:09:45 | 18:09:42 | -3 s |
| | centre / half hidden | 18:42:57 | 18:42:59 | +2 s |
| | last limb (`sunset`) | 19:16:07 | 19:16:06 | -1 s |
| Blue Ghost 1, 2 m | first cut | 18:23:40 | 18:23:36 | -4 s |
| | centre / half hidden | 18:56:53 | 18:56:53 | 0 s |
| | last limb (`sunset`) | 19:30:03 | 19:30:00 | -3 s |
| Blue Ghost 1, 5 m | first cut | 18:51:31 | 18:51:34 | +3 s |
| | centre / half hidden | 19:24:45 | 19:24:42 | -3 s |
| | last limb (`sunset`) | 19:57:57 | 19:57:59 | +2 s |
| Chandrayaan-3, 2 m (model) | first cut | 2023-09-04 04:53:35 | 04:53:51 | +16 s |
| | last limb (`sunset`) | 08:02:23 | 08:02:17 | -6 s |
| | first limb (`sunrise`) | 2023-09-19 23:57:08 | 23:56:40 | -28 s |
| | whole disc clear | 2023-09-20 02:42:19 | 02:41:49 | -30 s |

So the Sun takes 66 min to set at Blue Ghost (2 m), 3 h 8 min at Chandrayaan-3 and 6 h 35 min at
IM-2. Firefly's start of night at Blue Ghost (about 18:15-18:35 UTC, D-8) falls at the first cut,
18:23. These Blue Ghost times rest on the elevation data of 2ade856: the T-32 easing of the 3 m site
models (lunyx-science T-1, not integrated here) moves this sunset, so the test allows 20 min and the
table above will change with it.

### Earth by disc

| Window | Earth's centre in view | Any part of Earth's disc | Longest gap: centre / whole disc hidden |
| --- | --- | --- | --- |
| IM-2, 14 days from 2025-03-06 17:28 UTC, 2 m (Horizons table) | 88.90 % | 97.04 % | 37.3 h / 9.9 h (both run into the window's end) |
| Blue Ghost 1, 15 days from landing, 2 m | 100 % | 100 % | 0 h / 0 h |

IM-2's Earthset (centre 2025-03-19 04:09:38 UTC; validator 04:07:45) sits in a passage from
2025-03-18 06:25 to 2025-03-20 07:31 UTC: Earth's disc takes 49 h to set there.

### Earth by disc over 18.6 years, against the validator and PGDA product 69

The window of the validator's check 3 (2010-01-01 00:00 UTC + 163 044 h, hourly; its own figures
and PGDA's pixels are in `tests/fixtures/validation/ephemeris-check/illumination/results.json`).
"Own" is the validator's computation on the same elevation data (SPICE Earth against its own 0.1 deg
skyline, share of hourly instants); PGDA is `AVGVISIB_85S_060M_201608_EARTH` (60 m pixels, any part of
the disc, span and height not stated). Opt-in test, about 12-48 s per run here:
`LUNYX_LONG=1 npx vitest run src/analysis/transitions.test.ts -t "18.6 years" --silent=false`.

| Point | Eye | Earth's centre: app / own | Any part of the disc: app / own | PGDA pixel (3 x 3 around it) | App any part minus PGDA | App any part minus centre |
| --- | --- | --- | --- | --- | --- | --- |
| IM-2 | 0 m | 80.80 / 80.80 % | 92.44 / 92.46 % | 92.26 % (84.26-93.00) | +0.18 | 11.64 |
| IM-2 | 2 m | 81.12 / 81.12 | 93.31 / 93.34 | 92.26 | +1.05 | 12.19 |
| Shackleton rim pin | 0 m | 18.02 / 18.03 | 25.23 / 25.23 | 29.31 (15.68-55.03) | -4.08 | 7.21 |
| Shackleton rim pin | 2 m | 30.76 / 30.77 | 35.99 / 35.99 | 29.31 | +6.68 | 5.23 |
| Connecting ridge pin | 0 m | 34.55 / 34.55 | 39.48 / 39.49 | 57.94 (0.00-57.94) | -18.46 | 4.93 |
| Connecting ridge pin | 2 m | 53.58 / 53.60 | 58.24 / 58.25 | 57.94 | +0.30 | 4.67 |
| Ridge top (PGDA's brightest pixel) | 0 m | 53.02 / 53.03 | 57.65 / 57.67 | 58.08 (50.38-58.09) | -0.43 | 4.64 |
| Ridge top | 2 m | 53.49 / 53.50 | 58.16 / 58.17 | 58.08 | +0.08 | 4.66 |
| Rim top (brightest on Shackleton's rim) | 0 m | 49.28 / 49.28 | 53.83 / 53.83 | 56.68 (42.32-56.68) | -2.85 | 4.55 |
| Rim top | 2 m | 52.15 / 52.15 | 56.80 / 56.80 | 56.68 | +0.12 | 4.65 |

- The new figure reproduces the validator's own any-part figure within 0.03 points in all ten cases
  (the test fails above 0.5), so the definition and the code agree with an independent computation.
- PGDA reads 4.4 to 11.1 points above the app's centre figure at the 2 m points other than the rim
  pin; with the any-part definition the difference drops to 0.1-1.1 points at those four. That is the
  "4 to 11 points by definition" of the validation, now shown as a like-for-like figure.
- Where PGDA's own neighbouring pixels differ by tens of points (the rim pin, 15.7-55.0; the
  connecting ridge pin, 0-57.9) a single-pixel comparison proves nothing, and on the ground at crest
  points any grid point has rising ground somewhere (validation README, check 3): not forced to agree.

### Example sentences (real results, `eventText` / `transitionText` / `transitionSummary`)

- Blue Ghost 1, 2 m: `Sunset: starts setting 2025-03-16 18:23, fully set 19:30 UTC`
- IM-2, 2 m: `Sunset: starts setting 2025-03-19 16:42, fully set 23:17 UTC`
- IM-2, 2 m: `Earthset: starts setting 2025-03-18 06:25, centre sets 2025-03-19 04:09, fully set 2025-03-20 07:31 UTC`
- Chandrayaan-3, 2 m: `The Sun: starts rising 2023-09-19 23:56, fully risen 2023-09-20 02:41 UTC (from the moment the first part of the Sun's disc appears above the terrain skyline to the moment the whole disc is clear of it).`
- A graze (synthetic skyline in the tests): `partly hidden from 2026-01-10 19:26, whole disc clear again 2026-01-11 16:33 UTC; never fully set`

Times are written to the minute, truncated (as `utcMinute` elsewhere in the science core).
