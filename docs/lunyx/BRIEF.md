# Lunyx engineering brief

Lunyx is "Google Earth for the Moon" for the NASA Space Apps 2026 challenge *Lunar Landing
Site Navigator*: pick a place and a date, drop to the surface, and see where the Sun and
Earth sit against the real skyline, so a planner can judge power and direct-to-Earth
contact quickly and compare site/date options.

Read before you start (all in this repository):

| What | Where |
| --- | --- |
| Visual requirements (grey-box mockups, 6 pages) | `docs/reference/Lunyx-design.pdf` |
| Globe view mockup, full resolution | `docs/reference/globe.jpg` |
| Surface ("street") view mockup, full resolution | `docs/reference/surface.jpg` |
| Team document, both tabs (tab 2 = challenge criteria and the team's ideas) | `docs/reference/team-doc.txt` |
| Official challenge text | `docs/reference/challenge-page.txt` |
| Shared contracts | `src/core/types.ts`, `src/analysis/types.ts`, `src/terrain/types.ts` |
| Science entry points (signatures) | `src/analysis/api.ts`, `src/terrain/api.ts` |

UI workers: open the PDF and both JPGs as images, not just the text. The screen is what is
inside the grey box; the Earth / street / city photos are stand-ins that show the
*interaction*, not the look.

## 1. What the screens must be

**Globe view** (`globe.jpg`)
- Wordmark "LUNYX" top centre. A prominent, real 3D Three.js Moon in the middle with actual
  relief (LOLA), not a flat map on a ball. Stars behind it move as the globe turns.
- Left panel "Filters": UTC date/time, latitude and longitude of the point at screen centre
  (editable: typing flies there), solar elevation requirement `min < a < max`, "Show previous
  missions", "Show optimal landing area" (colour overlay with a legend and stated meaning).
- Click the globe to drop a pin at any coordinate; a "little person" affordance enters the
  surface view at the pin (drag onto the globe, or click).
- Compass lower left. Locator ("viewfinder") map lower right: whole-Moon map with a
  rectangle for the current view; click/drag on it turns the globe; scroll zooms.
- Time scrubber along the bottom ("0 hrs ... 24 hrs" in the sketch).
- A discreet assistant button lower right; the chat slides out as a drawer.

**Surface view** (`surface.jpg`)
- Drag to look around 360 degrees. Black sky, measured crater relief, Sun and Earth drawn at
  their true positions and true relative sizes (Earth about 3.6x the Sun's width), Earth
  showing its phase, Sun-directed terrain shadows.
- Upper left "Key metrics": Sun and Earth azimuth/elevation, clearance above the skyline,
  countdowns to the next sunset / sunrise / Earthset / Earthrise.
- Chart lower left (skyline with the Sun's and Earth's paths; expands). Locator map lower
  right marking the position. Time scrubber at the bottom with sunrise/sunset marks.
- Close button top right returns to the globe.

Typography and layout are deliberate: use the tokens and component classes in
`src/styles/` (added with the app shell) instead of ad-hoc sizes and colours. Everything
must work with keyboard only, carry accessible names, respect `prefers-reduced-motion`,
and stay usable at 1280x720, 1920x1080 and a 390 px wide phone.

## 2. Science rules

1. **Nothing invented.** Every number on screen is computed from real data or is shown as
   unavailable with the reason. Generated visual detail (rocks, sub-metre texture) stays
   labelled as generated. No placeholder metrics, ever, not even temporarily in a commit.
2. **Label everything**: units, UTC, east-positive longitude, the DEM product and its
   resolution, gaps in coverage, and the assumptions behind a metric.
3. **Frames and units** are fixed in `src/core/types.ts` (read the header comment).
4. **Airless and topocentric.** Sun/Earth azimuth and elevation are for the site itself (Earth's
   parallax across the Moon is up to 0.26 degrees, so Moon-centre directions are not good
   enough), with no refraction, matching JPL Horizons `APPARENT='AIRLESS'` for a
   `coord@301` observer.
5. **Dated geometry vs averages.** Horizons / SPICE give geometry for a specific date. The
   long-term average maps are a different thing: PGDA product 69
   (https://pgda.gsfc.nasa.gov/products/69) and they are used only for the average
   heatmap overlay, labelled as multi-year averages with their own resolution and extent.
6. **Skyline** = terrain horizon including the Moon's curvature, from the site's
   coordinates, terrain elevation and mast height. Clearance = body elevation minus skyline
   at the body's azimuth.
7. **Earth visibility is geometric** line of sight. Never present it as proof of a working
   radio link.
8. **Honest coverage.** Where only coarse elevation exists, say so next to the result.
9. Sample results are checked against actual JPL Horizons output (and an independent
   SPICE computation where practical); the comparison numbers are recorded in
   `docs/lunyx/validation.md`.

Core, in priority order: skyline -> Sun/Earth series -> clearance, illumination %, longest
darkness, Earth visibility and gaps, slope, next sunset/Earthset, blocking ridge -> +24 h
delayed arrival and A/B comparison with clear differences -> nearby alternatives with an
adjustable slope limit, mission-window results, mast-height comparison. At least two real
sites/windows must be playable from bundled data with no network and no credentials, and
custom coordinates must work.

Extensions, only after the core works (each tracked in `docs/lunyx/STATUS.md`): distance to
mapped ice targets (zenodo.org/records/4646092), geometric opportunities with named DSN
stations, Diviner seasonal temperatures, ShadowCam imagery, March 2025 Blue Ghost eclipse
replay, DEM-cached walking, historical mission trajectories where real data exists. The
landing error ellipse is struck out in the design and is lowest priority.

## 3. Who owns what

Edit only your own paths. If you need a change elsewhere, ask the owner (or @coordinator)
in a hub message; do not patch around it. New files go inside your own directories.

| Owner | Paths |
| --- | --- |
| @coordinator | `package.json`, `package-lock.json`, `vitest.config.ts`, `tsconfig*.json`, `scripts/ensure-deps.mjs`, `docs/lunyx/BRIEF.md`, `docs/lunyx/STATUS.md`, and the contract surface of `src/core/` (`types.ts`, `store.ts`, `bus.ts`, `actions.ts`, `time.ts`: changes go through @coordinator) |
| @globe (app shell + globe view) | `src/main.ts`, `index.html`, `src/style.css`, `src/styles/**`, `src/core/**` other than the contract files above (core actions, analysis store, scenario helpers, deep links), `vite.config.ts`, `server/plugin.ts`, `src/scene/globe.ts`, `src/scene/markers.ts`, `src/scene/sitePatch.ts`, `src/scene/sky.ts`, `src/scene/globe/**`, `src/ui/globe/**`, `src/ui/shared/**` (time scrubber, locator map, compass), `src/ui/filters.ts`, `src/data/**` |
| @terrain (elevation data) | `src/terrain/**`, `server/api/terrain.ts`, terrain/texture/heatmap scripts in `scripts/`, `public/data/dem/**`, `public/data/heatmap/**`, `public/terrain/**`, `public/textures/**` |
| @analysis (ephemeris + analysis) | `src/astro/**`, `src/analysis/**`, `server/api/horizons.ts`, ephemeris scripts in `scripts/`, `public/data/horizons/**`, `public/data/horizons-check.json`, `docs/lunyx/validation.md` |
| @surface (surface view + compare) | `src/scene/surface.ts`, `src/scene/surface/**`, `src/ui/surface/**`, `src/ui/compare/**` |
| @assistant (LLM control + QA) | `src/assistant/**`, `src/ui/assistant/**`, `server/api/assistant.ts`, `server/llm/**`, `e2e/**`, `README.md`, `.env.example` |
| @ice-targets (science layers) | `src/science/**`, `public/data/ice-targets/**`, `scripts/build-ice-targets.py`, `tests/iceTargets.test.ts` |
| @ephemeris-check (independent validation) | `tests/fixtures/**`, and nothing in `src/` or `scripts/`: this agent checks other people's numbers and must stay independent of their code |

`src/analysis/types.ts` and `src/terrain/types.ts` are contracts: their owner may add
fields; removing or renaming one needs a note in the hub first, because other workers
code against them.

Dependencies: do not edit `package.json` / the lockfile. Ask @coordinator for a package or
an npm script and it will arrive through the integration branch. Already installed: three,
astronomy-engine, @anthropic-ai/sdk, vitest (+ coverage), playwright 1.60.0 (Chromium is
already cached on this machine), geotiff, sharp, @types/node.

## 4. How the app fits together

- `src/core/store.ts`: one `AppState` (see `types.ts`) with `get()`, `set(patch)` and
  `subscribe(keys, fn)`. One clock (`timeMs`), one site, one mission window for every view.
- `src/core/actions.ts`: **the action registry (decision D-1, read its header)**. Every
  user-facing navigation, visualisation, analysis and output operation is a registered
  action with a name, a description and a parameter schema. UI controls call
  `runAction(name, params)`; they do not change state or scenes behind its back. The
  assistant's tools are generated from the same registry, so the assistant can do
  everything a user can, through the same code, and leaves the same state on screen.
  **If you ship a control, a gesture or an output, you register its action** in your own
  module and describe it well: the description is what the model reads. Continuous gestures
  (dragging the globe, looking around, scrubbing) map to an action with absolute parameters
  (camera pose, look direction, time), so the same end state is reachable by name.
  Action results are small JSON objects taken from real app state and analysis results;
  the assistant may quote numbers only from them.
- `src/core/bus.ts`: imperative commands between modules (`flyTo`, `lookAt`, `toast`).
- `src/core/time.ts`: the only UTC parsing/formatting helpers; use them for every time shown.
- Analysis store (`src/core/`, built with the app shell): runs `analyse()` for the current
  scenario and for comparison slots A/B, and `rankNearby()`, and publishes
  loading/ready/error, so every panel and the assistant read the same results and nothing
  is computed twice. Results an action produces stay visible in the UI.
- `src/main.ts` boots the renderer and calls each module's `mount...()` function. Modules
  build their own DOM inside the mount element they are given and import their own CSS.
- `server/plugin.ts` serves `/api/*` in both `npm run dev` and `npm run preview`; each
  handler lives in `server/api/<name>.ts`. Secrets are read from the server's environment
  only and never reach the browser bundle.

## 5. Working agreement

1. Start every task with `git merge am/lunyx/integration` (when that branch exists).
2. Run `npm ci` once in your worktree. Gate: `npm run build` must pass. Also run `npm test`
   before you hand over; new logic comes with tests (`*.test.ts` next to the code, run by vitest).
3. Commit on your own branch in small, described commits. Never push, never touch another
   worktree or the main checkout, never rewrite the upstream default branch.
4. When a task is done: `hub_task_update` with status `review` and a result that states
   what was built, how you verified it (commands + numbers), and what is not done.
   Be exact about limits: "works for the 28 catalogued sites; custom pins use the 1.9 km
   global grid only" is the kind of sentence that keeps the product honest.
5. Large downloads go to `scripts/.cache/` (git-ignored). Keep any single committed file
   under 25 MB and say in your result how much you added to the repository.
6. Blocked for more than a few minutes on something outside your control? Set the task to
   `blocked` with the reason and pick up your next task.
7. No secrets in code, commits, hub messages or logs.

## 6. Environment notes (this machine)

- Node 22.22, npm 10.9, TypeScript 7, Vite 8, three 0.187. 4 cores, no GPU guarantees:
  headless Chromium renders WebGL in software, so keep frame cost sane.
- Network works for JPL Horizons (`https://ssd.jpl.nasa.gov/api/horizons.api`, URL-encode the
  parameters), PDS Geosciences (LOLA, HTTP range requests work), NASA Moon Trek tiles and
  PGDA. `zenodo.org` answers 403 to plain scripted requests. `spaceappschallenge.org` fails
  TLS verification from curl/fetch; a copy of the challenge text is in `docs/reference/`.
- No LLM API key is present on this machine. The assistant must run its clearly labelled
  deterministic mode here, and use the model only when the server finds a key.
- Python 3.10 with numpy is available; `spiceypy` is not installed (a virtualenv under
  `scripts/.cache/` is fine for validation scripts).
- Existing data: 28 catalogued landings (`public/data/landings.json`), per-site terrain
  windows in `public/terrain/` (60 m SLDEM2015 / LOLA polar grids out to about 30 km, plus
  3 m LROC NAC models for 20 sites), global colour and normal maps in `public/textures/`.
  `scripts/fetch-terrain.mjs` shows how to read LOLA products by HTTP range request.
