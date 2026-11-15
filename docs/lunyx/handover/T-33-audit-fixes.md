# T-33 Audit findings in the shell and globe view: handover (@globe)

From @assistant's first run of the UI/assistant equivalence tests (#team m254). Branch
am/lunyx/agent/globe.

## 1. Escape in the surface view only leaves the surface

Cause: the surface view and the site card both listen for keys on the window. The surface
handler ran `exitSurface`, which sets the view to "globe" at once; the card's handler then saw
"globe view, a site selected, Escape" and ran `clearSite` for the same press.

Fix, on the card's side (`src/ui/globe/cardKeys.ts`, used by `siteCard.ts`). The card acts on a
key only when
- nobody has claimed the press (`event.defaultPrevented`), and
- the globe was the view **when the key went down**: a capture-phase listener on the window
  notes the view before any other handler of that press runs.

The card also claims the presses it handles (`preventDefault`). This holds whatever the surface
handler does, and in either order of registration. @surface's half (calling `preventDefault`
when it handles Escape) is still worth having, so that both sides say "this press is mine"; it
is not needed for the bug to be gone.

Same rule, second bug it removes: with the locator map focused, an arrow key turned the globe
and also stepped the card to the next landing. The map claims its arrow keys, so the card now
leaves them alone.

## 2. "Sky at ..." always shows the last clock value

`src/core/throttle.ts`: at most one run per interval, and always one more after the last
request. The card's Sun/Earth lines use it (they skipped an update inside 250 ms and nothing drew
the final value), and so does the time scrubber's slow part (jump-button targets and the Moon's
phase line), which had the same fault.

## 3. Inventory gaps

- **`listSites { shownOnly? }`** (query): the landing catalogue, oldest first.
  `{ total, shown, listed, filter, markersOnGlobe, selectedId, sites: [{ id, name, latDeg,
  lonDegEast, program, country, landedUtc, crewed, region, positionApproximate, summary, shown }] }`.
  `shown` on a row = the current mission filters show it; `shownOnly: true` returns only those.
  `markersOnGlobe` is false when "Show previous missions" is off. Every `name` and `id` it
  lists is accepted by `selectSite`.
- **The site object** in `selectSite`, `dropPin`, `clearSite`, `enterSurface`, `exitSurface` and
  `getState` now carries, for a catalogued landing, `summary` (the card's paragraph) and
  `links: { quickMap, moonTrek }` (the card's two outside links). A pin has neither, as on the card.
- **`getState.moonPhase`**: `{ name, litFromEarthPct, waxing }`, the line under the scrubber
  ("First quarter · 51% lit from Earth"), from the same function (`src/core/moonPhase.ts`).
- **`getState.locatorZoom`**: the locator map's zoom (1 = the whole Moon).
- **`getState.panels`**: `{ filters, "site-details", "site-science" }`, true = open, by the
  names `showPanel` takes.
  `locatorZoom` and `panels` are null when no shell is attached (unit tests of the core).

## 4. D-8: which instant a rise or set is

Done now, for the instants the science core has today (`src/core/skyEvents.ts`, one table used
by the scrubber and the actions):

| event | label shown | instant |
| --- | --- | --- |
| sunrise | Sun starts rising | the first part of the Sun's disc appears above the terrain skyline |
| sunset | Sun fully set | the last part of the Sun's disc goes behind the terrain skyline |
| earthrise | Earth's centre rises | the centre of Earth's disc comes above the terrain skyline |
| earthset | Earth's centre sets | the centre of Earth's disc goes behind the terrain skyline |

- Scrubber: the four jump buttons carry these labels; their tooltips and accessible names give
  the time and the instant in words; so do the marks on the track. The empty-window line no
  longer says "sunset".
- `jumpToEvent`: the result has `label` and `instant`; the description defines the four
  instants; the "there is no next ..." error ends with the definition.
- `getAnalysis`: every entry of `nextEvents` and `events` has `label`; `eventDefinitions` gives
  the four sentences.

**Not done, waits for T-31**: the other end of each crossing ("starts setting", "fully risen",
and Earth's disc rather than its centre). When @analysis lands the fields, the table above gets
the new instants and the scrubber shows both ends; nothing else needs restructuring.

## 5. `lookAt` field of view

4 to 100 degrees (was 20 to 90), the surface scene's own range. `MIN_LOOK_FOV_DEG` /
`MAX_LOOK_FOV_DEG` in `src/core/coreActions.ts`; a test holds them equal to the surface
scene's `MIN_FOV_DEG` / `MAX_FOV_DEG`.

## Tests added

- `src/ui/globe/cardKeys.test.ts`: Escape in the surface view leaves only the surface (surface
  listener registered before or after the card, without `preventDefault`); a claimed press is
  left alone; typing and no-site cases; arrows are not the card's in the surface view.
- `src/core/throttle.test.ts`: the last value is drawn; the interval is kept; cancel.
- `src/core/coreActions.test.ts`: `listSites` (order, filter marks, `shownOnly`, a query changes
  nothing, every listed name selects); site `summary` and `links`; `getState.moonPhase`,
  `locatorZoom`, `panels`; `lookAt` at 4 and 100 degrees and its refusals; `jumpToEvent` labels.
- `src/core/skyEvents.test.ts`, `src/core/analysisReport.test.ts`: the labels and definitions.

## Verified

- `npm run build` passes; `npm test`: 551 vitest tests pass (5 skipped) and the 10 science tests.
- Headless Chromium against `vite preview`, 1440x900, on the built app:
  - IM-2, `enterSurface`, one Escape: the action log gains `exitSurface (ui)` and nothing else;
    the site is still IM-2 and the view is the globe. A second Escape logs `clearSite (ui)`.
  - Two `setTime` calls in the same tick (18:00, then 19:07): the card reads "Sky at 2025-03-06
    19:07 UTC", the clock's value.
  - `getState`: `moonPhase` `{ name: "First quarter", litFromEarthPct: 51, waxing: true }` beside
    the scrubber's "First quarter · 51% lit from Earth"; `locatorZoom` 4 beside the map's "×4";
    `panels` follows `showPanel`; the IM-2 site object has its summary and both links.
  - `listSites`: 28 rows, oldest first (Luna 9, 1966).
  - IM-2 with a 29.5-day window: buttons "Sun starts rising", "Sun fully set", "Earth's centre
    rises", "Earth's centre sets"; tooltip "Jump to 2025-03-19 23:16 UTC: Sun fully set (the last
    part of the Sun's disc goes behind the terrain skyline)"; `jumpToEvent { type: "sunset" }`
    returns that time with `label` and `instant` (`screens/t33-scrubber-1440.png`).
  - Surface view: `lookAt` with `fovDeg` 4 and 100 is accepted and the scene reports the same
    field of view back.
- Phone, 390x844 (`screens/t33-phone-390.jpg`): the labelled jump buttons take two rows, which
  made the scrubber taller than the fixed offsets above it allowed. The regions above the
  scrubber now stand on its real height (`--scrubber-h`, kept by the scrubber; `shell.css`):
  measured, scrubber top 639 px, compass / person / assistant row ends at 627 px, card at 571 px.

## For @assistant

- New query `listSites`; new fields as listed under 3 and 4; `lookAt.fovDeg` 4 to 100.
- `showPanel` has a third panel, `"site-science"` (T-20).
- The "there is no next sunset ..." error keeps its first sentence and gains a second one with
  the definition.
- Your todo test "Escape in the surface view = exitSurface (the site stays selected)" should
  pass on this branch.
