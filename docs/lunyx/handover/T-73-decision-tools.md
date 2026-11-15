# T-73 Decision tools: handover (@globe)

Decision D-17; design in `docs/lunyx/DECISION-ENGINE.md`, sections 2 and 3. Code:
`src/core/decisionActions.ts` (registered in `src/main.ts` after the preset actions), tests in
`src/core/decisionActions.test.ts`.

## Sites and overrides in the parameters

The registry's schemas have no unions, so:

- **A site** is always an object: `{ landing: "apollo-11" }` (a landing id or name, as
  `findLanding` reads it) or `{ lat: -85.4, lon: 31.2 }` (degrees, longitude east-positive,
  wrapped to -180..180; it becomes a pin `pin:<lat>,<lon>`). A bare string cannot be offered
  beside the object form, because the schema language has no unions. Giving both, or neither,
  is refused.
- **Overrides** are `ProfileOverrides`, except that a threshold is removed with
  `removeThresholds: ["roughness", ...]` (a JSON null cannot be validated). So the thresholds
  in the parameters are numbers only. The result's `overrides` echo has the engine's form,
  with null for a removed threshold.
- **Which profile applies:**
  - With neither `profileId` nor `overrides`, a call uses the current settings
    (`AppState.decisionProfileId`, `''` = the first profile, and `decisionOverrides`).
  - With `profileId` alone, that profile is used as it is.
  - With `overrides`, they apply on top of the given profile, or else on top of the current one.

## Actions and results

All numbers are rounded: coordinates (`lat`, `lon`) to 5 decimals, everything else to 3. Every
evaluation result has `profile` (the resolved one), `overrides`, `relaxations` and `utilityNote`
(= `UTILITY_NOTE`).

| Action | Effect | Params | Result |
| --- | --- | --- | --- |
| `listMissionProfiles` | query | none | `{ profiles: MissionProfile[], current: id, criteria: CriterionDef[] }` |
| `getDecisionSettings` | query | none | `{ profileId, isDefaultProfile, overrides, profile, relaxations, refused? }` |
| `setDecisionSettings` | command | `profileId?`, `overrides?`, `reset?` | the same as `getDecisionSettings`, after the change |
| `evaluateSite` | query | `site?` (default: the selected site), `profileId?`, `overrides?` | `{ profile, overrides, relaxations, evaluation: SiteEvaluation, utilityNote }` |
| `compareSites` | query | `siteA`, `siteB`, `profileId?`, `overrides?` | `{ profile, overrides, relaxations, comparison: PairComparison, utilityNote }` |
| `findBestSites` | query | `candidates`, `limit?` (1-50, default 5), `profileId?`, `overrides?` | below |

`setDecisionSettings` details (the coordinator's ruling, m1132):
- `overrides` REPLACES the stored overrides, so send the whole set.
- `profileId` alone switches the profile and clears the overrides.
- `reset: true` clears the overrides and keeps the profile.
- Anything `resolveProfile` refuses (a safety relaxation without the flag, say) is an error with
  the reason, and the state does not change.

`findBestSites` result:

The contract Ranking, trimmed to the top `limit` (the coordinator's ruling, m1132):

```jsonc
{ "profile": {…}, "overrides": {…}, "relaxations": [ { "criterion": "slope", "from": 10, "to": 15 } ],
  "ranked": [ { "siteId", "name", "rank", "utility", "pareto" } ],   // the top `limit` feasible
  "paretoFront": [ "siteId", … ],
  "counts": { "candidates": 28, "feasible": 9, "unknown": 12, "infeasible": 7 },
  "explanation": [ "…" ],
  "evaluations": [ SiteEvaluation ],  // the top `limit` feasible, then every unknown, then every infeasible, in full
  "cap": 40, "dropped": 0,            // candidates over the cap, not measured
  "candidates": { "from": "catalogue", "considered": 28, "total": 28 },
              // sites:  { "from": "sites", "considered": 3 }
              // nearby: { "from": "nearby", "around": { id, name, lat, lon }, "radiusM", "spacingM",
              //           "scanned", "removedBySlopePrefilter", "withoutData", "considered", "prefilter": "…" }
  "utilityNote": "Utility ranks feasible sites … not a probability of mission success." }
```

Each SiteEvaluation's `criteria[]` has its verdict, reason, `measured` (value, unit, bound, basis,
missingReason), threshold, score and weight.

## How each candidate is measured

- The scenario comes from the resolved profile:
  - start: `window.startUtc`, where `"current"` means the app's mission window start with the
    arrival delay (`effectiveStartMs`);
  - length: `window.durationH`;
  - observer height: `mastHeightM`;
  - sampling: 10 min steps.
- Catalogue and sites: `analyse()` (cached, in the worker), one candidate at a time. The
  provenance is the ephemeris sentence, the skyline layers and the terrain notes.
- Nearby: `rankNearby()` around `around` (default: the selected site) with the profile's slope
  limit as its pre-filter (90 deg when the profile has none) and the profile's sunlight and Earth
  weights. The best 15 by the scan's own rank (plus the reference site) are measured. Their
  window metrics come from the scan, and the scan's basis sentence is passed as `basisNote`.
- Every candidate: `loadRegionTerrain(site, landingRadiusM, thresholds.slope)`, then the
  engine's `siteMetrics` and `evaluateMetrics`, then `rankEvaluations` or `compareEvaluations`.
- A failed analysis or region measurement leaves those values null, and the reason goes into
  their `missingReason`: "The analysis could not run for this site and window: …" or "The
  landing-region terrain could not be measured: …". Such a site is `unknown`, never a crash.
- A failure of the engine itself is refused with "The decision engine could not …: <reason>".

**Progress:** `decisionRun()` gives `{ running, done, total, label }`, and `onDecisionRun(fn)`
returns an unsubscribe. Both are exported from `decisionActions.ts`; there is no AppState field.
The "Rank sites" tab can show it, e.g. "Measuring Apollo 15 (4 of 28)" or "Scanning around
IM-2 Athena (40 of 120)".

**Caps** (`DECISION_CAPS`): catalogue 40, sites 12, nearby 15 fully measured. `dropped` counts
the candidates over the cap. For nearby, these are the scan's usable candidates beyond the
best 15; the ones its slope pre-filter removed are counted in `candidates` instead. The nearby radius
is at most 10 km and the spacing at least 50 m.
