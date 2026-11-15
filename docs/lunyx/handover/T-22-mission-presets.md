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
- Surface view "About this view" (@surface's text, aba8e54, integrated): "While Earth hides the
  Sun (an eclipse seen from the Moon), the thin orange ring drawn around Earth stands for
  sunlight passing through Earth's air: it is schematic, and its brightness and colour are not
  computed." The preset's own source list says the same.

## Verified

- `npm run build` passes. Vitest on the changed modules (src/core clock, coreActions, deepLink,
  moonPhase, presetActions, skyEvents, analysisReport, throttle; src/data; displayState;
  src/ui/globe): 12 files, 95 tests pass, at c8e2dd2 (merge of integration 9a5fa1c). The full
  suite is for the integration candidate (D-10). New tests: `src/data/presets.test.ts`,
  `src/core/presetActions.test.ts` (real science core and bundled data: all three presets),
  `src/core/clock.test.ts`, `src/core/moonPhase.test.ts`, deep links, eclipse spans, imagery state,
  enterSurface waiting for the scene.
- GPU browser check @ c8e2dd2 (Chromium with ANGLE on the GTX 1050 Ti, 1280x720, `vite preview`,
  every request outside the app's own server refused): 2 min 21 s, load 10.4.
  - "Eclipse of 14 March 2025" clicked in the Filters panel: the log shows `loadPreset (ui)`;
    surface view on screen, facing W 259 deg, 27 deg up, 12 deg field of view; playing at
    10 min/s; the line under the list reads "Sun and Earth positions for this window come from a
    JPL Horizons table bundled with the app: no network is needed."; address `?preset=eclipse-2025-03-14`.
  - It stopped by itself at 2025-03-14 10:30 UTC, the end of the window, with "End of the mission
    window: paused. Press play to go on past it."; the scrubber line: "Earth passes in front of the
    Sun 2025-03-14 05:00 to 09:51 UTC; the Sun is entirely hidden 06:17 to 08:34 UTC."
  - Stills (`screens/t22-eclipse-before.png` 04:52, `t22-eclipse-totality.png` 07:25,
    `t22-eclipse-after.png` 10:00): the Sun beside Earth, then behind it ("Sun (behind Earth)",
    the key metrics say "behind Earth (eclipse)"), then clear of it; phase line "Full Moon ·
    total lunar eclipse" at 07:25.
  - Back on the globe the card says "Close-up imagery is not shown: NASA Moon Trek could not be
    reached, ..." and `closeUpImagery.state` is "unavailable".
  - `blue-ghost-landing` and `im-2-landing` each loaded, played and stopped at their window end
    (2025-03-16 08:34 and 2025-03-20 17:28 UTC), surface view, ephemeris "horizons", Sun ahead
    at the normal field of view (`screens/t22-im2-playing.jpg`).
  - Refused requests: only `trek.nasa.gov` (664 tile requests over the whole run); no request
    to the app's own server failed.
- `screens/t22-filters.png`: the "Missions to replay" list.

## Limits

- The presets are the two windows for which a JPL Horizons table is bundled. Another site or
  date needs a table (or runs on the in-app model, and the line under the list says so).
- The clock advances at most 0.1 s of real time per frame, so on a machine drawing fewer than
  10 frames a second a replay takes longer than its 28 to 34 s.
- The eclipse view is the sky only (12 degrees across): the ground is out of the picture until
  the user zooms out.
