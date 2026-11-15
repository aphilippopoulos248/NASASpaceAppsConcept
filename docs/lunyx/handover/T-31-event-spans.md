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
4. An end outside the window says so ("after the analysed window"); an unresolved end is "not found
   within 60 days", never a time.
5. Earth figures say which definition: "Earth's centre in view 88.9 %" and "any part of Earth's disc
   in view ..." (the IM-2 centre figure is from `docs/lunyx/validation.md`, section 4).

Example sentences from real results: section 6 (added with the implementation commit).

## 5. Where consumers quote a single instant or an unlabelled time today (integration 2ade856)

None of these is changed by @events (D-1 of lunyx-science: consumers' files belong to their owners).

| File and line | Owner | What it shows now | What D-8 needs from the new fields |
| --- | --- | --- | --- |
| `src/core/skyEvents.ts:27-32` (`EVENT_INFO`) | @globe | One label per event type, each naming its own instant ("Sun fully set") | The other end comes from `e.span`; labels for it in `TRANSITION_WORDS` |
| `src/core/analysisReport.ts:141` and `:170-171` (`nextEvents`, `events` of getAnalysis) | @globe | `{ label, timeUtc, azDeg, inHours }`: one instant | Add the span (kind, start and end times and edges) so the assistant can say "starts setting ..., fully set ..."; `:155` add `earthAnyPct` beside `earthVisiblePct` |
| `src/core/coreActions.ts:249-273` (`jumpToEvent`) | @globe | Jumps to and reports one instant (labelled) | Report the span of the event jumped to |
| `src/ui/shared/timeScrubber.ts:128-130, 166-172` (jump buttons, marks) | @globe | One mark and one time per event, labelled with its instant | Draw/describe the span (first cut to last limb); grazes from `transitions` |
| `src/ui/globe/siteCard.ts:106, 258, 261` ("Earth in view") | @globe | Earth's centre figure, in the same card as PGDA's "Any of Earth in view" (`src/ui/science/siteScience.ts:239`) | Label it "Earth's centre in view" and add `earthAnyPct` ("any part of Earth's disc") |
| `src/assistant/deterministic/intents.ts:484` | @assistant | "Moved the clock to the next sunset: HH:MM UTC" | Name the instant and the other end |
| `src/assistant/deterministic/intents.ts:495` | @assistant | "The next sunset is at HH:MM UTC": an **unlabelled sunset time** | "The Sun starts setting ... and is fully set ... UTC" from the span |
| `src/ui/compare/model.ts:159, 180-193` ("Next sunset" rows) | @analysis | A time labelled "Next sunset", defined in the hint | Both ends; `earthAnyPct` row if wanted |
| Surface key metrics and countdowns (original T-10, `src/ui/surface/**`, not yet integrated) | @surface | Countdowns to the next sunset / sunrise / Earthset / Earthrise | "starts setting ..., fully set ..." from `nextEvents(a, t)[type].span`, or `nextTransitions(a, t)` near the window edge |

## 6. Verification and example sentences

Added with the implementation commit.
