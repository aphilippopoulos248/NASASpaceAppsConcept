# Accessibility pass

Owner: @desktop-workflow (project lunyx-experience, task T-7; original Lunyx T-17 item 3).
Scope: the desktop website (decision D-4), 1280x720. Phone widths are not a release
criterion; the responsive code stays but is not checked here.

| Round | Build | By | What |
| --- | --- | --- | --- |
| 1 | `am/lunyx/integration` 4f007f1 (2026-11-14) | @assistant (retired) | globe view, site card, scrubber, locator, drawer, the first surface view |
| 2 | team integration 2f7e813 = published 27b0f30 (2026-11-15) | @desktop-workflow | everything since: the rebuilt surface view with Key metrics and skyline chart (T-10), the compare panel with its nearby list (T-11), the keyboard rules of T-37, the rewritten Filters panel (T-36) |

**How.** Automated checks in `e2e/a11y.test.mjs` (`npm run e2e -- a11y`), a keyboard-only walk
of the main journey in the same file, and reading the key handlers. **Not done:** listening
with a screen reader. There is none on the build machine, so wording and announcements are
judged from the accessibility tree only.

## Automated checks (round 2)

`npm run e2e -- flow a11y --no-build --lock` on the app tree of 2f7e813 (= published 27b0f30),
run from commit fc292d1, GPU renderer (GTX 1050 Ti), 2026-11-15 03:55Z, 2.1 min, load 12.6 at the end:
28 tests, 23 pass, 0 fail, 5 todo (open findings, below).

| Check | How | Result |
| --- | --- | --- |
| Every control has an accessible name | Chromium's accessibility tree, every button, link, field, slider, checkbox, select and tab: globe view with IM-2 selected (drawer closed and open), the surface view with Key metrics and the chart, the compare dialog on both tabs | pass |
| Tab reaches every control once, only visible ones, each with a focus ring | one round of Tab at 1280x720, IM-2 selected | pass: 45 stops |
| Distinct names in one round of Tab | the same round | todo: A-5 |
| Text contrast, WCAG AA (4.5:1, large 3:1) | every text node, composited over black space and over sunlit ground: Filters, site card, scrubber, locator, wordmark, assistant drawer, surface strip, Key metrics, skyline chart and its table, compare dialog | pass |
| Reduced motion | duration tokens zero, the drawer does not slide, the view changes at once | pass |
| The compare dialog | `role="dialog"` with a name; the launcher moves focus into it; the tabs move with the arrow keys; Escape closes it and gives the focus back to the launcher | pass, except after "Compare as B": Q-4 |
| The skyline chart | a named group whose keys are described; a "Table" view with a caption gives the same numbers as text; the toggle reads "Chart" and is pressed while the table shows | pass |

Tab order (1280x720, IM-2 selected): Compare launcher; globe canvas; Filters (arrival date,
latitude, longitude, "Drop pin at centre", solar band minimum and maximum, mast height, mission
window, arrival delay, relief exaggeration, coverage, ice targets, Real, Even, previous
missions, country flags, "Mission filters", optimal landing area); site card (fold, close, the
GCAT link, elevation-data details, "Site science" and its four disclosures, QuickMap, Moon Trek,
Earlier, "At landing time", "Enter surface view", "Whole Moon"); compass; scrubber (play,
slider, date, Now, speed, window length); locator map and its zoom; the little person; the
assistant button. It runs from the top left down the left panel, then the card on the right,
then along the bottom.

## Keyboard-only walk of the main journey (round 2)

`e2e/a11y.test.mjs`, "a keyboard-only walk": Tab is pressed until the named control has the
focus (the test fails if it never does), then Enter, the arrow keys or typing. No pointer.

| Step | Keyboard path | Works? |
| --- | --- | --- |
| Pin typed coordinates | Tab to Filters > Latitude, type, Enter; Longitude, type, Enter; Tab to "Drop pin at centre", Enter | yes (near the poles the pin is off the typed point: F-3; while the globe flies, see Q-1, Q-2) |
| Open a catalogued landing from the globe | no direct path when no site is selected (markers answer to the pointer only); the assistant, a link (`?site=`) or Earlier / Later on an open card | not checked again: A-1 is with @globe (their m450) |
| Go down to the surface | "Enter surface view" on the card; focus then lands on the scene, which has `role="application"` | yes |
| Look around on the surface | arrow keys, from the scene and from a HUD button ("Face Sun"); ArrowUp tilts up | yes: A-2 is fixed |
| Leave the surface | Escape, once; the site stays selected | yes: F-1 is fixed |
| Compare | Tab to the launcher, Enter: focus moves into the dialog; "Save as A"; the tabs with the arrow keys; Radius, Spacing, "Scan nearby sites"; "Compare as B" in a ranked row; Escape closes and focus goes back to the launcher | yes, but after "Compare as B" the focus falls out of the dialog: Q-4 |
| Ask the assistant | Tab to the button, Enter: focus in the message box; type, Enter; Escape closes and returns focus to the button | yes |

## Findings

| # | Finding | Owner | Severity | Status |
| --- | --- | --- | --- | --- |
| A-1 | A keyboard or screen-reader user cannot open a catalogued landing from the globe when no site is selected: markers are pointer targets inside the canvas, and Enter on the globe drops a pin. A list of the landings shown that calls `selectSite` would close it. | @globe | high for keyboard users | open; requested by @surface for T-37 (Lunyx m450) |
| A-2 | The look direction in the surface view could only be changed by dragging. | @surface | high for keyboard users | fixed in T-37; verified in round 2 with the keyboard only |
| A-3 | The jump buttons' names included their glyphs ("☀↑ Sunrise"). | @globe | low | fixed: the buttons carry glyph-free names, for example "Jump to 2025-04-04 19:03 UTC: Sun starts rising (the first part of the Sun's disc appears above the terrain skyline)" (walkthrough, round 2) |
| A-4 | The "Arrival delay" field's tooltip, its only explanation, disappears after the first edit (F-4 in `actions.md`). | @globe | low | open (not re-checked in round 2; the field's code is unchanged) |
| F-1 | One Escape in the surface view also deselected the site. | @surface, @globe | medium | fixed by T-33; verified in round 2 |
| A-5 | The site-science section has two disclosures both named "Source and limits" (under the long-term averages and under the Diviner temperatures): a screen-reader user who lists the controls cannot tell them apart. Naming each after its block would close it. | owner of the site-science section (T-30; its author @ice-targets is retired) | low | open, sent to @coordinator; e2e todo test |
| Q-4 | After "Compare as B" in a ranked row of the nearby list, the panel switches to "A and B" and the focused button disappears: the focus falls to the page and the next Escape does not return it to the launcher. | @analysis | medium for keyboard users | open, sent to @coordinator; e2e todo test (`docs/lunyx/qa-findings.md`) |
| F-3 | Near the poles the view stops short of a typed latitude, so the keyboard way to pin coordinates is inexact there (up to 1.7 km at 85°). | @globe | medium | open (see also Q-1 and Q-2 in `qa-findings.md`) |

## What is good and should stay

- One focus ring style everywhere, visible on dark and light ground.
- Live regions where things change without focus moving: the toast area, the card's
  analysis status, the compare panel's status and state lines, the scan progress, the Key
  metrics message, the assistant conversation.
- The closed drawer is `inert`, so it is neither focusable nor read.
- Requirements and states are said in words, not only shown in colour.
- The app honours reduced motion in its own animations and in the camera flights.
- The skyline chart has a data-table view with a caption, so its content is available as text.

## Still to do

- A screen-reader listening pass by a person.
