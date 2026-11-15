# T-20 Site science in the site card, ice-target outlines on the globe: handover (@globe)

Branch am/lunyx/agent/globe. Two parts: the outlines and an interim card section went out with
I-15 (955e5de); the swap to @ice-targets' module (T-30) is commit da88262 and what follows it.

## What is in the app now

- **Site card, "Site science"** (`src/ui/globe/siteCard.ts`): a section below the mission-window
  results. Its content is @ice-targets' module, mounted with
  `mountSiteScience(el, { heading: false })` from `src/ui/science/siteScience.ts`: Deep Space
  Network geometry for the mission window, the 18.6-year averages (set apart and tagged "not this
  date"), the nearest mapped ice targets, Diviner annual temperatures and ShadowCam links, each
  with its source and caveat. A layer with nothing at the site is named in one closing line with
  the reason. The card only gives it a place and a heading.
- **The heading folds the section**: `showPanel { panel: "site-science", open }` (the heading is
  the button; `aria-expanded`, `aria-controls`). Folded, one line says what is inside. Opening it
  also opens the card's details if they were folded (the default on phones), so the assistant can
  bring the section on screen in one step. `getState.panels` reports all three panels.
- **Actions** `getSiteScience` and `nearestIceTargets` are registered by
  `registerSiteScienceActions()` at boot (`src/main.ts`). Shapes: `docs/lunyx/handover/T-30-site-science.md`.
- **Globe**: `showIceTargets { show }` outlines the 169 mapped regions
  (`src/scene/globe/iceOutlines.ts`), vertex by vertex on the drawn surface, hidden behind the
  limb; checkbox and legend with the Lemelin et al. 2021 CC BY 4.0 credit under Filters, Terrain relief.

## The swap (one change, as agreed in #team m252 / m255)

Deleted: `src/core/scienceActions.ts` and its registration, `src/core/siteScience.ts` with its
test, the card's own render code and styles. `iceTargetLayer()` now comes from
`src/science/siteScience.ts` (used by the globe outlines and their test). Nothing registers
`getSiteScience` or `nearestIceTargets` twice.

## For @assistant

- `showPanel` takes a third panel, `"site-science"`. Result `{ panel, open }` as before.
- The site-science result keys did not change with the swap; `surfaceTemperature` and
  `shadowCam` are new since T-30 (see its handover).

## Verified

- `npm run build` passes; `npm test`: 551 vitest tests pass (5 skipped) and the 10 science tests.
- New test `src/ui/globe/panels.test.ts`: the section folds and opens; opening it unfolds the
  card details; the tool definition offers the new panel.
- Headless Chromium against `vite preview`, arrival 2025-03-06 17:28 UTC, 24 h window:
  - IM-2 at 1440x900 (`screens/t20-card-im2.jpg`) and the whole card on a tall window
    (`screens/t20-card-im2-whole.jpg`): Goldstone 59.1 %, Canberra 32.7 %, Madrid 57.2 %, any
    station 100.0 %; averages 45 % sunlight and 90 % Earth visibility (120 m cell); ice targets
    at 6.6, 10.4 and 16.2 km; Diviner annual maximum 226 K, mean 127 K; no ShadowCam mosaic,
    stated in the closing line. The same figures as `getSiteScience` returns. No horizontal overflow.
  - Phone, 390x844 (`screens/t20-phone-folded.jpg`, `t20-phone-card.jpg`): the card opens folded
    (title and buttons only); `showPanel site-science` unfolds it with the section in view;
    card 320 px wide, no horizontal overflow.
  - Ice-target outlines over the south-polar close-up with their legend (`screens/t20-ice-targets.jpg`).

## Limits

- The DSN block needs a finished analysis: it shows its status while the analysis runs or fails.
- Ice-target outlines have no labels on the globe; names are in the section's list and in the actions.
- The section sits in the globe view's site card only. The surface view's panels are @surface's.
- On a phone the relief chip keeps only its factor while the card is unfolded (the card would
  otherwise run under it); the card's credit line says what the close-up is made of.
