# Lunyx

**A lunar landing site navigator.** Pick a place on the Moon and a date, drop to the surface,
and see where the Sun and Earth sit against the real terrain skyline, so you can judge
sunlight (power) and line of sight to Earth (communication) and compare sites and dates.
Built for the NASA Space Apps Challenge 2026, challenge *Lunar Landing Site Navigator*.

Lunyx is a desktop website (WebGL). Phone layouts exist but are not a target.

> **Not fully validated.** Two rounds of independent checks agree closely with most results,
> and some known differences and open items remain. They are listed under
> [How accurate it is](#how-accurate-it-is); read them before quoting a number from the app.

## What it does

- **Globe view.** A 3D Moon with real relief from the LOLA whole-Moon grid, 28 catalogued
  landings and a pin anywhere. Filters: UTC date and time, the latitude and longitude at the
  centre of the view, the required solar elevation band, mast height, mission window and
  arrival delay, "Missions to replay" (see [Run it](#run-it)) and "Go to a landing site", a
  list that also works from the keyboard. Overlays with legends: where the Sun is inside the elevation band (smooth
  Moon), long-term average sunlight and Earth visibility (NASA PGDA product 69, polar regions
  only), elevation-data coverage and mapped ice-bearing shadowed regions. A compass, a locator
  map and a mission-window time scrubber with jumps to rise and set events. Landing markers are
  coloured by the country their hardware belongs to, with optional flags. The site card shows
  who owns the hardware (from the GCAT catalogue), the area explored at the site, the data
  behind the site, the Sun and Earth against its skyline, and a site-science section: Deep
  Space Network station opportunities, long-term averages, the nearest mapped ice targets,
  Diviner annual maximum and mean temperature, and ShadowCam mosaics as links.
- **Surface view.** Stand at the site and look around: black sky, terrain drawn from the
  elevation data out to 246 km, the Sun and Earth at their computed positions and sizes,
  Earth's phase, terrain shadows and both bodies' tracks. Key metrics (upper left): Sun and
  Earth position and clearance above the skyline now, countdowns to the next sunset, sunrise,
  Earthset and Earthrise, the mission-window figures and where the numbers come from. A
  skyline chart (lower left) with the Sun's and Earth's samples over the window, a time mode
  and a table. An explanation of what hides the Sun or Earth at a given instant.
- **Compare panel.** Scenarios A and B side by side with B minus A in numbers and sentences;
  "B = A arriving N hours later"; "B = A with another mast"; named comparisons that reload
  exactly. Nearby alternatives: a scan around the site (radius, spacing, slope limit) ranked
  by sunlight and Earth contact, any candidate taken as B. The mission-window table (every
  sunlit, dark and Earth-in-view spell), downloadable as CSV or JSON. The seasonal outlook:
  sunlight and Earth's centre in view for each lunar day over the coming months, as a chart and
  a table.
- **Assistant.** A drawer (button lower right) where you ask in words. It operates the app
  through the same actions as the on-screen controls and lists what it ran. Without a
  language-model key it answers in a labelled deterministic mode (see
  [The assistant](#the-assistant)).

Every number comes from the datasets in [docs/lunyx/SOURCES.md](docs/lunyx/SOURCES.md), is
computed from them, or is shown as unavailable with the reason. Earth visibility is geometric line of sight over the
terrain, not a radio link budget. Sunlight percentage is a share of time with the Sun's disc
visible, not electrical power.

**Not built yet:** the start and the end of each sunset and sunrise as a pair (see
[How accurate it is](#how-accurate-it-is)); historical mission trajectories.
What is shipped, built and planned is tracked in [docs/lunyx/STATUS.md](docs/lunyx/STATUS.md).

## Run it

Needs Node.js 22 (tested with 22.22) and npm, and a desktop browser with WebGL. Without a GPU
the 3D views are slow. No account, key or network is needed for the 28 catalogued landings or
for pins near the south pole.

```bash
npm ci
npm run dev        # development server, http://localhost:5173
```

Three missions play in one step, offline, from the JPL Horizons tables bundled with the app.
Open one of these links, or pick it under "Missions to replay" at the top of Filters:

| Link (dev server) | What plays |
| --- | --- |
| http://localhost:5173/?preset=blue-ghost-landing | Blue Ghost Mission 1, Mare Crisium: touchdown on 2 March 2025 and 14 days of daylight, with the eclipse of 14 March |
| http://localhost:5173/?preset=im-2-landing | IM-2 Athena, Mons Mouton, 5° from the south pole: touchdown on 6 March 2025 and 14 days of low Sun, until it goes down behind the terrain on 19 March |
| http://localhost:5173/?preset=eclipse-2025-03-14 | Earth passing in front of the Sun, seen from the Blue Ghost site on 14 March 2025 |

Each opens the surface view and starts the clock (the landings at 12 h per second, the eclipse
at 10 min per second); the clock stops at the end of the mission window. With
`npm run preview` the same links work on port 4173.

```bash
npm run build      # type-checks the browser and server code, builds into dist/
npm run preview    # serves dist/, http://localhost:4173
```

Use one of these two servers rather than a static file host: they also serve the app's own
API (`/api/assistant`, `/api/terrain`, `/api/horizons`).

### Tests

```bash
npm test                  # unit tests (vitest), then the science data tests (node:test)
npm run coverage          # unit tests with a coverage report
npm run e2e               # browser tests: builds, starts the app, drives it in headless Chromium
npm run test:science      # the science data tests alone
npm run check-ephemeris   # the in-app ephemeris against stored JPL Horizons values at the 28 landings
```

`npm run e2e` needs Playwright's Chromium (`npx playwright install chromium` once on a new
machine). It runs offline with every model credential removed; see
[e2e/README.md](e2e/README.md) for subsets and options. The assistant's browser checks in
`e2e/scenario/` are run on their own; see [e2e/scenario/README.md](e2e/scenario/README.md). A few unit tests also check run time
(`src/analysis/nearby.test.ts`, `src/analysis/horizon.test.ts`) and can fail on a heavily
loaded machine; run that file alone before suspecting a regression.

### Rebuilding the bundled data (optional, needs network)

The data the app needs is committed. These scripts rebuild it from the original archives and
**overwrite the committed files** under `public/`:

| Command | Rebuilds | Download |
| --- | --- | --- |
| `npm run fetch-textures` | `public/textures/`: globe colour and relief maps, Earth | about 610 MB (NASA SVS files, and LOLA `LDEM_64.IMG` at 530 MB) |
| `npm run build-dem` | `public/data/dem/`: whole-Moon and south-polar elevation grids | about 410 MB |
| `npm run fetch-terrain` | `public/terrain/<site>.bin`: 60 m and 480 m windows around each landing | range requests only |
| `npm run fetch-apollo-terrain`, then `npm run derive-detail` | LROC NAC terrain, orthophotos and photo-derived relief for 19 sites | range requests |
| `npm run build-heatmap` | `public/data/heatmap/`: long-term average sunlight and Earth visibility | about 535 MB |
| `npm run build-ice-targets` | `public/data/ice-targets/`: mapped ice-bearing shadowed regions | the two files of the Zenodo record (0.7 MB) |
| `npm run build-diviner` | `public/data/science/diviner/`: annual temperature maps | 103 MB |
| `npm run build-shadowcam-index` | `public/data/science/shadowcam/`: mosaic index and coverage | 20 MB |
| `node scripts/build-horizons-bundle.mjs`, `npm run fetch-horizons` | `public/data/horizons/` and `public/data/horizons-check.json` from JPL Horizons | small |
| `npm run fetch-gcat` | `public/data/sources/gcat-landers.json`: who owns the hardware at each landing (GCAT) | two catalogue tables |
| `npm run fetch-site-areas` | `public/data/sources/`: LROC's measured hardware positions and the explored area at each site | small |
| `npm run build-licences` | `public/licences/THIRD-PARTY-NOTICES.txt`, from the installed packages (no download) | none |

`scripts/make-surface-detail.mjs` remakes `public/textures/surface_detail_*.jpg` from a
third-party asset pack that is not in the repository and whose origin and licence are not
recorded (see SOURCES.md, S9).

## The assistant

Its tools are generated from the app's action registry (`src/core/actions.ts`), the same
registry every control uses, so it can do what a user can do and leaves the same state on
screen. It may quote numbers only from the results of those actions.

**Without a key** (the default) it answers in **deterministic mode** and says so on every
reply: a fixed set of commands such as `go to IM-2`, `set time to 2026-03-01 12:00`,
`compare with a 24 h delay`, `what is the illumination?`. Type `help` for the list and
`/actions` for every action by name. It does not guess: if part of a request is not
understood, nothing is run and it says which part.

**With a key** it uses Claude through the server:

```bash
ANTHROPIC_API_KEY=... npm run dev
```

or copy `.env.example` to `.env.local` and put the key there. Keys are read by the server
only and never reach the browser.

| Variable | Meaning |
| --- | --- |
| `ANTHROPIC_API_KEY` | Claude API key. Without it: deterministic mode. |
| `LUNYX_ENV_FILE` | Read the settings from this file instead of `.env.local` / `.env`. |
| `LUNYX_LLM_MODEL` | Model id. Default `claude-opus-5-5`. |
| `LUNYX_LLM_EFFORT` | `low`, `medium` (default), `high`, `xhigh`, `max`. |
| `LUNYX_LLM_MAX_TOKENS` | Upper bound on one model step. Default 64000. |
| `LUNYX_LLM_BETAS` | `on` (default) or `off`: the Claude API's server-side fallback for declined requests, and tolerant handling of replayed reasoning. |
| `LUNYX_LLM_AUTH` | `profile`: use credentials the Anthropic SDK finds itself instead of a key. |
| `LUNYX_LLM_PROVIDER` | `anthropic` (default with a key), `scripted` (a test stand-in, **not** a language model), `off`. |
| `LUNYX_LLM_ROUTER` | `direct` (default) or `jev`: with `TYPESAFE_API_KEY`, TypeSafe's Jev model classifies each request and sets the model's effort. Every tool still reaches the model. |
| `LUNYX_JEV_MODEL`, `LUNYX_JEV_SIMPLE_EFFORT`, `LUNYX_JEV_MIN_CONFIDENCE`, `LUNYX_JEV_TIMEOUT_MS` | Jev settings; see `.env.example`. |

Voice dictation in the drawer uses the browser's own speech recognition (which may send audio
to the browser vendor) and appears only where the browser offers it.

**Limits.** The assistant has **never been run against a real language model or the real Jev
service on the build machine** (no keys there). It was checked with a scripted stand-in and in
deterministic mode only: `e2e/scenario/` drives every action and the brief's three-step request
("find a flatter nearby site with a shorter blackout, compare it for the same dates, show the
ridge at Earthset") in the browser and asserts each reported number against the app's own
result. With a key, the same request runs against Claude in one command, which writes a
transcript: `LUNYX_ENV_FILE=<file with ANTHROPIC_API_KEY> node e2e/scenario/real-model.mjs`
(after `npm run build`; see [e2e/scenario/README.md](e2e/scenario/README.md)). Its answers are generated by an AI model from Lunyx's own results:
NASA has not reviewed them and is not responsible for their accuracy. Every control and the
action behind it is listed in [docs/lunyx/actions.md](docs/lunyx/actions.md); keyboard and
screen-reader status is in [docs/lunyx/accessibility.md](docs/lunyx/accessibility.md).

## How accurate it is

The full record is [docs/lunyx/STATUS.md](docs/lunyx/STATUS.md), section 4, and
[docs/lunyx/validation.md](docs/lunyx/validation.md); the stored inputs and results are in
`tests/fixtures/`. The independent checks were made by a separate AI agent that worked from
the data and its own code, not from the app's code. They are not a NASA or peer review.

| What | Checked against | Result |
| --- | --- | --- |
| Sun and Earth azimuth and elevation at a site | 1008 JPL Horizons rows (airless, topocentric), 15 sets, 1969 to 2035 | Worst difference 0.0036°. After 2035 it grows (0.006° in 2060, 0.021° in 2099); dates are limited to 1950 to 2100 |
| Terrain skyline, observer 2 m up | An independent ray march over the bundled elevation files, five sites | Within 0.05° since `319fba0`. Builds up to and including `375f816`, GitHub `main`'s version on 14 November 2026 until `595fe28` brought the fix, read the skyline up to 1.04° too low at crest sites; at a Shackleton-rim pin that put Earth visibility 2.0 points high and rise and set times up to 6 h off |
| Skyline with the observer on or near the ground | An independent re-check at 0, 0.5 and 2 m at 9 pins, two of them chosen by a fixed rule before any app output was seen | Up to 1.2° too low on convex ground before `3899cb9`. Since then: worst difference 0.017° over 27 runs |
| Bundled elevation grids | The PDS originals, 30 080 samples; LRO LOLA laser shots at 17 of the 19 surveyed sites | Equal within rounding. Where the 3 m site models meet the 60 m windows, 768 m from a landing site, heights step by several metres. The 3 m model is the closer one to LOLA at 16 of 17 sites, so it stays. At Blue Ghost the two products put the 16 March 2025 sunset 3.5 to 3.7 min apart (2 m mast) |
| Sunset, sunrise and eclipse times | The validator's own skyline with Horizons and SPICE directions | Within 0.5 min |
| Published mission facts | Firefly (Blue Ghost), ISRO (Chandrayaan-3), the Apollo Lunar Surface Journal table | Blue Ghost eclipse times within 0.8 min; Chandrayaan-3's sunset date agrees; 42 of 43 Apollo rows agree. ISRO's "next sunrise 22 September 2023" is two days after first light by both computations, so the app's time is **not confirmed** by ISRO. No published time was found for IM-2 |
| 14 March 2025 eclipse at the Blue Ghost site | Reported 05:00, 06:18, 09:52 UTC | Computed 05:00:38, 06:17:21, 09:51:06 UTC |
| Long-term sunlight, 18.6 years, six polar points | The validator's own computation and PGDA product 69 | Within 0.03 points of the validator. IM-2: PGDA 46.55 %, validator 46.71 %, app 46.68 % |
| Earth visibility at limb and polar sites | The validator's skyline with Horizons Earth directions | Within 0.05 points. PGDA's Earth map counts any part of Earth's disc and reads 4 to 11 points higher by definition; the app counts Earth's centre |
| Deep Space Network station geometry | JPL Horizons with each station as the observer, on dates the author did not use | Elevation within 0.001°; limit crossings within 5.3 s, because the code places them only to its 10 s search step (a finer search is done in the science project, not delivered yet); terrain-set edges within 1.5 min |
| Seasonal outlook | The validator's own skyline and SPICE, a year at IM-2 and at a Shackleton-rim pin | Within 0.11 points per lunar day, except one row at the rim pin (0.57 points), traced to the skyline before `3899cb9`; its re-run is pending |
| Longest darkness and Earth gap followed past the window edge | Same, at IM-2, Chandrayaan-3 and Apollo 11 | Ends within 3.1 min |
| Slope | An independent recomputation at the 28 sites and 10 scan candidates | Identical. But a slope measured over 120 m on a 60 m grid cannot see lander-scale tilt: Surveyor 3 is published at 14°, the app gives 12.5° over 10 m on the 3 m model and 3.7° over 120 m; Apollo 14: 7° published, 7.2° against 1.3° |
| Surface view picture | The desktop walkthrough on a real GPU (GTX 1050 Ti), next to the software-rendered pictures | Full settings seen at IM-2 (6 March 2025, 17:28 UTC, 61 fps) and Apollo 11 (20 July 1969, 20:17 UTC, 60 fps) at 1920x1080; the Sun and Earth sit at the same place as in the software-rendered pictures |
| Landing positions and touchdown times | LROC's measured lander positions and published times (NSSDCA, Siddiqi 2018, the space agencies, Firefly), task T-38 | Every row now names its sources (SOURCES.md, S16). Luna 9 and Luna 13 have not been found in LRO images: approximate, uncertain by kilometres. Three times are not confirmed to the minute shown: Luna 23's time of day, Chandrayaan-3's and IM-2's minutes |
| Assistant with a real language model; the Jev router | — | **Never run** (see [The assistant](#the-assistant)) |

The figures above were computed at the catalogue positions used before T-38 moved the landers to
LROC's measured positions (IM-2 by 22 m, Blue Ghost 1 by 8 m, Chang'e 4 by 417 m). At IM-2 the
change is 0.1 point of sunlight and 0.2 h of darkness (validation.md).

**Sunset means "Sun fully set".** Wherever the app reports a sunset or sunrise it means the
instant the last of the Sun's disc goes behind the terrain (or the first of it appears).
The start of setting, when the skyline first cuts the disc and power begins to fall, is not
shown yet, and some panels still give the time without the words "fully set" (decision D-8 of
the project; the science team's implementation is not integrated yet). This matters: at Blue
Ghost on 16 March 2025, with a 2 m mast, the app gives **Sun fully set 19:30 UTC**; the science
team computes that setting started at 18:23 UTC, which matches Firefly's reported start of
night (about 18:15 to 18:35 UTC). With a 3.5 m mast the science team's figures are 18:38 and
19:44 UTC. At the poles the Sun can take far longer than an hour to set.

## What needs the network

Nothing, for the catalogued landings and for pins near the south pole: their elevation data,
the ephemeris model and two JPL Horizons windows (Blue Ghost Mission 1, March 2025; IM-2,
March to April 2025) are bundled. The network is used only for:

- close-up imagery around a selected site (NASA Moon Trek tiles), a visual extra;
- `/api/terrain`, which builds 60 m and 480 m elevation windows for a pin outside the bundled
  coverage from NASA's PDS (first use takes some seconds); offline, such a pin falls back to the
  1.9 km whole-Moon grid and the result says so;
- `/api/horizons`, a proxy to JPL Horizons;
- the language model and the Jev router, when keys are configured;
- voice dictation, through the browser's speech service.

## Data sources and credits

Lunyx is built on NASA data: LRO LOLA elevation grids and SLDEM2015 (NASA PDS Geosciences
Node), LROC NAC terrain models and orthophotos (NASA/GSFC/Arizona State University), the NASA
SVS CGI Moon Kit and Blue Marble, JPL Horizons ephemerides, PGDA product 69 (Mazarico et al.
2011) and NASA Moon Trek imagery tiles. Also: Kaguya TC imagery (JAXA, via Moon Trek), the
ice-bearing shadowed regions of Lemelin et al. 2021 (CC BY 4.0), Diviner annual temperature
maps by Schorghofer and Williams (CC0 1.0) and the ShadowCam archive (credited links only, no
imagery). Libraries: three.js and astronomy-engine (MIT), the Anthropic SDK (Apache-2.0); fonts
Inter and Space Grotesk (SIL Open Font License 1.1). Hardware ownership comes from GCAT,
the General Catalog of Artificial Space Objects by J. McDowell (CC BY 4.0), and hardware
positions from LROC (Wagner et al. 2017) and the Apollo Analyst's Notebook (NASA PDS).

Every dataset, with version, citation, licence or terms as read at the source, what Lunyx did
to it and its size, and every software dependency: [docs/lunyx/SOURCES.md](docs/lunyx/SOURCES.md).
Credit to NASA and the other providers is for the data only: no provider has reviewed or
endorsed Lunyx.

## How AI was used

Most of the code, the data-processing scripts, the tests, the validation and the
documentation were written by AI coding agents (Anthropic's Claude Code with Claude Fable 5.2
and Claude Opus 5.5) under the team's direction; the concept and the screens come from the
team's own design. The commit history carries a "Co-Authored-By: Claude …" line on such
commits. No image, video or audio in the project was made with a generative AI model, as far as
the records show; two items whose origin is not recorded are listed for the team. The full
disclosure, the inventory of every image, texture and data file and the NASA branding check
are in [docs/lunyx/AI-USE.md](docs/lunyx/AI-USE.md).

## Conventions

UTC everywhere. Latitude north-positive; longitude east-positive, -180 to 180, in the Moon's
Mean Earth / Polar Axis frame. Heights are metres above the 1737.4 km reference sphere.
Azimuth is clockwise from north; elevation is above the local horizontal with no refraction
(the Moon is airless). Sun and Earth directions are for the site itself, not for the Moon's
centre.

## Known limits

- **Resolution.** Beyond a site's 30.7 km window, sites away from the south pole have only
  the 1.9 km whole-Moon grid, which smooths narrow distant ridges. Slopes rest on 60 m grids
  except within 0.77 km of 19 catalogued sites; metre-scale hazards are invisible to the
  nearby scan, and a slope over 120 m can be several times smaller than the tilt a lander
  meets. Each result names the data it used.
- **No north-polar detail.** The north pole has the 1.9 km grid and on-request windows only.
- **Ephemeris.** Outside the two bundled Horizons windows (and for the seasonal outlook) the
  app uses its in-app model, checked against Horizons as above.
- **Averages are averages.** The long-term overlays are 18.6-year averages of "any part of the
  Sun visible"; they are never mixed with the dated mission-window figures.
- **Earth visibility is geometry**, to Earth's centre (and, for DSN, to a station above its
  elevation limit). It does not account for antennas, power or station schedules.
- **Generated detail.** In the surface view, rocks, small craters and sub-metre texture are
  generated, not measured, and labelled as such; a switch turns them off. The stars behind
  the globe are decoration, not a star map.
- **Landing catalogue.** Every landing names the source of its position and time. Luna 9 and
  Luna 13 are approximate (not found in LRO images), and three touchdown times are not confirmed
  to the minute shown (Luna 23, Chandrayaan-3, IM-2).
- **Ownership, areas and flags.** "Belongs to" is the state responsible for the hardware in the
  GCAT catalogue (USSR hardware is shown as Russia); no country owns lunar ground. Explored
  areas are drawn up to ten times larger than true size seen from orbit, so they can be seen,
  and true to size close to the ground; the card gives the true size. The flags are simplified
  drawings made by the code.
- **Custom pins** away from the south pole need the network for their 60 m window.
- **Desktop only.** The views need WebGL; without a GPU they render slowly.

## The demo for the submission

The official Project Submission Guide
(https://www.spaceappschallenge.org/resources/project-submission-guide/) sets the format:
"Video (30 seconds or less) or slide deck (up to seven slides including title and intro
slides)", and "Projects that exceed these limits will not be eligible for Global Judging." A
slide deck must show the team name, the names of the team members and the challenge. A
Navigator's earlier answer on GitHub (discussion 1991) gave the same limits; the guide
confirms them.

An outline built on the presets (each step still has to be confirmed in the desktop
walkthrough, task T-2, before it is recorded; at the time of writing the walkthrough had not yet
reached the presets, the surface view, the compare panel or the assistant):

- **Video, 30 seconds or less.** The guide's own beats: who you are (0-2 s), the challenge
  (2-5 s), the project's name (5-10 s), how it works (10-20 s), what it could do (20-30 s). For
  "how it works", `?preset=blue-ghost-landing` or `?preset=im-2-landing` shows the surface view
  with the Sun, Earth, key metrics and skyline chart while the clock runs; a full preset plays for
  about 28 s (the eclipse for 34 s), so record a few seconds of it, or pause it.
- **Slides, at most seven, title and introduction included.** 1: Lunyx, the team name, the
  members' names and the challenge. 2: the problem (power and line of sight to Earth depend on
  the local skyline, site and date). 3: the globe and a site card with its sources. 4: the
  surface view from a preset (IM-2's low Sun near the pole). 5: the compare panel (arrival 24 h
  later, nearby alternatives, the mission-window table). 6: NASA data used and how it was
  checked (with "not fully validated"). 7: how AI was used, and what comes next.

Known problem to steer around: typing coordinates into Filters > Centre of view can leave the
view, or a pin dropped straight after, somewhere other than the typed point (walkthrough findings
Q-1 and Q-2; being fixed by the original team as T-43). Use a preset, "Go to a landing site", a
catalogued site or a click on the globe instead.

What it must not claim: that the results are fully validated; that Earth visibility is a
working radio link; a sunset or sunrise time without saying which instant it is; that NASA
reviewed or endorsed Lunyx. Any AI-generated picture, clip or voice-over added to the demo
must carry a visible watermark or an acknowledgement (see AI-USE.md, sections 1 and 5).

## Where things are

```
src/core/        state, the action registry, core actions, analysis store, deep links
src/scene/       the globe and the surface view (three.js)
src/ui/          panels: filters, site card, scrubber, locator map, compare, surface metrics and chart, assistant drawer
src/analysis/    sky model, skyline, mission-window analysis, nearby alternatives, DSN, outlook
src/terrain/     elevation sources and loaders
src/science/     long-term averages, ice targets, Diviner, ShadowCam
src/assistant/   the assistant: conversation loop, deterministic mode, voice
server/          /api routes (a Vite plugin) and the model relay in server/llm/
scripts/         data download and packaging scripts
tests/fixtures/  independent validation inputs and results
e2e/             browser tests
docs/lunyx/      status, validation record, sources, AI use, actions, accessibility, handover notes
```

## Licence

The team has not chosen a licence for its own code yet; there is no `LICENSE` file. Data and
libraries keep their own terms, listed in [docs/lunyx/SOURCES.md](docs/lunyx/SOURCES.md). The
licence texts of the libraries and fonts that the website ships are served with it at
`/licences/THIRD-PARTY-NOTICES.txt` (`public/licences/`, regenerated by `npm run build-licences`).
