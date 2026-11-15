# Hand-off to Lunyx Standby (lunyx-standby), from Lunyx @coordinator

Written 2026-11-15 at about 05:40 UTC, on the operator's instruction (Lunyx m695): take one slice of the
desktop release path that can be done straight away, with file boundaries that do not overlap the work
in flight.

## Release ref

- Published head: `origin/feature/lunyx-navigator` = `am/lunyx/integration` = **b6f7392**. This is
  your project's base. Re-read it with `git ls-remote origin refs/heads/feature/lunyx-navigator` before
  you deliver, because it moves several times an hour.
- The release candidate (RC) is defined by decision **D-13** in Lunyx. Read it with
  `am hub api GET /api/hub/projects/Lunyx/decisions/D-13`. The RC is the first published commit that
  contains all of the blocking items below. One full `npm test` and one GPU smoke of the desktop flow
  run on that exact commit, and it is announced as "RC <sha>" to every project.

## Remaining gap to the RC (as of b6f7392)

| Item | Who | State |
| --- | --- | --- |
| T-49: both ends of each sunrise and sunset in the compare panel (A/B view, window table, CSV/JSON export, outlook) | Lunyx @analysis | Code and tests committed on `am/lunyx/agent/analysis` (8c13f7b); GPU check running |
| **T-56: lunyx-experience's Q-7, in the compare panel's Nearby sites tab: a typed Radius or Spacing is put back to the last scan's value when any requirement changes, so the scan silently covers the wrong area** | **lunyx-standby (your slice)** | Not started; nobody else is on it |
| Assistant examples for `listPresets` and `loadPreset` (their browser control test wants one for every action); the README and documents, including the T-50 wording | lunyx-experience | Their remaining deliveries, through Lunyx @upstream-sync |
| After the above: RC full `npm test` and GPU smoke, then lunyx-experience's walkthrough (their T-8) and final documentation pass (their T-11) on the RC | Lunyx @coordinator, @upstream-sync; lunyx-experience | Waiting |

Not blocking (D-13): T-24 (extensions), the surface view's eased 3 m edge, any run with a real
language model. T-50 (finer polar instants) already landed in b6f7392.

## Your slice: T-56 (Lunyx board)

Steps (lunyx-experience @desktop-workflow):
1. Drop a pin and open Compare, then "Nearby sites".
2. Type 900 in Radius and press Tab.
3. Type 30 in "Slope at most" and press Tab. Any requirement change does it.

Radius reads 2000 again, and "Scan nearby sites" scans within 2 km; its summary says "within 2.0 km".
The same happens to Spacing.

Their record is `docs/lunyx/qa-findings.md` (row Q-7 and its reproduction section). Their e2e todo test is
"a typed radius survives a change of the slope limit before the scan" in `e2e/flow.test.mjs`. Both
are at **21027f2** on `am/lunyx-experience/agent/desktop-workflow`; read them with `git show 21027f2:<path>`.

Cause, as read so far:
- `src/ui/compare/panel.ts` redraws the nearby tab on every requirement change. It is the
  `store.subscribe(['sunElMinDeg', 'sunElMaxDeg', 'maxEarthGapH', 'slopeLimitDeg'], ...)` block, which calls
  `nearby.render()`.
- `src/ui/compare/nearbyTab.ts` `render()` then refills Radius and Spacing from the panel state
  (`nearbyRadiusM`, `nearbySpacingM`). Only a scan updates that state, in `rankNearby` in `actions.ts`.

Done when:
- a typed Radius or Spacing survives such a redraw. For example, write the committed value to the
  panel state in `nearbyTab.ts`, or do not refill a field the user has changed;
- the scan uses what is shown;
- a unit test covers it;
- their e2e todo test would pass. Tell us, and we tell lunyx-experience to turn it into a normal test:
  `e2e/**` is their path.

### File boundaries

- **Yours for T-56:**
  - `src/ui/compare/nearbyTab.ts`;
  - `src/ui/compare/panel.ts`, only the nearby tab's state and its requirement-change redraw;
  - new test files beside them, e.g. `src/ui/compare/nearbyTab.test.ts`.
- **Not yours** (Lunyx @analysis is changing them for T-49):
  - `src/ui/compare/actions.ts`, `model.ts`, `windowTable.ts`, `windowsTab.ts`, `outlookTab.ts`,
    `outlookView.ts`, `compare.css` and their tests;
  - `docs/lunyx/validation.md`, `src/analysis/**`.

  If the fix needs one of these, ask first through Lunyx @coordinator.
- **Never:** `e2e/**`, `src/assistant/**` and the README (lunyx-experience), `package.json` and the
  lockfile, `docs/lunyx/STATUS.md` and `BRIEF.md` (Lunyx @coordinator).

Lunyx @analysis has been told that T-56 is yours and will not touch `nearbyTab.ts` or that part of
`panel.ts`.

## How to deliver

1. Your merge worker sends a gate-passed SHA of your integration branch to Lunyx **@upstream-sync**, with
   the base it contains and the files it changes. Use
   `am hub send -p lunyx --to @upstream-sync --key <unique> --stdin`. The first line labels it as an
   agent message relayed through the local manager, not written by the operator.
2. @upstream-sync merges it `--no-ff` onto the current `am/lunyx/integration` and runs the one full
   `npm test` for that candidate.
3. Lunyx @coordinator integrates it and publishes.
4. Never push, never merge into `am/lunyx/*`, never force.

House rules, all in force in Lunyx:
- **D-11:** a full `npm test`, `npm ci` and long numeric runs go under `flock /tmp/lunyx-heavy.lock`;
  GPU Chromium runs (`--use-gl=angle --use-angle=gl-egl --ignore-gpu-blocklist --enable-gpu`) go under
  `flock /tmp/lunyx-gpu.lock`. Build, `tsc` and a few vitest files take no lock. Record each run on the
  task as `<suite> @ <sha>: result, load, log`.
- **D-9:** desktop only (1280x720, 1920x1080).
- **`am hub send` has no `--help`:** a bare `am hub send <text>` posts to the current project's coordinator
  under the operator's name. Always pass `-p`, `--to` and `--key`.

Contacts:
- **Lunyx @coordinator:** scope, file boundaries, bottleneck changes (I tell your lead directly when the
  bottleneck moves).
- **Lunyx @upstream-sync:** delivery mechanics.
