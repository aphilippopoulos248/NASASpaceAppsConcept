# Landing-site decision engine (MVP): design and work plan

Operator request, Lunyx m1100. Decision D-17. Coordinator: Lunyx @coordinator. The contract is
in `src/analysis/decision/types.ts` and `api.ts`, `src/terrain/types.ts` (`RegionTerrain`) and
`src/terrain/region.ts`, plus two state fields in `src/core/types.ts` (`decisionProfileId`,
`decisionOverrides`). It is coordinator-owned: change it only through the coordinator.

MVP rule: working end to end first. Use the measurements the app already makes. No new
simulation, and no invented data: what cannot be measured is `null` and its criterion is
`unknown`.

## 1. What it does

For each candidate site and a mission profile:

1. **Measure** six quantities with the existing pipeline. Each `MeasuredValue` carries its basis
   (dataset, resolution, window, method) and, when it is a bound or missing, says so.

   | Criterion | Value | Sense | Safety | Source |
   | --- | --- | --- | --- | --- |
   | `sunlight` | time-averaged visible solar disc, % | higher | no | `WindowMetrics.illuminationPct` |
   | `darkness` | longest darkness, h (a lower bound if open-ended) | lower | no | `longestDarknessH`, `darknessOpenEnded` |
   | `earthVisibility` | line of sight to Earth's centre, % | higher | no | `earthVisiblePct` |
   | `commBlackout` | longest spell without it, h | lower | no | `longestEarthGapH`, `earthGapOpenEnded` |
   | `slope` | slope over the landing region, deg | lower | **yes** | `RegionTerrain.slopeDeg` (T-72) |
   | `roughness` | roughness / hazard proxy over the landing region, m | lower | **yes** | `RegionTerrain.roughnessM` (T-72) |

   Earth figures are geometry with the terrain skyline (direct-to-Earth line of sight), not a
   link budget. The UI and the sentences say so.

2. **Check hard constraints.** For each criterion the verdict is `pass`, `fail` or `unknown`:
   - `pass` when there is no threshold, or the value meets it;
   - `unknown` when the value is null. A lower bound that already breaks a maximum is a `fail`; a
     bound that cannot settle the verdict is `unknown`.

   A site is `feasible` only when every criterion passes. It is `infeasible` when any criterion
   fails, and `unknown` when none fails but some are unknown. Unknown is never counted as a pass.

3. **Rank the feasible sites only.**
   - Per criterion, `score = clamp((v - worst) / (ideal - worst), 0, 1)`. `ideal` is the best
     possible value (100 %, 0 h, 0 deg, 0 m). `worst` is the threshold when one is set, otherwise
     the criterion's reference worst value (`CriterionDef.worst`; `'window'` means the window
     length). The score therefore does not depend on which other sites are in the list.
   - `utility = sum(weight_i x score_i)`, with weights normalised to sum 1 over the criteria.
     Ties are broken by site id.
   - The result always shows the weights used and the `UTILITY_NOTE`: utility orders sites under
     the chosen weights, and it is not a probability of success.

4. **Pareto frontier** of the feasible sites on the raw values: a site is on the frontier when no
   other feasible site is at least as good on every criterion and strictly better on one.

5. **Explain deterministically.** Sentences come from templates and numbers only: the verdicts,
   which criterion limits a site's utility, why #1 beats #2 (the largest weighted score
   differences), which constraints removed most candidates, and for a pair, dominance or the
   trade-off criterion by criterion.

## 2. Mission profiles and safety

`public/data/mission-profiles.json` (T-71) holds a few presets. Each has a window length, a mast
height, a landing radius, thresholds, weights and **sources**.
- Every number cites where it comes from, or is labelled "illustrative default" and is
  configurable. No threshold is presented as a NASA requirement without a citation.
- Suggested presets: a polar lander with a short surface stay, a polar long stay (darkness and
  blackout limits), and an equatorial daylight sortie. The workers verify the sources.

Overrides go through `resolveProfile()`.
- Tightening anything is allowed.
- Loosening a **safety** threshold (slope, roughness) beyond the profile's value, or removing it,
  is refused unless `allowSafetyRelaxation: true`. When it is allowed, it is listed in
  `relaxations` on every result and shown in the UI.
- The assistant may set that flag only when the user explicitly asks to relax that limit, and it
  must say so in its reply.

The UI and the tools share one current setting: `AppState.decisionProfileId` (`''` = the first
preset) and `decisionOverrides`. Tool calls without profile arguments use it. Every result echoes
the profile and the overrides used.

## 3. Tools (registered actions; the assistant gets them automatically)

| Action | Effect | Params | Result |
| --- | --- | --- | --- |
| `listMissionProfiles` | query | none | the presets with thresholds, weights and sources |
| `getDecisionSettings` | query | none | the current profile id, overrides, the resolved profile and its relaxations |
| `setDecisionSettings` | command | `profileId?`, `overrides?`, `reset?` | the same as `getDecisionSettings` after the change (refusals as an error with the reason) |
| `evaluateSite` | query | `site?` (landing id or name, or `{lat, lon}`; default: the selected site), `profileId?`, `overrides?` | `{ profile, relaxations, evaluation }` with rounded numbers and `UTILITY_NOTE` |
| `compareSites` | query | `siteA`, `siteB`, `profileId?`, `overrides?` | `{ profile, relaxations, comparison }` |
| `findBestSites` | query | `candidates`: `{from:'catalogue'}`, `{from:'sites', sites:[…]}` or `{from:'nearby', around?, radiusM, spacingM}`; `limit?` (default 5); `profileId?`, `overrides?` | `Ranking`, trimmed to the top `limit` plus counts, the Pareto ids, and the unknown / infeasible sites with their deciding reasons |

How each source is measured:
- `catalogue` and `sites` use `analyse()` (the full analysis, cached) and `loadRegionTerrain()`.
- `nearby` reuses `rankNearby()`'s window metrics and slope pre-filter, then `loadRegionTerrain()`
  for each candidate. Its basis says the nearby scan's speed settings.
- Progress is reported. The number of candidates is capped, with the cap stated.

Schemas are strict (D-3): unknown keys and out-of-range numbers are refused with a reason.

## 4. Interface

A **"Rank sites"** tab in the compare panel, in the current styling (design tokens; desktop D-9),
driven only through the actions above (D-3):
- a profile picker, then editable thresholds and weights. Safety thresholds are marked; loosening
  one asks for confirmation and then shows a "relaxed" badge;
- a candidate source (catalogue, the selected site's surroundings, or the saved A/B sites);
- a ranked table with pass / fail / unknown badges per criterion, utility, a Pareto mark, and the
  reasons on hover. Unknown and infeasible sites are in their own sections, with their reasons;
- pick two rows to compare: per-criterion deltas, dominance, sentences;
- "Open", "Compare as A/B" and "Pin" buttons that use the existing actions;
- the utility note under the table.

## 5. Assistant (lunyx-experience)

- **Requests in plain language** map to the structured inputs: a profile, overrides and
  candidates. Example: "a polar lander, at most 50 h of darkness, slope under 8°" becomes
  `setDecisionSettings` or `findBestSites` with overrides.
- **Never fabricate:** every number in a reply comes from a tool result in the same turn. When a
  value is `unknown`, the reply says unknown and why.
- **Never relax silently:** a safety relaxation needs the user's explicit words, and the reply
  names it.
- **The deterministic fallback** gets intents for the three tools and the profile picker.
- **Prompt rules** in `server/llm/prompt.ts`. Equivalence and control cases for every new action;
  an e2e scenario from a request to a ranking to an explanation.

## 6. Workstreams and file boundaries

| Task | Owner | Paths |
| --- | --- | --- |
| Contract | @coordinator | `src/analysis/decision/types.ts`, the stub signatures in `api.ts`, `RegionTerrain` in `src/terrain/types.ts`, `src/terrain/region.ts` signatures, the two `AppState` fields, this note |
| T-71 engine | @analysis | `src/analysis/decision/**` (bodies of `api.ts`, new files, tests), `public/data/mission-profiles.json` |
| T-72 region terrain | @surface | `src/terrain/region.ts` (bodies), `src/terrain/region.test.ts` |
| T-73 tools and orchestration | @globe | `src/core/decisionActions.ts` (+ test), its registration in `src/core/coreActions.ts` or `src/main.ts`, candidate lists, progress |
| T-74 interface | @decision-ui | `src/ui/decision/**` (+ css); the tab hook in `src/ui/compare/panel.ts`, reviewed by @analysis |
| T-75 assistant | lunyx-experience | `src/assistant/**`, `server/llm/**`, `e2e/**`, README, AI-USE, SOURCES, `docs/lunyx/actions.md`. Delivered through @upstream-sync |
| T-76 verification | lunyx-standby | independent checks: engine properties, the tools in the browser, a data-honesty audit; reports to the coordinator, tests only in their own scratch |

Order:
1. The contract lands first; everyone merges `am/lunyx/integration`.
2. T-71, T-72, T-73 and T-74 proceed in parallel against the stubs, with fakes in unit tests.
3. Integration order: T-72, T-71, T-73, T-74, then T-75.
4. One full `npm test`, the GPU smoke and the e2e suites on the assembled tree, then a new RC
   (D-15) and publication.

T-67 and T-69 (the teammates' main) keep their own path through @upstream-sync. Avoid their
files: `src/scene/globe/**` territories, `hud.*`, and Filters.

## 7. Acceptance (MVP)

- **Unit tests** of: constraints (pass/fail/unknown, bounds), unknown handling (never feasible),
  ranking and ties, Pareto, explanations (determinism), `resolveProfile` (safety relaxation
  refused or listed), each tool's schema and refusals, and region metrics on synthetic grids and
  one real site.
- **Real data at three catalogued sites:** one polar (IM-2), one equatorial (Apollo 11), and one
  with only coarse data. The values match the existing analysis and are stated with their basis.
- **`findBestSites` on the catalogue** returns a ranking with counts and a Pareto front within a
  stated time; nearby mode works around a polar pin.
- **The UI tab**, through actions only: GPU check at 1280x720 and 1920x1080.
- **The assistant:**
  - the deterministic fallback runs the three tools;
  - every number in a reply matches a tool result;
  - a slope relaxation without explicit words is refused;
  - e2e scenario green.
- **Checks:** build, the full `npm test`, the GPU smoke and e2e pass. STATUS and README describe
  the feature and its limits, in particular slope and roughness resolution at sites without fine
  grids.
