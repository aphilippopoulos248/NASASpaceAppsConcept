# T-9 Surface scene: handover (@surface)

Branch am/lunyx/agent/surface. Screenshots (`screens/t9-*.jpg`, 0.86 MB in total) were taken
in headless Chromium at 1280x720, which renders in software; the app picks its lighter
settings there by itself (see "Frame cost").

## What was built

1. **Any site.** `SurfaceView.load(site)` takes a SiteRef: a catalogued landing or a custom
   pin. The ground comes from `loadTerrainFor()` (finest product at every point), drawn as
   nested grids: 3 m to 0.77 km, 60 m to 3.84 km, 480 m to 30.7 km and 1.92 km to 246 km.
   If the terrain service has nothing, a catalogued landing still loads from its bundled
   window. The strip above the scrubber states which product stands behind each distance
   band and its resolution, e.g. for IM-2: "LOLA LDEM_80S_20M, 60 m site window (60 m per
   sample), interpolated to 0.8 km; ... 480 m site window to 31 km; LOLA south pole, 80S
   square at 160 m to 246 km". "interpolated" is added whenever the product is coarser than
   the grid drawn from it. The same list is in `getSurfaceView`.
2. **Sky.** Black, no stars (the old ones were random points). The Sun is a disc of its
   computed angular size with a glare that scales with the part of the disc not hidden by
   terrain or Earth. Earth is a globe of its computed size, lit from the Sun's real
   direction (so the phase is right) and turned by Earth's pole and Greenwich meridian.
   Both come from `skyAt()` for the site and the observer height (topocentric, airless);
   the Moon-centre directions remain only as a fallback and are labelled "interim" if used.
3. **Terrain shadows over everything drawn** (`surface/shadowSweep.ts`). One pass per grid
   gives every vertex the fraction of the solar disc that clears the terrain on the Sun's
   side, so shadow edges have the real penumbra. Grids nest (a ridge 100 km away shadows
   the ground at your feet) and the outermost uses a smooth Moon beyond its edge, which
   gives night, and peaks that stay lit after the plain is dark. Rocks keep a shadow map.
4. **Sky paths.** The Sun's track (circles) and Earth's libration track (diamonds) over the
   mission window, one mark per 1 h and 6 h (longer for long windows). Filled marks sit in
   the sky and are hidden by terrain in front of them; hollow marks are drawn over
   everything, so the part of a track behind terrain shows as hollow marks. This is the
   same code as the design's chart (filled = lit, hollow = blocked).
5. **Look and walk.** Drag (mouse or one finger), arrow keys, scroll / pinch / plus-minus
   to zoom (field of view 4 to 100 degrees), W A S D, E / Q, Shift. The camera direction is
   written to `store.look`; the scene follows `store.timeMs`, `lightMode`, `mastHeightM`
   (eye height) and the mission window, and obeys the `lookAt` command.
   `SurfaceView.setLook(az, el, fov)` is public, as @globe asked.
6. **Reflectance and exposure** (the coordinator's point 3). The ground now uses the
   lunar-Lambert function (McEwen 1996) instead of a matte surface, exposure is set from
   the Sun's elevation for level ground, and highlights roll off instead of clipping.
   At 1 to 5 degrees of Sun the relief reads in every direction.

## Registered actions (src/scene/surface/actions.ts)

`setGeneratedDetail {on}`, `setFieldOfView {fovDeg}`, `lookAtBody {body, fovDeg?}`,
`walkTo {eastM, northM, liftM?}`, `setSkyAnnotations {tracks?, labels?}`, and the query
`getSurfaceView` (look, position, where the Sun and Earth are drawn and whether the drawn
terrain hides them, the ground bands, what is generated). `lookAt` stays @globe's core
action. The HUD buttons call these through `runAction`.

## Measured and generated

| | Source |
| --- | --- |
| Terrain shape | Elevation products through `loadTerrainFor()`. Nothing larger than the product's resolution is invented. |
| Ground photo, surveyed landing sites | LROC NAC orthophoto bundled with the site window |
| Relief finer than the survey, same sites | Worked out from shading in that photo (derived, not measured); left out within 12 m of the site, where the photo shows the lander |
| Sun and Earth directions, sizes, Earth's phase and facing | Computed for the site and instant |
| Shadows | Computed from the terrain as drawn |
| **Generated, labelled, one switch** | Rocks, texture finer than about a metre and, where no survey exists, craters and bumps within 768 m (zero at the site itself) |
| Display aids | Sun glare, faint fill light in shadow and at night, a barely visible limb on Earth's night side, the ring of sunlit air around Earth while it hides the Sun (schematic) |
| Earth's picture | NASA Blue Marble without clouds |

## Verified

- `npm run build` passes. `npm test`: 209 passed, 1 skipped, plus 10 science tests. 42 of
  them are new, in `src/scene/surface/*.test.ts`: shadow length and penumbra width against
  the analytic values in nine Sun directions, nested grids, the smooth-Moon limit, skyline
  of a sphere and of a ridge, terrain sampling and band description, and the actions.
- In the app, through actions and real key / pointer events:

| Screenshot | Site, UTC | Sun az / el | Earth az / el, lit |
| --- | --- | --- | --- |
| t9-apollo11-landing, -downsun | Apollo 11, 1969-07-20 20:17 | 88.80 / 10.70 | 272.20 / 59.23, 67% |
| t9-im2-landing-sun-2.5deg, -downsun-shadows, -earth-phase | IM-2, 2025-03-06 17:28 | 65.68 / 2.46 | 335.84 / 11.19, 50% |
| t9-im2-sunset-track-behind-terrain | IM-2, 2025-03-19 18:30 | 267.00 / -0.34, 79% of the disc above the drawn terrain | 326.68 / -1.94 |
| t9-im2-eclipse-2025-03-14 | IM-2, 2025-03-14 06:00 | 334.01 / 4.77, 100% behind Earth | 333.58 / 4.88, 0% |
| t9-pin-shackleton-rim-sun-1deg, -downsun | pin 89.45 S, 137.40 W, 2026-11-20 00:00 | 190.99 / 1.00 | 130.18 / 2.82, 26% |
| t9-site-marker | Apollo 11, viewer 81 m from the site | | |

  A second pin at 26.13 N, 3.63 E (Hadley) was checked against the production build
  (`vite preview`): the elevation server built its 60 m window and the neighbouring Apollo 15
  survey was picked up for the ground underfoot.
- Input: W moved the viewer, arrow keys turned and tilted, drag, wheel, one-finger drag
  and two-finger pinch changed `store.look`, Escape returned to the globe. 390 px wide
  layout checked.

## The "yellow line"

It was the landing beacon, not a rendering fault: a 600 m beam in the programme colour
(yellow for Apollo, green for CLPS) that began 25 m above the ground, seen from 45 m away.
It is now a site marker: a ring, a beam that starts at the ground, and the site's name,
in the accent colour, shown only after the viewer has walked more than 25 m from the site
(`t9-site-marker.jpg`). At the site itself nothing is drawn.

## Frame cost

The old scene took about 3 s per frame in software WebGL at 1280x720; about 70% of that
was anisotropic texture filtering. The controller detects a software renderer and uses
lighter settings (no anisotropy, 6 m fine mesh, 1 m near mesh, no rock shadow map): about
0.45 s per frame in the app. `?quality=high` or `?quality=low` overrides the choice.
A shadow sweep takes 9 to 19 ms on the light settings and 25 to 59 ms on the full ones on
this (busy) machine. It runs only while the Sun moves, and is paced so that sweeping takes
at most a quarter of the time.

## Not done, and limits

- Custom pins get map imagery only from NASA Moon Trek tiles (network); offline the ground
  is plain grey. A pin inside another site's surveyed window uses that survey's heights but
  not its photo.
- The far grid is 1.92 km, so a narrow distant ridge is drawn lower than the analysis
  finds it. Sun or Earth within a few hundredths of a degree of the skyline can therefore
  look clear in the picture and be blocked in the numbers (or the reverse). The numbers
  are the analysis; the result of `getSurfaceView` says "against the terrain as drawn".
- At the full settings a time scrub re-sweeps 263,000 vertices on the main thread; it is
  throttled but not moved to a worker.
- The viewer can walk 26 km from the site. Sun and Earth stay those of the site.
- `lookAt` (core action) accepts a field of view of 20 to 90 degrees; the tighter zoom is
  `setFieldOfView` / `lookAtBody`.
- On a 390 px screen the shell's "Filters" button still shows in the surface view (it is
  the shell's).
- `src/scene/surface/dev/harness.html` is a development page for the scene alone; it is
  not part of the build.
