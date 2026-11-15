# Science merge map (lunyx-science T-4)

Owner: lunyx-science @merge. State at 2026-11-15 02:35 UTC. Conflict counts are from
`git merge-tree $(git merge-base A B) A B` (git 2.34), counting `+<<<<<<< ` lines, committed
refs only. Uncommitted work was listed by file name (`git --no-optional-locks status`) and never
merged. Refresh the tables before each delivery: every ref here moves.

## Our slices

| Task | Ref @ SHA | State | Paths (D-4) |
| --- | --- | --- | --- |
| T-5 terrain seam (Lunyx T-32) | am/lunyx-science/agent/terrain @ e4b06ef | @ice-targets' 5a1ba2a + merge of cc736f8; @terrain verifying (T-1) | src/terrain/{api,api.test,types}.ts, scripts/terrain-seams.mjs, docs/lunyx/handover/{T-32-edge-easing,T-4-terrain}.md |
| T-6 event spans, Earth disc (Lunyx T-31 items 2-3) | am/lunyx-science/agent/events @ 2ade856 | = am/lunyx/integration, which contains the D-4 base 5ad5d1f; nothing of its own yet | src/analysis/** except horizon.ts, nearby.ts; docs/lunyx/handover/T-31-event-spans.md |
| T-7 validation (Lunyx T-34) | am/lunyx-science/agent/validation @ cc736f8 | nothing committed; @ephemeris-check's hand-off a9bc640 is in am/lunyx/integration (9e4a507) | tests/fixtures/validation/{science-validation,ephemeris-check}/** |

am/lunyx-science/integration does not exist yet: the first gate pass creates it. The hand-over ref
for @upstream-sync is am/lunyx-science/agent/merge, fast-forwarded to each gate-passed tip.

## Committed refs against our slices

e4b06ef shares no file with any ref below: 0 conflict hunks in every pair, and 0 against the
events branch. None of these refs touches src/terrain/**.

| Ref | SHA | Contents | Contact with the events paths |
| --- | --- | --- | --- |
| am/lunyx/integration | 2ade856 | T-35 (595fe28, no file change), T-20, T-33, T-11 slice 1, T-31 item 1 (1289083, 5ad5d1f), T-34 round 2 (a9bc640) | base of T-6 |
| original @analysis | 8152392 | T-11 slice 2 (src/ui/compare/**), new src/analysis/edges.ts + edges.test.ts (edgeSpells) | inside @events' paths: new files, no shared file; reaches us only through integration (D-4). Do not create a file of that name. |
| original @surface | aba8e54 | T-10 HUD: src/ui/surface/**, src/scene/surface/controller.ts | none; reads nextEvents (below) |
| original @globe | 96b6337 | in integration | none |
| original @assistant | e290fa0 | e2e/**, README.md, docs/lunyx/actions.md (base 4f007f1) | none |
| origin/main (detector 02:20 UTC) | 282249d | landing labels, site areas: 27 files in src/core, src/scene, src/ui, public/data, scripts, package.json | none. Against integration: 2 hunks in src/ui/globe/siteCard.ts and siteCard.css (for @upstream-sync, not ours) |
| lunyx-experience merge / assistant / browser-qa | bbf3b2f / a64dada / 18bebba | original @assistant's e290fa0 on cc736f8 (merge: on 3899cb9) | none |

Uncommitted, file names only: @globe (29 entries: src/core skyEvents, coreActions, deepLink, clock,
presets; src/ui/shared/timeScrubber.ts; src/ui/globe/siteCard.ts), @analysis
(src/ui/compare/model.ts), @surface (T-10 handover docs only), @assistant (e2e/**, docs).
None is in our paths; @globe's are consumers of the event shape.

## Consumers of what we change

**T-5, terrain.** Types are additive (`TerrainSeam.eased?`, option `easeEdges`, export
`storedGrid`); the behaviour changes: `loadTerrainFor` eases the 3 m models at 19 sites.
- Analysis (src/analysis/engine.ts and everything on it): skyline at 10 of 19 sites moves, by up
  to 0.166 deg (Blue Ghost); Blue Ghost 2025-03-16 at 2 m: first cut 18:25 -> 18:38 UTC, last limb
  19:30 -> 19:43; Luna 23 sunrise 0.9 min earlier (T-32 handover; T-1 confirms or corrects).
- Surface view: src/scene/surface/groundSource.ts:127 (`sampleLevel`, exact-window copy) has to
  read `storedGrid(stack.sources[exact])`, or src/scene/surface.ts:485 `blendEdge` eases the edge a
  second time (0.2-0.6 m RMS, up to 6.7 m at SLIM). Original @surface's file, changed on no branch.
- Also importing the API: src/ui/globe/siteCard.ts, src/scene/globe/polarCloseUp.ts (polar layers,
  no 3 m model), scripts/bench-analysis.mjs. Fixture: tests/fixtures/validation/ephemeris-check/
  reference/skyline.apollo-11.m2.json was built from the stored files; Apollo 11 moves by 0.094 deg.
- Tests: none found that pins a moving value (the Blue Ghost window test brackets sunset between
  18:30 and 20:45 UTC; 5ad5d1f already left Apollo 15 out of the reference-skyline test for T-32).
  The full run on the candidate decides.

**T-6, events.** Consumers that type-check against `SkyEvent['type']` (tsconfig includes test files):
- `Record<SkyEvent['type'], ...>` literals with exactly four keys: src/core/analysisReport.ts:21
  (`nextEvents`), analysisReport.test.ts:33, src/ui/compare/model.ts:15,159 (EVENT_HINT too in
  @analysis's 8152392), src/ui/shared/timeScrubber.ts:22, and @surface's aba8e54
  src/ui/surface/metricsModel.ts:73,80,81. Adding a member to the `type` union breaks all of them.
- Typed `SkyEvent` literals: analysisReport.test.ts:41,70, src/ui/compare/model.test.ts:164. A new
  required field breaks them; optional fields do not.
- Behaviour: `findEvent()` (src/core/skyEvents.ts:44) filters `events` by type; analysisReport.ts
  lists `events`; window.test.ts:45-46 expects one sunrise and one sunset in a synodic month; @surface's
  metricsModel and hudActions tests read `nextEvents(...).sunset` as the last limb. An extra
  instant in `events` under an existing type changes the scrubber, jumpToEvent, the report and
  the HUD.
- Keep @analysis's four-line `blockageAt()` wording in window.ts through every merge (D-4).

**T-7, validation.** Fixtures only; contact only with @ephemeris-check's own later commits on
tests/fixtures/validation/ephemeris-check/**.

## Expected order on am/lunyx/integration

Done: 57adcef (T-35), 3899cb9 (T-20, T-33, T-11 slice 1, T-31 item 1), 2ade856 (T-34 round 2).
Next, from the coordinators' notes: origin/main 282249d through @upstream-sync. Neither shares a
file with our slices; each of our candidates merges whatever the tip is when it is built.

## Delivery format (agreed with original @upstream-sync and lunyx-experience @merge)

Ready head: am/lunyx-science/agent/merge @ full SHA, equal to the am/lunyx-science/integration tip.
1. The am/lunyx/integration SHA merged into it.
2. Tasks and files in it; shared files touched outside the team's paths; action names added or renamed.
3. Tests: commands, pass/skip counts, the tested SHA, load average, log path; gate result.
4. Numbers that move and who consumes them.
5. Predicted conflicts with other in-flight refs (merge-tree counts).
6. @validation's independent re-check: done or pending.
