<!-- DRAFT (checkpoint 2026-11-15): not yet reconciled with docs/lunyx/STATUS.md; see docs/lunyx/handover/T-16-T-17-checkpoint.md -->
# Lunyx

**A lunar landing site navigator.** Pick a place on the Moon and a date, drop to the
surface, and see where the Sun and Earth sit against the real terrain skyline, so you can
judge sunlight (power) and line of sight to Earth (communication) and compare sites and
dates. Built for the NASA Space Apps 2026 challenge *Lunar Landing Site Navigator*.

- **Globe view**: a 3D Moon with real relief, 28 catalogued landings, a pin anywhere,
  the arrival date, the required solar elevation band, overlays, a locator map and a time
  scrubber with sunrise / sunset / Earthrise / Earthset marks.
- **Surface view**: stand at the site and look around: black sky, measured relief, the Sun
  and Earth at their true positions and sizes.
- **Analysis** for a mission window at any site: illumination, longest darkness, Earth line
  of sight and its longest gap, ground slope, rise and set times against the terrain
  skyline, a delayed arrival, two scenarios side by side, nearby alternatives.
- **Assistant**: a drawer (button lower right) where you can ask in words. It operates the
  app through the same actions as the on-screen controls and lists what it did.

Everything on screen is computed from real data or shown as unavailable with the reason.
Earth visibility is geometric line of sight over the terrain: it is not a link budget.

## Run it

Needs Node 22 or newer. No account, key or network is required for the bundled sites.

```bash
npm ci
npm run dev        # development server, http://localhost:5173
```

```bash
npm run build      # type-checks (browser and server code) and builds into dist/
npm run preview    # serves the built app, with the same /api routes as dev
```

Both servers also serve the app's small API (`/api/assistant`, `/api/terrain`,
`/api/horizons`), so use one of them rather than a static file host.

### Tests

```bash
npm test           # unit tests (vitest) and the science data tests (node:test)
npm run coverage   # unit tests with a coverage summary
npm run e2e        # browser tests: builds, starts the app, drives it in headless Chromium
```

`npm run e2e` needs the Chromium that Playwright downloads (`npx playwright install chromium`
once on a new machine). It runs with every request outside the local server refused and
without any API key: see [e2e/README.md](e2e/README.md).

### Rebuilding the bundled data (optional, needs network)

The data the app needs is committed. These scripts rebuild it from the original archives:

| Command | Rebuilds |
| --- | --- |
| `npm run fetch-textures` | `public/textures/`: global colour and relief maps |
| `npm run build-dem` | `public/data/dem/`: whole-Moon and south-polar elevation grids (downloads about 410 MB) |
| `npm run fetch-terrain` | `public/terrain/`: 60 m elevation windows around each catalogued landing |
| `npm run fetch-apollo-terrain`, `npm run derive-detail` | high-resolution terrain, imagery and fine relief for the surveyed sites |
| `npm run build-heatmap` | `public/data/heatmap/`: long-term average illumination and Earth visibility |
| `npm run build-ice-targets` | `public/data/ice-targets/`: mapped ice-bearing shadowed regions (needs the Zenodo archive downloaded by hand) |
| `npm run fetch-horizons`, `npm run check-ephemeris` | reference values from JPL Horizons and the comparison against them |

## The assistant, with and without a language model

The assistant never has its own list of capabilities. Its tools are generated from the
app's action registry (`src/core/actions.ts`), the same registry every control uses, so it
can do what a user can do and leaves the same state on screen.

**Without a key** (the default) it answers in **deterministic mode**, and says so on every
reply: a fixed set of commands such as `go to IM-2`, `show Apollo 11 at its landing time`,
`set time to 2026-03-01 12:00`, `compare with a 24 h delay`, `what is the illumination?`.
Type `help` for the list, `/actions` for every action by name. It does not guess: if part
of a request is not understood, nothing is run and it says which part.

**With a key** it uses Claude through the server:

```bash
ANTHROPIC_API_KEY=... npm run dev
```

or copy `.env.example` to `.env.local` and put the key there. The key is read by the
server only; it is never sent to the browser or built into it.

| Variable | Meaning |
| --- | --- |
| `ANTHROPIC_API_KEY` | Claude API key. Without it: deterministic mode. |
| `LUNYX_ENV_FILE` | Read settings from this file instead of `.env.local` / `.env`. |
| `LUNYX_LLM_MODEL` | Model id. Default `claude-opus-5-5`. |
| `LUNYX_LLM_EFFORT` | `low`, `medium` (default), `high`, `xhigh`, `max`. |
| `LUNYX_LLM_PROVIDER` | `anthropic` (default with a key), `scripted` (a test stand-in, not a language model), `off`. |
| `LUNYX_LLM_ROUTER` | `direct` (default) or `jev` (with `TYPESAFE_API_KEY`): asks TypeSafe's Jev model how demanding a request is and sets the model's effort. Every tool still reaches the model. |

`.env.example` lists the rest. Voice dictation in the drawer uses the browser's own speech
recognition and appears only where the browser has it.

What has and has not been verified with a real model is recorded in
[docs/lunyx/actions.md](docs/lunyx/actions.md), together with every control and the action
behind it. Keyboard and screen-reader status is in
[docs/lunyx/accessibility.md](docs/lunyx/accessibility.md).

## What needs the network

Nothing, for the catalogued landings and for pins near the south pole: their elevation data
and the ephemeris model are bundled. The network is used only for:

- close-up imagery tiles around a selected site (NASA Moon Trek), a visual extra;
- `/api/terrain`, which builds a 60 m elevation window for a pin away from the bundled
  coverage (first use takes 5 to 10 s); offline, such a pin falls back to the 1.9 km
  whole-Moon grid and the result says so;
- `/api/horizons`, a proxy to JPL Horizons for reference tables;
- the language model, when a key is configured.

## Data sources and credits

| Data | Source | Used for |
| --- | --- | --- |
| Elevation, whole Moon and south pole | NASA LRO Lunar Orbiter Laser Altimeter (LOLA) gridded records, PDS Geosciences Node (LRO-L-LOLA-4-GDR-V1.0); Smith et al. 2017, *Icarus* 283 | relief, skylines, slopes ([details](public/data/dem/README.md)) |
| Elevation around landing sites | SLDEM2015 (LOLA + Kaguya Terrain Camera) and LOLA polar models; LROC NAC terrain models and orthophotos (NASA/GSFC/Arizona State University) | the surface view |
| Sun and Earth directions | astronomy-engine with the IAU lunar rotation model, checked against JPL Horizons (DE441) airless topocentric tables | every dated result ([validation](docs/lunyx/validation.md)) |
| Long-term average illumination and Earth visibility | NASA PGDA product 69, "Lunar Polar Illumination" (E. Mazarico) | the average overlays only; never mixed with dated results ([details](public/data/heatmap/README.md)) |
| Ice-bearing shadowed regions | Lemelin et al. 2021, Zenodo [10.5281/zenodo.4646092](https://doi.org/10.5281/zenodo.4646092), CC BY 4.0 | distance to mapped ice targets ([details](public/data/ice-targets/README.md)) |
| Global colour and relief maps, Earth | NASA SVS CGI Moon Kit (LROC WAC mosaic, LOLA), NASA Blue Marble | drawing the globe and the sky |
| Close-up imagery tiles | NASA Moon Trek | the globe near a selected site (online only) |
| Landing catalogue | compiled from mission records; positions marked approximate where not pinned down in LRO imagery | the 28 landing markers |

Libraries: three.js, astronomy-engine, the Anthropic SDK; fonts Inter and Space Grotesk
(SIL Open Font License).

## Conventions

UTC everywhere. Latitude north-positive; longitude east-positive, -180 to 180, in the
Moon's Mean Earth / Polar Axis frame. Heights are metres above the 1737.4 km reference
sphere. Azimuth is clockwise from north; elevation is above the local horizontal with no
refraction (the Moon is airless). Sun and Earth directions are for the site itself, not
for the Moon's centre.

## Known limits

- **Resolution.** Slopes and skylines rest on 40 to 160 m grids near the south pole, 60 m
  around catalogued landings and 1.9 km elsewhere. Metre-scale hazards are invisible, and
  distant narrow ridges read low where only the coarse grid exists. Each result names the
  data it used.
- **No north-polar detail.** The north pole has the 1.9 km grid only.
- **Dates.** The sky model is validated against JPL Horizons to about 0.003 degrees up to
  2035 and 0.02 degrees by 2100; times are limited to 1950 to 2100.
- **Averages are averages.** The overlay maps are 18.6-year averages, not the geometry of
  the selected mission window.
- **Earth visibility is geometry.** It says whether Earth's direction clears the terrain;
  it does not account for antennas, power or ground stations' schedules.
- **Headless and low-power devices.** The globe is drawn with WebGL; without a GPU it is slow.
- **Language model.** The assistant has not been run against a real model on the build
  machine (no key there); see `docs/lunyx/actions.md` for what was verified and how.

## Where things are

```
src/core/        state, the action registry, core actions, analysis store, deep links
src/scene/       the globe and the surface view (three.js)
src/ui/          panels: filters, site card, scrubber, locator map, assistant drawer, ...
src/analysis/    sky model, skyline, mission-window analysis, nearby alternatives
src/terrain/     elevation sources and loaders
src/assistant/   the assistant: conversation loop, deterministic mode, voice
server/          /api routes (vite plugin), the model relay in server/llm/
e2e/             browser tests
docs/lunyx/      engineering brief, validation record, capability inventory, handover notes
```
