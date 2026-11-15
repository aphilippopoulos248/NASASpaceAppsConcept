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

ROUND2-RESULTS

## Keyboard-only walk of the main journey (round 2)

`e2e/a11y.test.mjs`, "a keyboard-only walk": Tab is pressed until the named control has the
focus (the test fails if it never does), then Enter, the arrow keys or typing. No pointer.

| Step | Keyboard path | Works? |
| --- | --- | --- |
| Pin typed coordinates | Tab to Filters > Latitude, type, Enter; Longitude, type, Enter; Tab to "Drop pin at centre", Enter | ROUND2 (near the poles the pin is off the typed point: F-3) |
| Open a catalogued landing from the globe | no direct path when no site is selected (markers answer to the pointer only); the assistant, a link (`?site=`) or Earlier / Later on an open card | not checked again: A-1 is with @globe (their m450) |
| Go down to the surface | "Enter surface view" on the card; focus then lands on the scene, which is announced as an application | ROUND2 |
| Look around on the surface | arrow keys, from the scene or from a HUD button | ROUND2 (A-2) |
| Leave the surface | Escape, once, keeping the site | ROUND2 (F-1) |
| Compare | Tab to the launcher, Enter: focus moves into the dialog; "Save as A"; the tabs with the arrow keys; Radius, Spacing, "Scan nearby sites"; "Compare as B" in a ranked row; Escape closes and focus goes back to the launcher | ROUND2 |
| Ask the assistant | Tab to the button, Enter: focus in the message box; type, Enter; Escape closes and returns focus to the button | ROUND2 |

## Findings

| # | Finding | Owner | Severity | Status |
| --- | --- | --- | --- | --- |
| A-1 | A keyboard or screen-reader user cannot open a catalogued landing from the globe when no site is selected: markers are pointer targets inside the canvas, and Enter on the globe drops a pin. A list of the landings shown that calls `selectSite` would close it. | @globe | high for keyboard users | open; requested by @surface for T-37 (Lunyx m450) |
| A-2 | The look direction in the surface view could only be changed by dragging. | @surface | high for keyboard users | fixed upstream in T-37 (arrow keys look wherever the focus is, except in fields and widgets with keys of their own); ROUND2-A2 |
| A-3 | The jump buttons' names included their glyphs ("☀↑ Sunrise"). | @globe | low | since T-33 the visible jump buttons carry glyph-free `aria-label`s (per @surface, T-37); ROUND2-A3 |
| A-4 | The "Arrival delay" field's tooltip, its only explanation, disappears after the first edit (F-4 in `actions.md`). | @globe | low | open; ROUND2-A4 |
| F-1 | One Escape in the surface view also deselected the site. | @surface, @globe | medium | fixed by T-33; ROUND2-F1 |
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
