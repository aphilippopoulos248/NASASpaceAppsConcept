# Desktop walkthrough: screenshots and review against the mockups

Tasks T-8, T-16, T-19 and T-23 (release-candidate walkthroughs, project lunyx-experience), by
@desktop-workflow. Desktop website only (decision D-4): 1280x720 and 1920x1080. This replaces
the T-2 review of build `27b0f30` (this file at `6a24334`); the T-2 shots stay under `27b0f30/`
because `docs/lunyx/AI-USE.md` lists them (A32).

## Release candidate with T-64: app code e54cc2d (T-19, T-23)

| | |
| --- | --- |
| Release candidate | The T-64 release candidate: lunyx/@upstream-sync's candidate `e54cc2d` plus this team's tests and docs (`8b24e05`, T-19). `e54cc2d` is `bce6816` plus GitHub main's T-64 work and its fixes: mission selection and the movable surface panels (081784a), the tracking toggles (pull request #2, a03eff9), the SDK credentials (d744169), @analysis's and @assistant's halves of F-10, @globe's territory wording (8ebeb4b) and Q-9 fix (aaeada2), and @surface's T-65 (208d238), 4df402f and 8ea37e1. |
| Tested tree | `e54cc2d` merged into this branch (D-5 point 3 exception). The app code is identical to `e54cc2d`'s; the branch adds e2e and docs only. Outside `e2e/`, `docs/` and `*.md`, `8b24e05` differs from `e54cc2d` only in `.env.example` (@assistant's credentials text, T-17), a template the app does not read. Script: `e2e/qa/walkthrough.mjs` at `844813c`. |
| Renderer | ANGLE on the NVIDIA GTX 1050 Ti, full settings (`lowPower: false`). 60.2 and 60.3 fps at 1280x720; 60.3 and 60.1 fps at 1920x1080 (the strip there says "61 fps, 90% resolution"). |
| Run | 2026-11-15 10:39 to 10:45Z, all five parts at both sizes. Report: `e2e/qa/out/cand-e54cc2d/report.json` (not committed). The page contacted only the preview server and `trek.nasa.gov`, with no failed request, HTTP error or console error. |

| Size | Steps | Value checks | Time | Load (1 min) |
| --- | --- | --- | --- | --- |
| 1280x720 | 41 of 41 ran | 257 of 257 | 144 s | 4.2 at the start |
| 1920x1080 | 41 of 41 ran | 257 of 257 | 150 s | 4.0 at the end |

The browser tests on the same tree (GPU, 10:33 to 10:36Z): `a11y` and `flow`, 35 of 35. That
includes the four new F-10 Escape tests and the T-64 marker test.

**What changed since `bce6816`, as seen on screen.**

- **Globe markers.** A click on a landing's marker shows its details on the card, and the view
  stays on the globe. A double-click opens its surface view. The tooltip says so: "Click for
  mission details · Double-click for surface view".
  - Where markers overlap (Apollo 11 and Surveyor 5 seen from far out), slower clicks take
    turns, and a double-click opens the landing whose details are shown.
  - Q-9 (the double-click opened the other landing) was found on `fe0ae02`, and @globe's
    `aaeada2` fixed it. The walkthrough checks it at both sizes.
- **Territory size.** Filters has a "Territory size exaggeration" select (100 by default). The
  card's Explored row says how much larger the area is drawn: "about 60 m across (drawn 2500×
  larger in width from orbit, about 150 km across, so it can be seen; true size close to the
  ground)".
- **Surface panels.** Each surface panel has a header with a grip and a Fold button: Key
  metrics, Skyline chart, Surface controls, Time, Locator map, and the compare panel and the
  assistant drawer when they are open.
  - The grip moves the panel by dragging or with the arrow keys. "Reset panels", under the
    close button, puts every panel back.
  - At 1280x720 the ground and ownership lines sit in the strip's "About this view"
    disclosure, so the horizon stays clear. At 1920x1080 they show.
- **Tracking.** The strip's "Face Sun" and "Face Earth" are now toggles, "Track Sun" and "Track
  Earth". The view follows the body as the clock moves. Tracking one body replaces the other,
  and dragging, the arrow keys or another look stop it.
- **The assistant drawer** has a labelled "Close ×" button.
- **F-10.** Escape goes to the layer that holds the focus. With the compare panel and the drawer
  both open:
  - focus in the compare panel: Escape closes the panel and gives the focus back to its
    launcher;
  - focus in the drawer: Escape closes the drawer;
  - focus on the page or the scene: the drawer goes first.

  See `docs/lunyx/accessibility.md`.

Still there, as expected while on hold: Q-8, the stale "Nearby sites" status line (original
T-60), in `38-scenario-1-nearby.jpg`; and Japan's flag on the wordmark's "N" (T-61), in
`36-globe-flags.jpg`.

**Shots.** The changed ones are under `docs/lunyx/screenshots/e54cc2d/`: 19 at 1280x720 and 10
at 1920x1080. They are the screens with the surface panels, the tracking toggles, the
assistant drawer, the card's Explored row and the territory select. The other shots are
unchanged on this RC and stay where they are: in `649fc4e/`, 01, 04 and 12 (both sizes for 01),
and in `bce6816/`, 07 and 08.

| Shot | What it shows |
| --- | --- |
| `1280x720/13-…`, `14-im2-surface-key-metrics.jpg`, `1920x1080/14-…` | IM-2 at touchdown with the movable panels, each titled with a grip and Fold; "Reset panels"; the strip with Track Sun, Track Earth, Sky paths, Generated detail, Skyline chart. At 1280x720 "About this view" holds the ground lines. |
| `1280x720/15-…`, `16-…` | "why?" on the Sun row, and the chart's table view, in the panel layout |
| `1280x720/17-…`, `1920x1080/17-…` | "Track Earth" pressed: the view on Earth |
| `1280x720/18-…`, `1920x1080/18-…` | "Track Sun" pressed (it replaces Earth) with sky paths |
| `1280x720/22-…`, `1920x1080/22-…` | The clock at "Sun fully set", 2025-03-19 23:06 UTC, the view following the Sun |
| `1280x720/24-…`, `1920x1080/24-…` | Apollo 11 at touchdown, opened by a click and then a double-click over Surveyor 5's overlapping marker |
| `1280x720/25-…`, `28-…`, `30-…` | The assistant drawer with its "Close ×" button: open, "compare with a 24 h delay", "enter the surface then look at the sun" |
| `1280x720/32-…`, `33-…`, `1920x1080/33-…` | The IM-2 preset at its window end; Earth zoomed in (7.8° and 6.5° fields of view) |
| `1280x720/34-…`, `35-…`, `1920x1080/35-…` | The window table and the outlook in the compare panel, which in the surface view is a movable panel too |
| `1280x720/36-…`, `1920x1080/36-…` | Country flags, the "Territory size exaggeration" select and IM-2's card with the new Explored row |
| `1280x720/38-…`, `39-…`, `40-…`, `1920x1080/39-…`, `40-…` | The T-6 scenario with the panels and the drawer open |

## Release candidate bce6816 (T-16)

| | |
| --- | --- |
| Release candidate | `bce6816` (`bce6816ffd56a15e193f83ac747aadfd292d0053`), published. Origin `feature/lunyx-navigator` is at `a72a57f`, which adds only `docs/lunyx/STATUS.md`. Over `41be074`, the only app change is the Q-7 fix of Lunyx T-56: `src/ui/compare/nearbyTab.ts` and the new `src/ui/compare/scanSettings.ts` (with its unit test). The rest is this team's test and docs commits. |
| Tested tree | `a72a57f` merged into this branch. **Its app code is identical to `bce6816`'s**: `git diff --name-only bce6816 HEAD -- . ':(exclude)*.md' ':(exclude)docs' ':(exclude)e2e'` is empty. The script is `e2e/qa/walkthrough.mjs` at `b067068`. It is the RC's script, except that its scan step now runs the operator's Q-7 scenario (below). |
| Renderer | As for `41be074`: ANGLE on the NVIDIA GTX 1050 Ti, full settings (`lowPower: false`). 60.2 and 60.1 fps at 1280x720; 58.6 and 60.1 fps at 1920x1080. |
| Run | 2026-11-15 09:28 to 09:33Z, all five parts at both sizes. Report: `e2e/qa/out/rc-bce6816/report.json` (not committed). As before, the page contacted only the preview server and `trek.nasa.gov`, with no failed request, HTTP error or console error. |

| Size | Steps | Value checks | Time | Load (1 min) |
| --- | --- | --- | --- | --- |
| 1280x720 | 41 of 41 ran | 252 of 252 | 150 s | 2.0 at the start |
| 1920x1080 | 41 of 41 ran | 252 of 252 | 155 s | 3.0 at the end |

**The changed area, at both sizes (step 7, 10 of 10 checks each).** In Compare > "Nearby
sites":

1. Radius 900 and Spacing 150 are typed and left with Tab.
2. "Slope at most" is changed to 10° and back to 8°; each change redraws the tab.
3. Both fields still read 900 and 150. Before the fix, the first change put 2000 and 300 back.
4. "Scan nearby sites" runs on that grid: its options are 900 / 150 / 8, and its summary reads
   "113 points scanned around Pin 89.450° S, 137.200° W (within 900 m, every 150 m, slope at
   most 8°): 57 alternatives ranked, 55 over the slope limit."
5. Rank 1 equals the scan's best (score 91.8, 150 m E and 150 m S). After the scan the fields
   still show 900 and 150.
6. "Compare as B" on rank 1 (step 8): the table and the requirement lines equal both analyses,
   28 of 28 checks.

Everything else matched the `41be074` run, where every screen value was checked against the
analysis.

The e2e flow file on the RC's exact tree (`2425d14`) passed 16 of 16 in the original team's run,
the Q-7 test included. It was not repeated here (D-7).

**Shots.** Only the "Nearby sites" shots changed. They are under
`docs/lunyx/screenshots/bce6816/`:

| Shot | What it shows |
| --- | --- |
| `1280x720/07-nearby-ranked.jpg`, `1920x1080/07-…` | "Nearby sites" after the scan. The typed 900 m and 150 m are kept, the slope limit is 8°, and 113 points give 57 ranked. Each row has Pin and "Compare as B". |
| `1280x720/08-compare-candidate-as-b.jpg` | "A and B" after "Compare as B" on rank 1: the pin against the candidate 150 m E, 150 m S. |

The other shots, in `649fc4e/`, still show this RC: nothing else in the app changed.

**What changed since `41be074`, as seen on screen:** "Nearby sites" keeps a typed radius and
spacing through every redraw, and scans what it shows. No new finding. Q-8 (the stale status
line, original T-60) and the flag on the wordmark (original T-61) are still there, as expected:
both are on hold, not fixed in this RC.

## Release candidate 41be074 (T-8): what was tested

| | |
| --- | --- |
| App build | The app tree of team integration `649fc4e`: published `39a4c5d` plus this team's last delivery. **This run counts for release candidate `41be074`** (`41be0747ddf59a625b9e936dcce8c38b9906c724`, published on origin `feature/lunyx-navigator`, original team's D-15). Its app code is identical to `649fc4e`'s: `git diff --name-only 649fc4e 41be074 -- . ':(exclude)*.md'` is empty, and only `README.md` (the Q-7 line) and `docs/lunyx/STATUS.md` differ. The e2e tests are the same too. The run's own commit, `e6d5333` on `am/lunyx-experience/agent/desktop-workflow`, is `649fc4e` plus a fix to the walkthrough script's countdown step (test code only). |
| Renderer | `ANGLE (NVIDIA Corporation, NVIDIA GeForce GTX 1050 Ti/PCIe/SSE2, OpenGL ES 3.2)`, read from `UNMASKED_RENDERER_WEBGL` in every run. Headless Chromium (Playwright 1.60.0) with `--use-gl=angle --use-angle=gl-egl --ignore-gpu-blocklist --enable-gpu`. |
| Surface settings | Full settings: the app chose `lowPower: false` (it switches to low power only under a software renderer). 60 fps at both sizes (60.2 at 1280x720; 59.8 to 60.2 at 1920x1080). |
| How | `e2e/qa/walkthrough.mjs` drives the real controls with the mouse and the keyboard. It reads every value on screen from the DOM and checks it against the app's own analysis output (`getAnalysis`, the published comparison, the nearby scan, `showOutlook`, the downloaded files). Report: `e2e/qa/out/rc-649fc4e-r2/report.json` (not committed), 2026-11-15 06:26 to 06:31Z. |
| Network | The page could reach the network, as a judge's browser would. It contacted only the preview server and `trek.nasa.gov` (close-up imagery). At both sizes: no failed request, no HTTP error, no console error or warning. |
| Time zones | 1280x720 ran in America/New_York and 1920x1080 in Europe/Berlin. Every time on screen was UTC. |

| Size | Parts | Steps | Value checks | Time | Load (1 min) |
| --- | --- | --- | --- | --- | --- |
| 1280x720 | search and comparison, surface, assistant, the T-6 scenario, extras | 41 of 41 ran | 247 of 247 | 135 s | 5.5 at the start |
| 1920x1080 | the same | 41 of 41 ran | 247 of 247 | 140 s | 2.4 at the start, 1.8 at the end |

What the parts cover, and what equalled the analysis:

- **Search and comparison.** A pin typed at 89.45° S, 137.2° W lands exactly there (F-3 is
  fixed), and its card equals the analysis (16 checks). The search criteria are a 7-day window,
  slope at most 8° and an Earth gap of at most 48 h; the pin is then saved as A. The "Nearby
  sites" scan covers 137 points and ranks 44. "Compare as B" on rank 1 (300 m N): the compare
  table and the requirement lines equal both analyses (28 checks).
- **Surface.** IM-2 from its marker, then "At landing time": the card equals the analysis (18
  checks). The surface view at touchdown: Key metrics equal the analysis (17). The "why?" line
  names the terrain that forms the skyline. The chart's table equals the analysis series (10).
  Then "Face Earth", "Face Sun" with sky paths, and a 29.5-day window. The countdown button
  moves the clock to the instant it names ("Sun starts setting", 2025-03-19 16:36 UTC). Each
  scrubber jump lands on the instant its label names: Sun starts setting 2025-03-19 16:36, fully
  set 23:06, starts rising 2025-04-04 19:05 UTC. Last, Apollo 11 at touchdown.
- **Assistant** (deterministic mode, as served with no language-model key). Five requests: show
  IM-2 at landing, the illumination, a 24 h delay (the reply equals the compare panel and both
  analyses, 26 checks), a flatter nearby site, and the surface facing the Sun.
- **The T-6 scenario with the panels open** (T-8 item 3). Set up through the controls: arrival
  2025-03-06 17:28 UTC, a 708 h window, a pin at 88° S, 136.7° E. Three requests in the drawer:
  1. The reply's candidate (1.62 km W, slope 3.6°, darkness 348.5 h) equals the `rankNearby`
     row and the Nearby list row.
  2. The compare reply equals the compare table and both analyses (27 checks).
  3. "Show me the ridge at Earthset" moves the clock to Earth's centre setting, 2025-03-14
     11:35 UTC. The explanation on screen equals `explainBlockage`, and the Key metrics Earth
     rows equal the analysis (10 checks).

  The assistant, the panels and the analysis gave the same numbers.
- **Extras.** The IM-2 preset under "Missions to replay" plays to the end of its window on the
  bundled JPL Horizons table, with no network. A zoomed view of Earth at touchdown (6.5° field
  of view). The window table: the JSON and CSV downloads equal the analysis, and the CSV has one
  row per spell and per passage. The outlook equals `showOutlook`. Country filter: India takes
  the list from 28 landings to 27. Also checked: country flags, the ownership and explored-area
  rows on the card, and that no elevation download failed (Q-6).

**The browser tests on the same tree** (`npm run e2e -- flow a11y`, GPU, 06:04 to 06:16Z):

- flow: 15 pass, plus 1 todo. The todo is Q-7, deferred by operator decision D-14; its test
  stays as the known-issue marker. It still fails as expected (the typed radius 900 reads
  2000).
- a11y, first run: 12 of 15. The renderer crashed during "with reduced motion": the test hung
  for 600 s, then "Target crashed", and the two tests after it failed on the dead page.
- a11y, run again at 06:22Z and 06:23Z: 15 of 15 both times.

The crash has not happened again; see Observations in `docs/lunyx/qa-findings.md`.

## Shots of RC 41be074 (T-8)

All under `docs/lunyx/screenshots/649fc4e/`. JPEG, quality 80; 24 at 1280x720 and 11 at
1920x1080. The run also took the other 13 at 1920x1080; they are in the report directory and
not committed.

| Shot | What it shows |
| --- | --- |
| `1280x720/01-open.jpg`, `1920x1080/01-open.jpg` | The globe 1.7 s after loading, with "Loading relief…" by the compass. Also: the wordmark, Filters opening with "Missions to replay", the globe with markers, the scrubber, the locator, the little person and the assistant button. |
| `1280x720/04-pin-card.jpg` | A pin typed at 89.45° S, 137.2° W lands exactly there; its card shows the sky against the skyline and the mission-window figures. |
| `1280x720/07-nearby-ranked.jpg` | "Nearby sites": 2 km radius, 300 m spacing, slope at most 8°; 137 points, 44 ranked; each row has Pin and "Compare as B". |
| `1280x720/08-compare-candidate-as-b.jpg` | "A and B" after "Compare as B" on rank 1: the pin against the candidate 300 m N, B − A, the differences in words, and requirement lines that say when a spell runs past the window edge and how long it lasts in full. |
| `1280x720/12-im2-card-landing.jpg` | IM-2's card at touchdown, 2025-03-06 17:28 UTC: Sun 2.5° up at azimuth 66°, 1.6° above the skyline; Earth 11.2° up at 336°. |
| `1280x720/13-im2-surface-landing-sun.jpg` | Back into the surface view at IM-2 from the card's "Enter surface view". The view keeps the direction it had when the user left (SE 145°, after the look-around of step 11); it faces the Sun only on the first arrival. |
| `1280x720/14-im2-surface-key-metrics.jpg`, `1920x1080/14-…` | The surface view at IM-2 with Key metrics, the skyline chart and the status strip. In the 7-day window there are no events, and Earth reads "centre 100.0 % · any part of the disc 100.0 %". |
| `1280x720/15-im2-surface-why-sun.jpg` | "why?" on the Sun row: the terrain 18.4 km away at azimuth 65.7° forms the skyline there (LOLA south pole, 85S square at 80 m). |
| `1280x720/16-im2-surface-chart-table.jpg` | The chart's table view; every row was checked against the analysis series. |
| `1280x720/17-im2-surface-earth.jpg`, `1920x1080/17-…` | "Face Earth": Earth at azimuth 335.8°, 11.2° up, half lit. |
| `1280x720/18-im2-surface-sun-paths.jpg`, `1920x1080/18-…` | "Face Sun" with sky paths: the Sun 2.46° up at azimuth 65.7°, 1.63° above the skyline. |
| `1280x720/22-im2-surface-at-sun-fully-set.jpg`, `1920x1080/22-…` | The clock at "Sun fully set", 2025-03-19 23:06 UTC (29.5-day window), facing the Sun's path behind the terrain. Key metrics show the Earth-gap requirement as not met, and both ends of every rise and set ahead. |
| `1280x720/24-apollo11-surface-landing-sun.jpg`, `1920x1080/24-…` | Apollo 11 at touchdown, 1969-07-20 20:17 UTC, facing the Sun: Sun 88.80° / 10.70°, Earth 272.20° / 59.23°, 67 % lit. |
| `1280x720/25-assistant-open.jpg` | The assistant drawer in deterministic mode. |
| `1280x720/28-assistant-compare.jpg` | "compare with a 24 h delay": the assistant's numbers next to the compare panel's. |
| `1280x720/30-assistant-surface.jpg` | "enter the surface then look at the sun". |
| `1280x720/32-preset-im2-end.jpg` | The IM-2 preset at the end of its 14-day window (2025-03-20 17:28 UTC): paused, with the message "End of the mission window: paused. Press play to go on past it." |
| `1280x720/33-im2-surface-earth-zoomed.jpg`, `1920x1080/33-…` | Earth from IM-2 at touchdown, zoomed to a 6.5° field of view: half lit, 1.95° across. The countdowns show both ends ("starts setting 2025-03-19 16:36, fully set 23:06 UTC"; Earth: starts setting, centre sets, fully set). The message at the top is left over from shot 32: messages stay 3.5 s, and this step came 1 s later. |
| `1280x720/34-window-table.jpg` | Compare > "Window table" for IM-2 (14 days): the Sun's spells including Earth in front of the Sun, Earth's centre, and the passages with both ends; the CSV download line. The same left-over message is at the top. |
| `1280x720/35-outlook.jpg`, `1920x1080/35-…` | Compare > "Outlook", 12 lunar months from IM-2's arrival: the chart, best and worst arrival, the cost of a slip, in words. |
| `1280x720/36-globe-flags.jpg`, `1920x1080/36-…` | "Show country flags" with Mission filters > Country, and IM-2's card with "Belongs to USA · source: GCAT D01180", "Owner Intuitive Machines LLC" and "Explored: about 60 m across (on the globe drawn up to 10× larger from orbit, true to size close to the ground)". |
| `1280x720/38-scenario-1-nearby.jpg` | Scenario request 1: the reply's candidate next to the Nearby list. The green line under the scan settings is stale: Q-8, below. |
| `1280x720/39-scenario-2-compare.jpg`, `1920x1080/39-…` | Scenario request 2: the reply, the A/B table and the requirement lines for the pin and its alternative. |
| `1280x720/40-scenario-3-earthset.jpg`, `1920x1080/40-…` | Scenario request 3: the clock at Earth's centre setting, 2025-03-14 11:35 UTC. The reply quotes the ridge 53.7 km away, next to the A/B table at the shared clock. |

## What changed since the T-2 review (`27b0f30`)

Seen in these shots, all from the original team's work since then:

- Filters opens with "Missions to replay": Blue Ghost Mission 1, IM-2 and the 14 March 2025
  eclipse. Each has its own "Timing and data sources" disclosure, named after the preset (A-6
  is fixed).
- Every rise and set has both ends, on every screen: the card, the Key metrics countdowns, the
  scrubber's jump buttons and the window table. Earth gets three instants: starts setting,
  centre sets, fully set. The countdown buttons and the scrubber jumps go to the instant they
  name.
- Earth is counted twice: by its centre and by any part of its disc. Key metrics: "Earth in
  sight: centre 88.9 % · any part of the disc 96.9 %"; the compare table has rows for both.
- The scrubber marks the eclipse (◐) apart from the rise and set marks.
- The card names who owns the hardware (GCAT) and how far the landing explored. Explored areas
  are drawn up to 10× larger from orbit and true to size close to the ground.
- Country flags, and a Country filter under Mission filters.
- The compare panel has four tabs: "A and B", "Nearby sites", "Window table" (CSV and JSON
  downloads) and "Outlook".
- The default solar band, 0° to 90°, now means "no band" everywhere (Q-5 is fixed).

## Globe view against `docs/reference/globe.jpg`

**Matches the mockup.** The LUNYX wordmark is top centre. A real 3D Moon with LOLA relief sits
in the middle, with its relief exaggeration stated on screen ("Relief ×10, LOLA elevation") and
stars behind it. The Filters panel is on the left:

- arrival date and time (UTC);
- latitude and longitude of the centre of view (editable; typing flies there, exactly);
- the solar elevation requirement as `min < α < max`;
- "Show previous missions";
- "Show optimal landing area", with its legend.

The compass is lower left. The locator ("viewfinder") map is lower right, with the view's
footprint. The time scrubber runs along the bottom. The little person stands next to the
locator ("Drag onto the Moon"). The assistant button is a discreet circle lower right, and its
drawer slides out.

**Deviates, and why.**
- The Filters panel holds much more than the sketch: the mission presets at the top, then
  mission parameters, terrain relief, sunlight on the globe, data coverage, ice targets,
  previous missions, country flags and mission filters. At 1280x720 it scrolls, and the
  presets push the arrival date and the centre of view below the first screen. At 1920x1080
  more of it fits.
- A site card on the right does what the sketch leaves to the "LLM to fetch info" box. It
  shows the coordinates, the elevation and its data, ownership, the explored area, the sky now
  against the skyline, and the mission-window figures.
- A "Compare A B" launcher sits top left.
- The time scrubber does more than a slider: a UTC date field, Now, playback speed, window
  length, marks for rises, sets and eclipses, and jump buttons for both ends of each rise and
  set.
- Cosmetic, not blocking (D-13): with "Show country flags", a flag can sit on the wordmark. At
  1280x720 Japan's flag, white with a red disc, covers the wordmark's "N" (`36-globe-flags.jpg`).

## Surface view against `docs/reference/surface.jpg`

**Matches the mockup.** "Key metrics" is upper left. It shows the Sun's and Earth's azimuth,
elevation and clearance above the skyline. Then the countdowns to the next sunset, sunrise,
Earthset and Earthrise, each with both ends ("starts setting 2025-03-19 16:36, fully set 23:06
UTC"). Then the mission-window figures, with a warning when a set requirement is not met.

- Dragging (or the arrow keys) turns the view through 360°.
- A chart lower left plots the skyline with the Sun's and Earth's paths. It expands, and it has
  a table view.
- The locator map lower right marks the site.
- The time scrubber at the bottom carries the rise, set and eclipse marks.
- The close button is top right.

The sky is black. The Sun and Earth are drawn where the analysis puts them, at their true
relative size: Earth is about 3.6 times the Sun's width, and the zoomed shot shows its phase.
The ground is measured relief, with the elevation products stated.

**Deviates, and why.**
- A status strip above the scrubber says which way the viewer faces, the frame rate and the
  drawing resolution, which elevation product covers each distance band, what is generated,
  and who owns the hardware at the site. The mockup has no such strip; it is how the app keeps
  its rule of labelling every source.
- At 1280x720, Key metrics, the chart and the strip share the screen with the scrubber. The
  panel shows its first part and says "More below ↓". At 1920x1080 a 7-day window fits in full.
- A "Compare A B" launcher sits top centre.
- The Key metrics header names the source of the Sun and Earth positions. Inside IM-2's bundled
  window it is the "JPL Horizons table". The 29.5-day window runs past the end of that table,
  so the "in-app sky model" is used, and the same Earthset then reads 06:28 / 04:04 / 06:57 UTC
  instead of 06:32 / 04:08 / 07:00 UTC (shots 22 and 33). This is not a finding: each panel
  names its source, and `docs/lunyx/STATUS.md` says both that the tables apply inside their
  windows and that near the poles a few minutes is the timing accuracy, because Earth crosses
  the skyline slowly.

## On the GPU at full settings, next to the software-rendered pictures

| Site and time | GPU, full settings (this run) | Software-rendered (T-9 hand-over) | Same sky? |
| --- | --- | --- | --- |
| IM-2, 2025-03-06 17:28 UTC, facing the Sun | `649fc4e/1920x1080/18-im2-surface-sun-paths.jpg`, 60 fps | `docs/lunyx/handover/screens/t9-im2-landing-sun-2.5deg.jpg`, 1.0 fps | yes: Sun 65.68° / 2.46°, Earth 335.84° / 11.19° |
| IM-2, same time, Earth zoomed in | `649fc4e/1920x1080/33-im2-surface-earth-zoomed.jpg`, 6.5° field of view, 59 fps | `t9-im2-earth-phase.jpg`, 8.0° field of view, 0.4 fps | yes: half lit, with the same face and orientation of Earth |
| Apollo 11, 1969-07-20 20:17 UTC, facing the Sun | `649fc4e/1920x1080/24-apollo11-surface-landing-sun.jpg`, 59.8 fps | `t9-apollo11-landing.jpg`, 0.9 fps | yes: Sun 88.80° / 10.70°, Earth 272.20° / 59.23°, 67 % lit |

On the GPU the app keeps its full settings. Under a software renderer it switches to low power
by itself (`src/scene/surface/controller.ts`): no texture anisotropy, a coarser near-ground
mesh, no cast Sun shadows, decimated meshes and no fine grain. The GPU pictures show the same
terrain, Sun and Earth positions and sky paths as the software-rendered ones, at 60 fps instead
of about 1 fps, and no rendering fault was seen. When a panel covers much of the screen, the
app may lower its drawing resolution (70 % in shot 32) and says so in the strip.

## Findings from the T-8 run

The full records are in `docs/lunyx/qa-findings.md`.

- **Q-7, fixed in RC `bce6816`.** On `649fc4e` / `41be074` it was a known issue (deferred by
  D-14): a radius or spacing typed into "Nearby sites" went back to the last scan's values when a
  requirement changed before the scan. Operator decision D-16 lifted the deferral; Lunyx T-56
  fixed it, and the walkthrough verified the fix on `bce6816` at both sizes (above).
- **Q-8, new, not blocking (D-13).** The "Nearby sites" status line keeps the outcome of an
  earlier "Compare as B" after another scan has replaced the list, for example one the
  assistant ran around a new pin. In `38-scenario-1-nearby.jpg` it says, in green, "Candidate 1
  is pinned and loaded as B, against A: Pin 89.450° S, 137.200° W." That sits above a scan
  around Pin 88.000° S, whose candidate 1 is another site and is not loaded as B. The figures
  are right; the sentence is not.
- **Observation.** One renderer crash in three a11y runs, as described above. It was not seen
  again, including in the walkthrough's surface entries at both sizes.
