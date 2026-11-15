# T-27: first sync of GitHub `main` into the Lunyx navigator

Owner: @upstream-sync. Written 2026-11-14 after integration I-9.

## Result

All five commits that `origin/main` had beyond the navigator are in `am/lunyx/integration`, with their history.

| What | Commit |
| --- | --- |
| `origin/main` tip that was merged | `2ab7daaa3addc763f42ca29e5413f2d4c1061f8b` |
| Merge base before the sync | `4ab3892ba711718b21b60b0aa8ed9626814d8fc5` |
| Merge commit (parents `23aadb1`, `2ab7daa`) | `8f8def81f084e0dbec3d63b5ed5f1df3547aabfa` |
| Follow-up: main's `main.ts` changes moved to the Lunyx modules | `c6a7ee42a371b6735532cd2de52f9ecbdf52366b` |
| Integration I-9 (gate passed), tree identical to `c6a7ee4` | `375f816527f92d25d1f5085360df047e1c842f8c` |

Commits brought in: `49fee90` Updated moon terrain, `98964da` Stop the dev server watching generated folders, `418760e` Added moon textures, `8bfd842` Updated textures, `2ab7daa` Updated textures.

To publish (coordinator, D-6): push `375f816527f92d25d1f5085360df047e1c842f8c` to `refs/heads/feature/lunyx-navigator`. It is a fast-forward from the remote tip `23aadb1`. Then check with a fresh fetch:

```
git fetch origin
git rev-parse origin/feature/lunyx-navigator                                   # 375f816...
git merge-base --is-ancestor 2ab7daa origin/feature/lunyx-navigator && echo ok  # main's tip is in it
git rev-list --count origin/feature/lunyx-navigator..origin/main                # 0
```

`origin` had no other branch, pull request ref or tag at 2026-11-14 22:10Z, so there was nothing else to review.

## Conflicts and how each was resolved

| File | Kind | Resolution |
| --- | --- | --- |
| `vite.config.ts` | added on both sides | Both kept: the `lunyxApi()` plugin and main's `server.watch.ignored` for `target/` and `scripts/.cache/`. |
| `src/main.ts` | both changed | Lunyx's file kept unchanged (it is now a short boot sequence). Main's six changes to the old file were moved to the modules that hold that code now: see the next table. |
| `tsconfig.json` | no text conflict; overlaps with `tsconfig.server.json` | Taken as on main: `vite.config.ts` is now in the browser type check as well as the server one. `tsc --noEmit` passes. Node types were already visible to the browser check before this (`src/analysis/api.test.ts` references them), so nothing is loosened. |

Taken from main unchanged, no conflict: `src/scene/surface.ts`, `public/textures/surface_detail_normal.jpg`, `public/textures/surface_detail_tone.jpg`, `scripts/make-surface-detail.mjs`.

## Main's `main.ts` changes and where they live now

| Change on main | Now in |
| --- | --- |
| `PCFShadowMap` instead of `PCFSoftShadowMap` | `src/scene/globe/sceneHost.ts`, constructor |
| Automatic resolution in the surface view: 10% smaller when frames are slower than 50 fps, never below 60%; 5% larger when faster than 58 fps, after a 5 s hold; frames of 0.1 s or more are ignored | New `src/scene/autoResolution.ts` (class `AutoResolution`, shared instance `surfaceResolution`), rules unchanged. `SceneHost` calls `tune` before each surface frame and sets the renderer's pixel ratio. |
| Full resolution again on leaving the surface view | `SceneHost.switchView` calls `surfaceResolution.reset()` |
| Frame rate in the surface status line, and the resolution while reduced | `src/ui/surface/hud.ts`: the status line ends with `surfaceResolution.statusText`, for example `43 fps, 80% resolution` |
| Dev builds: `window.__surface` | `SceneHost` constructor; it is the `SurfaceView` |
| `&time=2026-11-22T03:31Z` in a link, applied after `&light=landing` | `src/core/deepLink.ts`: `&time=` is read like `&t=` (`&t=` wins if both are given); a time in the link wins over `&light=landing`; the address bar drops `time` like `t` |

Differences from main that remain, on purpose:

- A link's time is read by the `setTime` action: UTC only, `YYYY-MM-DD` or `YYYY-MM-DDTHH:MM[:SS]Z`, between 1950 and 2100 (D-5). Main used `Date.parse`, which also accepts other spellings and reads a time without `Z` as local time. A time that cannot be read is reported in the console and ignored.
- A link's time is applied with or without `&site=`. Main applied it only with a site.

Nothing from main was left out.

One thing kept exactly as on main that its author may want to look at: because frames of 0.1 s or more are ignored, a machine slower than 10 fps never gets a lower resolution, and the status line keeps showing the last counted rate.

## Checks

- `npm run build`: passes at `c6a7ee4`, and at the merge commit `8f8def8` alone.
- `npm test`: 19 files, 177 passed, 1 skipped, plus the 10 science tests. New tests: 5 for the resolution rules, 5 for the link parameter and its precedence.
- One assertion that existed before fails now and then: `src/analysis/nearby.test.ts`, "default settings: runtime…", requires the IM-2 ranking to finish in 10 s. With three agent turns running it took 10.5 to 16.5 s. It failed the same way on the tree before the merge (`23aadb1`, 11.5 s) and passes when the machine is quieter. The merge touches nothing under `src/analysis` or `src/terrain`. The gate does not run tests.
- Headless Chromium against the dev server, `?site=apollo-11&view=surface&time=2026-11-22T03:31Z`: surface view came up with main's scene, both close-up maps loaded (HTTP 200), no console errors or warnings, status line read `… eye height 1.7 m · 49 fps`, the clock was 2026-11-22 03:31 UTC, `window.__surface.detail` was `measured`. With `&light=landing` added the clock was still 03:31 UTC. Feeding slow frames to the tuner took the canvas from 1280×800 to 1024×640 and the status line to `80% resolution`; leaving the surface view restored 1280×800.

## For @surface (T-9): the conflict that is still to come

`am/lunyx/agent/surface` at `7def2f3` conflicts with integration in one file, `src/scene/surface.ts` (25 conflict hunks), because both sides rewrote it. The uncommitted HUD rewrite in that worktree will also conflict with one line in `src/ui/surface/hud.ts`.

To keep from this sync in the rebuilt scene:

- `src/ui/surface/hud.ts`: end the status line with ` · ${surfaceResolution.statusText}` (import from `../../scene/autoResolution`).
- `SceneHost` changes the renderer's pixel ratio while the surface view is on screen. Anything sized from the drawing buffer has to read the size each frame.
- The renderer's shadow filter is now `PCFShadowMap`.

What main added to `src/scene/surface.ts` since the merge base (line numbers in the file at `375f816`). These are the things to carry into the rebuild, or to drop knowingly:

| Feature | Where |
| --- | --- |
| Close-up surface maps (normal and tone, repeating every 12 m, two copies mixed so the repeat is hard to see), loaded on first use | `requestDetailMaps` 468, used in `patchNearShader` 499; the images are the two new files in `public/textures/`, made by `scripts/make-surface-detail.mjs` |
| The same maps on distant terrain, at a size chosen per pixel in steps of 3 with a cross-fade | `withFarDetail` 400, `addFarDetail` 1093 |
| Generated craters of 1 m and more as real geometry in the near mesh, so the eye height and the rocks follow them | `craterField` 179, `generatedAt` 1086, used by `heightAt` and `updateNear` |
| Near mesh 385×385 at 0.25 m (was 257×257 at 0.5 m), rebuilt over several frames with a 4 ms budget | constants 683–686, `updateNear` 1190 |
| Meshes split into pieces that share vertex data, so off-screen pieces are skipped | `splitForCulling` 647, `refreshBounds` 670 |
| Shadows: 3072² map over ±110 m (was 2048², ±70 m), redrawn only when something changed, faded out at the edge of the square; the fine mesh casts and receives too, with the near mesh's square cut out of its depth pass | constructor 871–883, `shadowStale` and `placeSun` 1509, `FADED_SHADOW_LIGHTS` 355, depth material 942–958 |
| Ground shading: brighter looking away from the Sun, and highlights compressed above a knee instead of clipping | `withBackscatter` 368 |
| Rocks: five shapes (three small ×260, two boulders ×40) instead of one ×600, toned from the ground photo under them, dust on the lower part, relief per pixel | `rockGeometry` 204, `patchRockShader` 272, `scatterRocks` 1266 |
| Tone of the close-up maps weighted by the light's height | `lightHeight` 466, set in `setSky` 1494 |

The public interface of `SurfaceView` did not change on main.
