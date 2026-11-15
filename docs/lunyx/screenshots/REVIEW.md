# Desktop walkthrough: screenshots and review against the mockups

Task T-2 (project lunyx-experience), by @desktop-workflow. Desktop website only (decision
D-4): 1280x720 and 1920x1080. The release-candidate pass (T-8) retakes these once the original
team's remaining globe fixes are in.

## What was tested

| | |
| --- | --- |
| App build | the app tree of team integration `2f7e813`, which is the tree of the published `am/lunyx/integration` `27b0f30` (origin `feature/lunyx-navigator` at 03:30Z, 2026-11-15). The run's own commit, `06a7b5a` on `am/lunyx-experience/agent/desktop-workflow`, adds only test files and documents to it. **Published since then:** origin `feature/lunyx-navigator` moved to `9f949df` (original T-22 mission presets, T-38 landing catalogue positions); these shots do not show those changes. The centre-of-view and fly-to code behind Q-1, Q-2 and F-3 is unchanged there. |
| Renderer | `ANGLE (NVIDIA Corporation, NVIDIA GeForce GTX 1050 Ti/PCIe/SSE2, OpenGL ES 3.2)`, read from `UNMASKED_RENDERER_WEBGL` in every run. Headless Chromium (Playwright 1.60.0) with `--use-gl=angle --use-angle=gl-egl --ignore-gpu-blocklist --enable-gpu`. |
| Surface settings | full: the app chose its normal settings (`lowPower: false`; it picks low-power settings only for a software renderer). 60 fps at 1280x720 and at 1920x1080. |
| How | `e2e/qa/walkthrough.mjs` drives the real controls with mouse and keyboard and reads every value on screen from the DOM, against the app's own analysis output (`getAnalysis`, the published comparison and scan). Report: `e2e/qa/out/walk-2f7e813-r2/report.json` (not committed), 2026-11-15 03:47 to 03:50Z. |
| Network | the page could reach the network, as a judge's browser would; it contacted only the preview server and `trek.nasa.gov` (close-up imagery). |
| Time zones | 1280x720 ran in America/New_York and 1920x1080 in Europe/Berlin; every time on screen was UTC. |

| Size | Parts | Steps | Value checks | Time | Load |
| --- | --- | --- | --- | --- | --- |
| 1280x720 | site search and comparison, surface, assistant | 31 of 31 ran | 171 of 175 | 93 s | 4.3 to 9.3 |
| 1920x1080 | surface | 16 of 16 ran | 73 of 73 | 74 s | 6.3 to 9.3 |

The four failed checks are findings in the app, all at 1280x720 (`docs/lunyx/qa-findings.md`):
F-3 twice (typed 89.45° S: the view and the pin end at 89.4315° S, 0.56 km off), Q-4 (after
"Compare as B" the focus falls out of the compare dialog), and the pin card's elevation still
"Loading…" when the analysis was ready, after two polar elevation files failed to download
(`ERR_CACHE_WRITE_FAILURE`; the T-40 family, see Q-6). Everything else on screen equalled the
analysis: the pin card, the scan list (137 points, 43 ranked), the compare table and
requirement lines, Key metrics (Sun and Earth now, countdowns, mission window), the
blockage explanation, the chart table, the scrubber's marks and jumps, and the assistant's
numbers.

## Shots

All under `docs/lunyx/screenshots/27b0f30/`. JPEG, quality 80.

| Shot | What it shows |
| --- | --- |
| `1280x720/01-open.jpg`, `1920x1080/01-open.jpg` | the globe on opening: wordmark, Filters, globe with markers, compass, scrubber, locator, little person, assistant button |
| `1280x720/04-pin-card.jpg` | a pin typed at 89.45° S, 137.2° W: it lands at 89.431° S (F-3); its card with the sky against the skyline and the mission-window figures |
| `1280x720/07-nearby-ranked.jpg` | "Nearby sites": 2 km radius, 300 m spacing, slope at most 8°; 137 points, 43 ranked; each row with Pin and "Compare as B" |
| `1280x720/08-compare-candidate-as-b.jpg` | "A and B" after "Compare as B" on rank 1: the pin against the candidate 300 m south, B − A, the differences in words |
| `1280x720/12-im2-card-landing.jpg` | IM-2's card at touchdown, 2025-03-06 17:28 UTC |
| `1280x720/14-im2-surface-key-metrics.jpg`, `1920x1080/06-…` | the surface view at IM-2 with Key metrics, the skyline chart and the status strip |
| `1280x720/15-im2-surface-why-sun.jpg` | "why?" on the Sun row: the terrain that forms the skyline at the Sun's azimuth (18.4 km away, 368 m above the site) |
| `1280x720/16-im2-surface-chart-table.jpg`, `1920x1080/08-…` | the chart's table view (every row checked against the analysis series) |
| `1280x720/17-im2-surface-earth.jpg`, `1920x1080/09-…` | "Face Earth": Earth at azimuth 335.8°, 11.2° up, half lit; at 1280x720 its 7-day sky path is drawn beside it |
| `1280x720/18-im2-surface-sun-paths.jpg`, `1920x1080/10-…` | "Face Sun" with sky paths: the Sun 2.46° up at azimuth 65.7°, 1.63° above the skyline |
| `1280x720/22-im2-surface-at-sun-fully-set.jpg`, `1920x1080/14-…` | the clock moved to "Sun fully set" (2025-03-19 23:16 UTC in a 29.5-day window), facing the Sun |
| `1280x720/24-apollo11-surface-landing-sun.jpg`, `1920x1080/16-…` | Apollo 11 at touchdown, 1969-07-20 20:17 UTC, facing the Sun |
| `1280x720/25-assistant-open.jpg` | the assistant drawer in deterministic mode |
| `1280x720/28-assistant-compare.jpg` | "compare with a 24 h delay": the assistant's numbers next to the compare panel's; the panel says the default 0° to 90° band is no requirement while the assistant's previous reply called it a requirement not met (Q-5) |
| `1280x720/30-assistant-surface.jpg` | "enter the surface then look at the sun" |

## Globe view against `docs/reference/globe.jpg`

**Matches the mockup.** The LUNYX wordmark is top centre. A real 3D Moon with LOLA relief sits
in the middle, drawn with its relief exaggeration stated on screen ("Relief ×10, LOLA
elevation"), with stars behind it. The Filters panel is on the left: arrival date and time
(UTC), latitude and longitude of the centre of view (editable, typing flies there), the solar
elevation requirement as `min < α < max`, "Show previous missions" and "Show optimal landing
area" with its legend. The compass is lower left, the locator ("viewfinder") map lower right
with the view's footprint, the time scrubber along the bottom (`0 h … 24 h`), the little person
next to the locator ("Drag onto the Moon"), and a discreet assistant button lower right whose
drawer slides out.

**Deviates, and why.**
- The Filters panel holds more than the sketch: mission parameters (mast height, mission
  window, arrival delay), terrain relief, sunlight on the globe, data coverage, ice targets and
  country flags. At 1280x720 it scrolls; its last note is cut at the panel's lower edge.
- A site card on the right carries what the sketch leaves to the "LLM to fetch info" box:
  coordinates, elevation and its data, the sky now against the skyline, and the mission-window
  figures. It is the main place where a planner reads the numbers.
- A "Compare A B" launcher top left opens the comparison (not in the sketch; added with T-11).
- The time scrubber has more than a slider: a UTC date field, Now, playback speed, window
  length and jump buttons to the next rise and set.
- Coordinate entry has defects near the poles and while the globe flies (Q-1, Q-2, F-3 in
  `docs/lunyx/qa-findings.md`).

## Surface view against `docs/reference/surface.jpg`

**Matches the mockup.** "Key metrics" upper left: Sun and Earth azimuth, elevation and
clearance above the skyline, countdowns to the next sunset, sunrise, Earthset and Earthrise
(each with the instant it means, for example "Sun fully set"), and the mission-window figures.
Drag (and the arrow keys) turn the view through 360°. A chart lower left plots the skyline with
the Sun's and Earth's paths and expands; it also has a table view. The locator map lower right
marks the site. The time scrubber at the bottom carries the sunrise and sunset marks. The close
button is top right. The sky is black; the Sun and Earth are drawn where the analysis puts them
and at their true relative size (Earth about 3.6 times the Sun's width); the ground is measured
relief with the stated elevation products.

**Deviates, and why.**
- A status strip above the scrubber states where the viewer faces, the frame rate and
  resolution, the elevation products behind each distance band, what is generated, and who the
  hardware at the site belongs to. The mockup has no such strip; it is how the app keeps its
  rule of labelling every source.
- At 1280x720 the Key metrics panel, the chart and the strip share the screen with the
  scrubber: the panel shows its first part and says "More below ↓"; at 1920x1080 it shows in full.
- A "Compare A B" launcher sits top centre.

## Surface view at full settings on the GPU, next to the software-rendered pictures

`docs/lunyx/STATUS.md` said: "Full visual settings at a polar site have not been seen on a real
GPU." They have now, at IM-2 and at Apollo 11.

| Site and time | GPU, full settings (this review) | Software-rendered (T-9 hand-over) | Same sky? |
| --- | --- | --- | --- |
| IM-2, 2025-03-06 17:28 UTC, facing the Sun | `27b0f30/1920x1080/10-im2-surface-sun-paths.jpg`, 61 fps at 90 % resolution | `docs/lunyx/handover/screens/t9-im2-landing-sun-2.5deg.jpg`, 1.0 fps | yes: Sun 65.68° / 2.46°, Earth 335.84° / 11.19°, 50 % lit, in both |
| IM-2, same time, facing Earth | `27b0f30/1920x1080/09-im2-surface-earth.jpg` (70° field of view) | `t9-im2-earth-phase.jpg` (8° field of view) | yes; the hand-over picture is zoomed in, so Earth's phase is larger there |
| Apollo 11, 1969-07-20 20:17 UTC, facing the Sun | `27b0f30/1920x1080/16-apollo11-surface-landing-sun.jpg`, 60 fps | `t9-apollo11-landing.jpg`, 0.9 fps | yes: Sun 88.80° / 10.70°, Earth 272.20° / 59.23°, 67 % lit |

On the GPU the app keeps its full settings (`lowPower: false`). Under a software renderer it
switches to low-power settings by itself (`src/scene/surface/controller.ts`): no texture
anisotropy, a coarser near-ground mesh, no cast Sun shadows, decimated meshes and no fine
grain. The GPU pictures show the same terrain, Sun and Earth positions and sky paths as the
software-rendered ones, at 60 fps instead of about 1 fps, and no rendering fault was seen. At
1920x1080 the app lowered its own drawing resolution to 90 % (its automatic resolution
scaling) and says so in the status strip.
