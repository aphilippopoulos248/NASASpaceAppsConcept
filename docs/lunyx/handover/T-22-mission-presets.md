# T-22 Mission presets: handover (@globe)

Branch am/lunyx/agent/globe. Two real landings and the 14 March 2025 eclipse, each put on
screen and played in one step from data that comes with the app.

## The presets (ids for @assistant)

Data file: `public/data/presets.json` (checked when it is read: `src/data/presets.ts`).

| id | what plays | window (UTC) | clock starts | rate | plays for |
| --- | --- | --- | --- | --- | --- |
| `blue-ghost-landing` | Blue Ghost Mission 1, Mare Crisium: touchdown and 14 days of daylight, with the eclipse | 2025-03-02 08:34, 336 h | touchdown | 12 h/s | 28 s |
| `im-2-landing` | IM-2 Athena, Mons Mouton: touchdown and 14 days of low Sun, until it sets on 19 March | 2025-03-06 17:28, 336 h | touchdown | 12 h/s | 28 s |
| `eclipse-2025-03-14` | Earth passes in front of the Sun at the Blue Ghost site | 2025-03-14 04:30, 6 h | 04:52 (8 min before the Sun is first covered) | 10 min/s | 34 s |

All three open in the surface view. The landings face the Sun with the horizon in view (the
surface view's own rule on arriving at a site); the eclipse faces Earth, aimed 1.5 degrees
under its centre with a 12 degree field of view, so that Earth's disc (1.9 degrees) and the
Sun passing behind it stay clear of the panels along the bottom. A preset always opens the
same way, whatever was on screen before.

Every sentence in the file is checked by a test against the catalogue, the bundled Horizons
tables and the real analysis (`src/data/presets.test.ts`, `src/core/presetActions.test.ts`):
the touchdown times are the catalogue's; each window lies inside a bundled table for its
site; Blue Ghost's 14 days have no sunrise or sunset and one dark interval, on 14 March; IM-2
has a sunset on 19 March and the Sun never above 6 degrees; the four eclipse times (05:00,
06:17, 08:34, 09:51) are the analysis' own to the minute.

## Actions

- **`listPresets {}`** (query): `{ presets: [{ id, title, description, site { id, name,
  latDeg, lonDegEast }, missionWindow { startUtc, durationH, endUtc }, clockStartsUtc, view,
  look?, rateSimSecondsPerSecond, playsForSeconds, playsOnLoad, sunBehindEarth?, sources[] }],
  loaded }`. `loaded` is the id of the preset on screen (same site and mission window), or null.
  `sunBehindEarth` (eclipse only): `{ partlyCoveredFromUtc, entirelyHiddenFromUtc,
  entirelyHiddenUntilUtc, clearAgainUtc, computedBy, reported }`.
- **`loadPreset { id, play? }`** (command; what the list's buttons run): selects the site, sets
  the mission window, the clock, real sunlight and the playback rate, clears any arrival delay,
  closes an open comparison, enters the surface view, sets the look direction, waits for the
  surface to be on screen and for the analysis, then starts the clock (`play: false` loads it
  paused). The mast height is left as it is. Result: `{ preset { id, title, description }, view,
  site, timeUtc, playing, rateSimSecondsPerSecond, missionWindow { startUtc, durationH, endUtc,
  length }, mastHeightM, lightMode, look, ephemeris { source: "horizons" | "model" | null, text,
  note }, analysisState, sunBehindEarth?, sources[], comparisonClosed?, note? }`.
  `ephemeris.source` is what the analysis itself reports; inside the bundled windows it is
  `"horizons"`, and `text` says "Sun and Earth positions for this window come from a JPL
  Horizons table bundled with the app: no network is needed." `note` appears when something else
  changed the site, window or clock while the preset was loading: the clock is then not started.
- Deep link: `?preset=<id>` loads a preset (it defines the whole scene, so the rest of the
  link is not applied); the address bar carries `?preset=<id>` while that preset is on screen.

## What else changed, and why

- **The clock stops at the end of the mission window** (`src/core/clock.ts`): a replay ends
  where its window ends, with a short message ("End of the mission window: paused. Press play
  to go on past it."). Play pressed again runs on. This holds for every window, not only for
  presets; the `play` action's description says so.
- **`enterSurface` and `selectSite { surface: true }` report back once the surface is on
  screen** (`viewShown`, `src/scene/globe/sceneHost.ts`), after the fade, so `lookAtBody` or
  `setFieldOfView` can follow at once. Before, an action issued within the fade found the
  surface scene not yet active.
- **A view asked for and taken back within the fade** (enter, then exit at once) no longer
  leaves the scene on one view and the store on the other: the scene decides what to show when
  the fade is dark, from the store as it is then.
- **Scrubber**: Earth's passage in front of the Sun is drawn under the track (lighter band:
  Earth in front of the Sun; full band: the Sun entirely hidden) with a mark that carries the
  times, and the line beside the controls states them. New rate "10 min/s".
- **The Moon's phase line knows about lunar eclipses** (`src/core/moonPhase.ts`): during the
  replay it read "Full Moon · 100% lit from Earth" while the Sun was hidden. It now reads
  "Full Moon · penumbral / partial / total lunar eclipse", from the discs of the Sun and Earth
  as seen from the Moon (Earth's atmosphere ignored). `getState.moonPhase.lunarEclipse` carries
  it. Checked against the published contacts of 14 March 2025 (within 4 minutes) and of
  7 September 2025.
- **Close-up imagery says whether it arrived** (`src/scene/sitePatch.ts`): the Moon Trek tiles
  around a site are the only thing the app fetches from outside. The site card's credit line
  and `getState.globeDisplay.closeUpImagery { state, layersShown, text }` now say "loading",
  the layers that are actually on screen, or "Close-up imagery is not shown: NASA Moon Trek
  could not be reached, so the globe keeps the whole-Moon mosaic here. Nothing else needs it
  ...". Before, the card credited imagery that was not there.

## On screen

- Filters panel, at the top: "Missions to replay", three buttons (title and one line), each
  with "Timing and data sources". Under them, for the window on screen, where the Sun and Earth
  positions come from, in the analysis' own terms.
- Surface view "About this view" (@surface's text): asked in a direct message for one sentence
  on the thin ring drawn around Earth while it hides the Sun (schematic; brightness and colour
  not computed). The preset's own source list says it already.

## Verified

VERIFIED_SECTION

## Limits

- The presets are the two windows for which a JPL Horizons table is bundled. Another site or
  date needs a table (or runs on the in-app model, and the line under the list says so).
- In software-rendered headless Chromium the clock advances at most 0.1 s of real time per
  frame, so a replay takes longer there than the 28 to 34 s it takes at normal frame rates.
- The eclipse view is the sky only (12 degrees across): the ground is out of the picture until
  the user zooms out.
