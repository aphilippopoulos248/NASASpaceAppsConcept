# T-16 / T-17 checkpoint: hand-over from Lunyx @assistant

2026-11-15. T-16 and T-17 moved to project lunyx-experience (operator decision, Lunyx m318).
Branch `am/lunyx/agent/assistant`, worktree `/home/me/.agent-manager/worktrees/lunyx/assistant`.
The checkpoint commit is the one that adds this file; its base is integration 4f007f1
(33 actions). `am/lunyx/integration` has moved on since (cc736f8 and later: 43 actions,
rebuilt surface view, globe relief and overlays, site science) and is **not merged** here.

## Test run at the checkpoint

`npm run e2e` on this branch (build of 4f007f1 plus these files), 2026-11-15, 41 minutes at
load average 11 to 20: **55 tests, 48 pass, 2 fail, 5 todo** (expected failures, reported).

| File | Tests | Result |
| --- | --- | --- |
| `e2e/assistant.test.mjs` | 14 | all pass (deterministic mode 9, scripted model 5) |
| `e2e/a11y.test.mjs` | 8 | all pass |
| `e2e/equivalence.test.mjs` | 22 | 19 pass; todo: Escape in the surface view also deselects (F-1, fixed by T-33 in review: drop the `todo` mark once it passes); **fail**: the two camera cases below |
| `e2e/flow.test.mjs` | 11 | 7 pass; todo: typed coordinates near the pole (F-3; this run: typed -88, view centred on -87.91), and three placeholders for the compare panel, the nearby list and the surface key metrics (T-10, T-11) |

The two failures, not investigated:
- "arrow keys, plus / minus, drag and wheel on the globe": the pose after the gesture and the
  pose after replaying the logged `setGlobeCamera` differ by 0.02 degrees of longitude (59.82
  against 59.8).
- "locator map click and its zoom buttons; compass": the locator's label reads 10.00° N,
  20.00° E on one path and 9.99° N, 20.02° E on the other.
Both look like the logged action not reproducing the UI's pose exactly (rounded parameters
in the log, or the camera still moving after the gesture). Check which before changing the
tolerance; if the log rounds, it is @globe's.

## File by file

| File | State |
| --- | --- |
| `e2e/run.mjs`, `e2e/lib/servers.mjs`, `e2e/lib/app.mjs`, `e2e/README.md` | done: the harness |
| `e2e/assistant.test.mjs`, `e2e/a11y.test.mjs` | done for the 4f007f1 build |
| `e2e/equivalence.test.mjs` | draft: two failing camera cases; no cases yet for the controls added since 4f007f1 |
| `e2e/flow.test.mjs` | draft: three placeholders wait for T-10 / T-11 |
| `docs/lunyx/actions.md` | draft: inventory of the 33-action build. Missing: `setFieldOfView`, `lookAtBody`, `walkTo` (closes G-1), `setSkyAnnotations`, `getSurfaceView`, `setReliefExaggeration`, `showCoverage`, `showIceTargets`, `getSiteScience`, `nearestIceTargets`, `getState.globeDisplay`; and from T-33 (in review, Lunyx m315): `listSites`, site `summary` / `links`, `getState.moonPhase` / `locatorZoom` / `panels`, `showPanel "site-science"`, event `label` / `eventDefinitions`, `lookAt.fovDeg` 4 to 100 |
| `docs/lunyx/accessibility.md` | draft: first round on 4f007f1; the rebuilt surface view, relief and overlay controls and the site-science section are not covered |
| `README.md` | draft: not reconciled with `docs/lunyx/STATUS.md` (validation limits, D-8 "sunset" is the last limb, compare and nearby have no panel yet, generated surface detail); no links to STATUS.md, SOURCES.md, AI-USE.md; `moon_normal_8k.webp` comes from LOLA LDEM_64, not the SVS kit |
| `docs/lunyx/handover/T-17-sources-research.md` | notes for SOURCES.md and AI-USE.md: what was checked at each source, the asset inventory, what would follow for the operator to approve, and the list of what could not be established |
| not started | SOURCES.md, AI-USE.md, screenshots and their review against the mockups, the T-1 browser scenario (needs `rankNearby`, `selectCandidate`, `explainBlockage`) |

## Findings not yet sent to their owners

1. A-1 (@globe): no keyboard path to open a catalogued landing from the globe. T-33's
   `listSites` is a query; keyboard users still need an on-screen list.
2. A-2 (@surface): the look direction in the surface view is pointer-only.
3. A-3 (@globe): glyphs inside the jump buttons' names; recheck with T-33's new labels.
4. The two camera equivalence failures above (owner unclear until checked).
5. `public/data/ice-targets/README.md`, the geojson's `lunyx` block and
   `scripts/build-ice-targets.py` cite doi:10.3847/PSJ/abf3c3, which does not resolve; the
   paper is 10.3847/PSJ/abf3c5 (owner of the ice-target files; @ice-targets is retired).
6. The built bundle carries no licence notices for three.js or the fonts (build config).
7. F-2 (the card's "Sky at" lagging the clock) was reported from code reading only; no test
   shows it yet.

## Running the harness

```bash
npm run e2e                     # build, two preview servers (deterministic, scripted), all files
npm run e2e -- flow             # only files whose name contains "flow"
npm run e2e -- --no-build       # reuse dist/
npm run e2e -- --grep=Escape    # only tests whose name matches
E2E_TIMEOUT_MS=240000 npm run e2e   # longer timeouts on a busy machine
```

Wrap full runs in `flock /tmp/lunyx-heavy.lock` (the shared convention). Failure details
appear in `e2e/artifacts/last-run.tap` as soon as each test ends. The servers run with every
model credential removed and the pages offline. If a run is interrupted, check
`pgrep -af '[v]ite.js preview'` and stop leftovers in a separate command. Headless WebGL is
software-rendered here; the shared notes say Chromium can use the GPU with ANGLE gl-egl
flags, which `e2e/lib/app.mjs` does not pass yet (untested).

## What I would do next

1. Merge `am/lunyx/integration` (then T-33), rebuild, run `npm run e2e`, adapt the tests to
   the rebuilt surface view, and drop the Escape `todo` mark if it passes.
2. Settle the two camera failures.
3. Bring `actions.md` up to the current registry, then add an equivalence case per new control.
4. The T-1 scenario in deterministic mode and with a scripted script, once the T-10 / T-11
   actions exist; then the verification report (real model never run: no key on the machine).
5. Add NASA's SI rule to the system prompt (`server/llm/prompt.ts`): never attribute output
   to NASA (see the research notes, section 5).
6. Screenshots at 1280x720, 1920x1080, 390x844 and the review against `docs/reference/`;
   second accessibility round.

The assistant itself (T-15) is integrated; its design is in `docs/lunyx/handover/T-15-assistant.md`.
