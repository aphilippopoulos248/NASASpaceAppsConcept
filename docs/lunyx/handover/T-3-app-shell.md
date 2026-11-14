# T-3 App shell: handover (@globe)

Commit 4bb75cd (+ this note) on am/lunyx/agent/globe. Adds about 2,100 lines of source and no binaries.

## Built
- **Layout**: index.html is now a set of mount regions: wordmark, left, metrics, card, close, compass, chart, surface-hud, scrubber, locator, assistant, drawer, compare and toast. `body[data-view]` decides which regions show. main.ts only boots the app and calls `mount*(el)` for each region.
- **Stubs** at the paths owners will fill: src/ui/shared/{locatorMap,compass}.ts, src/ui/surface/{metrics,skylineChart}.ts, src/ui/compare/panel.ts, src/ui/assistant/drawer.ts (mountAssistantButton + mountAssistantDrawer).
- **Moved out of main.ts, now owned by @surface**: src/scene/surface/controller.ts (input, walking, lookAt, setGeneratedDetail) and src/ui/surface/hud.ts.
- **Design system** in src/styles/ (tokens.css, base.css, shell.css):
  - Type scale 11/13/15/18/24/32 on a 4 px grid.
  - At most two font families: Inter and Space Grotesk once the packages arrive; system fallback until then.
  - Component classes: `ly-panel`, `ly-btn` (+ variants), `ly-seg`, `ly-input`/`ly-select`/`ly-check`, `ly-label`/`ly-value` (tabular numerals)/`ly-kv`, `ly-legend`, `ly-tooltip`, `ly-note`.
  - Visible focus ring, prefers-reduced-motion respected (also skips the fly-to and the fade), WCAG AA text tokens.
  - The old style.css is removed and the existing UI is restyled.
- **State**: time, playing, rate, lightMode, site (a SiteRef: landing or custom pin), view, globeCenter and look all live in the store. Scenes are in src/scene/globe/{sceneHost,globeView}.ts. The mission filter has its own small store, src/core/missionFilter.ts, because AppState is a contract.
- **26 registered actions**, every one called by the UI through runAction (src/core/coreActions.ts, plus setGeneratedDetail in the surface controller): setTime, play, pause, setRate, setLightMode, selectSite (id, loose name or `pin:lat,lon`; optional surface:true), dropPin, clearSite, enterSurface, exitSurface, setGlobeCamera, lookAt, setMastHeight, setMissionWindow, setDelay, setSlopeLimit, setMaxEarthGap, setSunBand, setOverlay, showMissions, setFilters, saveScenario, compare, stopCompare, getState (query), setGeneratedDetail. Failed UI actions show a toast.
- **Analysis store**: src/core/analysisStore.ts covers the current scenario, slots A and B, and `requestNearby()`. States are idle/loading/ready/error, debounced 200 ms. NotImplemented shows as "Analysis not available yet…" and never as numbers. Scenario helpers are in src/core/scenario.ts.
- **Deep links** (src/core/deepLink.ts): `?site=&view=&light=landing&t=` are applied through actions with origin "url". The address bar follows site and view.
- **Server**: vite.config.ts plus server/plugin.ts route `/api/<name>` to the default export of server/api/<name>.ts (contract: ApiRequest → ApiResponse, with optional streaming). Dev uses ssrLoadModule; preview uses vite runnerImport. assistant, horizons and terrain are 501 JSON stubs. Unknown names return 404, and handler errors return 500 without internal detail.

## Verified
- `npm run build` passes; `npm test`: 28/28 (6 files).
- New tests: coreActions.test.ts (10), analysisStore.test.ts (3), deepLink.test.ts (1), server/plugin.test.ts (2).
- curl against both `vite preview` and `vite` (dev): /api/terrain and /api/horizons return 501 JSON; an unknown name returns 404.
- Playwright on Chromium (software WebGL):
  - globe → selectSite Apollo 11 → card shown (8 of 28) → "Surface view" button → view=surface; the HUD showed its status line.
  - Close button → globe with the site kept; URL is `?site=apollo-11`.
  - The Apollo program filter toggle works.
  - Deep link `?site=apollo-11&view=surface&light=landing` opened the surface view at Apollo 11.
  - Screenshots checked at 1280x720, 1920x1080 and 390x844.

## Not done / limits
- Surface view for custom pins: enterSurface refuses with a sentence. The surface needs the elevation service.
- The site card's Sun/Earth uses `skyAt()` when it exists. Until then it shows the old Moon-centre estimate, labelled "approximate, up to about 0.3° off, terrain not included".
- Walking (WASD) has no absolute action.
- SurfaceView keeps pitch private, so lookAt sets pitch through `look()`. A setter has been asked of @surface.
- Software WebGL runs at about 1–5 fps for both the old and new builds, so walking could not be verified headless. The yellow line artefacts in the surface view also appear in the original build.
- Fonts are waiting on the packages requested from @coordinator.
- server/ and vite.config.ts are not type-checked by the gate yet. They pass with a server tsconfig (proposal sent to @coordinator).
- T-12 items (lat/lon fields, sun band, overlay legend, pin drop by click, compass, locator, sunrise/sunset marks) are not part of this task.
