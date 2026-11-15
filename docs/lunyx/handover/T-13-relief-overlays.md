# T-13 Real 3D relief on the globe, polar close-ups, overlays: handover (@globe)

Branch am/lunyx/agent/globe. Screenshots: `screens/t13-*.jpg`.

## What is on screen now

### 1. Relief (real geometry from LOLA)
- The globe is no longer one sphere. It is a quadtree of latitude/longitude tiles (8 x 4 tiles of
  45 degrees at the top, halving per level, 32 x 32 cells each), finer where the camera is close.
  Every vertex carries the LOLA height; the vertex shader moves it outwards by height x exaggeration.
- Height data: the bundled LOLA whole-Moon grid. The 4 px/deg overview (1.5 MB) loads at start;
  the 16 px/deg grid (1.9 km, 15.6 MB) is fetched the first time the camera wants finer tiles.
  Each tile level reads the level of a 2x2-mean pyramid that matches its cell size (1, 2, 4, 8,
  16 px/deg), so a coarse tile shows averaged terrain, not noise.
- Shading still comes from the existing colour and normal maps (tangent space over the same
  latitude/longitude texture coordinates), so the lighting is the one the globe had.
- **Exaggeration.** Choices: off (smooth sphere), true scale, x5, x10 (default), x20, x30. A factor
  above 1 applies above 1,500 km camera altitude and eases to true scale below 100 km, so a
  close-up never misstates a slope. The factor drawn at the moment is always on screen, beside the
  compass ("Relief x10", "Relief x4.6", "Relief at true scale"), and under Filters, Terrain relief.
- Markers, the pin, the coverage outlines and the site imagery sit on the drawn surface (they
  re-read the heights when the exaggeration or the data changes). Markers and the pin are drawn
  over the terrain and hidden as a whole while their site is behind the Moon.
- Clicking the globe finds the point on the relief (the ray is stepped onto the terrain height),
  and the camera keeps 10 km clear of the terrain under the screen centre.

### 2. South-polar close-up (elevation, not photographs)
- Below 1,400 km camera altitude (fully from 900 km), poleward of 80.1S (solid from 81S), the
  surface is drawn from the bundled LOLA polar layers instead of the photographic maps:
  the whole 80S square at 640 m (4x4 means of the 160 m layer), plus a 1024 x 1024 window of the
  finest layer available around the selected site, or around the screen centre when no polar
  site is on screen: 40 m inside 87.5S, 80 m inside 85S, 160 m elsewhere.
- Lighting: the scene's Sun (direction at the simulated time) on a normal map computed from the
  elevation grid, multiplied by the fraction of the Sun's disc each cell sees. That fraction
  comes from two sweeps across the grid along the Sun's direction, for the Sun's upper and
  lower limb (`polarShadow.ts`), over heights with the Moon's curvature taken off. The window
  takes the shadows arriving at its border from the wide piece, so a mountain 200 km away still
  shades it. Shadows are recomputed when the Sun has moved 0.09 degrees, one sweep per frame.
- The on-screen label says: "South-polar close-up: shaded relief from LOLA elevation (N m grid),
  with the shadows the terrain casts at the simulated time. Not a photograph." The site card
  says the same in its credit line for sites poleward of 80S.
- Site imagery (equirectangular tiles) is no longer drawn poleward of 80 degrees, north or south.

### 3. Overlays
| Overlay | How it is drawn | Legend states |
| --- | --- | --- |
| `sun-band` | Per pixel: Sun elevation on a smooth sphere inside the required band, with edge lines | band in degrees, the UTC instant, whole Moon, smooth Moon (no terrain) |
| `avg-illumination`, `avg-earth-visibility` | Polar-stereographic textures of the PGDA product 69 maps, sampled per pixel; 960 m map to 65 degrees, 120 m map inside 85 degrees once the camera is low over a pole | label, unit, meaning, extent, averaging period, reduction, source, citation, caveats: all read from the maps' own index |
| coverage (`showCoverage`) | The three south-polar squares in the shader; the windows around the 28 landing sites as outlines with a light fill | one colour per grid (40, 80, 160 m polar; 480, 60, 3 m site windows), and that the rest is the 1.9 km grid |

- The average maps and their loader are @ice-targets' (`src/science/polarAverages.ts`, T-14). This
  branch reads them through an optional import: until T-14 is integrated the overlay says "Not
  available: the average maps (NASA PGDA product 69) are not part of this build." and draws nothing.
- Overlay code is compiled into the surface shader only while an overlay is on (shader
  variants), because a software renderer pays for unused branches on every pixel.

## Actions
- New: `setReliefExaggeration { factor: 0..30 }`, `showCoverage { show }`. Both return the display
  summary: `{ reliefExaggeration, reliefDrawnNow, reliefRule, reliefDataSamplesPerDegree,
  coverageShown, polarCloseUp: { elevationGridM, sunShadows, note } | null, averageMaps }`.
- `getState` now includes that summary as `globeDisplay`.
- `setOverlay` (existing) selects sun-band or the average maps; the "Show optimal landing area"
  control and its selector run it.

## Files
- `src/scene/globe/`: `heightPyramid.ts`, `reliefTiles.ts`, `reliefGlobe.ts`, `surfaceShader.ts`,
  `polarGrid.ts`, `polarShadow.ts`, `polarCloseUp.ts`, `averageMaps.ts`, `coverageOutlines.ts`,
  `displayState.ts`, `overlayStyle.ts`; changes in `globeView.ts`.
- `src/scene/globe.ts` (material only now), `markers.ts`, `sitePatch.ts`, `sky.ts` (lunar shading
  usable inside a combined shader patch).
- `src/ui/globe/reliefChip.ts`, and the Terrain relief section and legends in `filtersPanel.ts`.

## Verified
- `npm run build` passes. `npm test` after merging integration 4f007f1: all vitest files and the 10
  science tests pass (the exact count is in the task result).
- 41 new tests in `src/scene/globe/`, on real bundled data where it matters:
  - The height pyramid reads the bundled 4 px/deg grid exactly as the terrain module does (7 points,
    to a millimetre); the Moon's highest ground reads above 8,000 m and the South Pole-Aitken floor
    below -4,000 m.
  - Tile layout, geometry (unit sphere, winding, skirts), tile choice (limb, frustum, fallback to a
    parent while children are not built) and the exaggeration curve.
  - Shadow sweep: shadow length = height / tan(elevation) behind a wall in four directions and an
    oblique one, penumbra width, border values from a wider grid.
  - On the real 160 m layer at 640 m: Shackleton's floor is dark for all twelve Sun directions tried
    at the Sun's highest (1.54 degrees), while 2 to 70 % of the ground within 60 km of the pole is lit.
  - The close-up end to end: 40 m window over Shackleton (floor between -2,700 and -3,000 m, dark in
    the window's shadow map), 80 m window at IM-2 (5,200 to 5,450 m).
- Headless Chromium (software WebGL, 1280x720), on a build merged with T-14:
  - Relief: the limb is lumpy at x10 and a circle with relief off (`t13-limb-x10.jpg`, `t13-limb-off.jpg`).
  - Close-up: IM-2 at landing on its sunlit plateau, 80 m grid (`t13-polar-im2.jpg`); Shackleton
    from 90 km, 40 m grid, crater in shadow with a lit rim crescent (`t13-polar-shackleton.jpg`).
  - Overlays over the south pole with their legends: `t13-overlay-sunband.jpg`,
    `t13-overlay-avg-sunlight.jpg`, `t13-overlay-avg-earth.jpg`, `t13-overlay-coverage.jpg`.
  - Phone width: `t13-390-globe.jpg`, `t13-390-pole.jpg`.
- Frame rate, software WebGL, same machine, back to back at load 6.6: integration build 2.2 fps
  (whole Moon) and 7.2 fps (Apollo 11 close-up); this branch 5.4 and 8.6 fps. A full shadow update
  took 78 + 81 + 83 + 117 ms (four sweeps, one per frame) at load 15.
- The machine was shared and at load 10 to 20 for most of this work, so every timing here is noisy.

## Not done, and limits
- **North pole.** No elevation close-up (no north-polar layer is bundled) and no site imagery
  poleward of 80N: there the globe shows the stretched photographic map. The average maps do cover it.
- **Shadows** exist only in the south-polar close-up. Only terrain inside the 80S square casts them.
  The sweep treats each piece's map as flat with one scale: at 80S a shadow's length is off by up
  to about 1.5 %, less nearer the pole. Shadow edges blur with distance (interpolation), and outside
  the fine window the grid is 640 m. The site analysis does not use these shadows: it has its own skyline.
- **The close-up has no albedo**: one regolith grey, shaded.
- **Outside the close-up the relief is the 1.9 km grid.** At 42 km altitude that is smooth,
  large-scale relief under the site imagery.
- **Coverage is its own checkbox**, not an entry of the "Show optimal landing area" selector:
  `OverlayMode` (a contract) has no value for it, and it is useful together with an overlay.
  Windows built on request for pins are not outlined.
- **Software WebGL**: a per-pixel loop over the 28 site windows ran at 0.06 fps, so those are
  geometry now. With an overlay on, frames took roughly 20 to 50 % longer in the calmest of three
  interleaved rounds; the rounds disagree because of the load.
- **Memory**: the three polar layers (about 29 MB each) and the whole-Moon grid (33 MB) are held on
  the main thread once the camera has been low over the south pole, next to the analysis worker's
  own copies. Not measured on a phone.
- The legend's 120 m average map loads only once the camera is below 1,500 km within 20 degrees
  of a pole. Point values of the averages on the site card are T-20.
