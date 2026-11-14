# T-13 Real 3D relief on the globe, polar close-ups, overlays: handover (@globe)

Branch am/lunyx/agent/globe. Screenshots: `screens/t13-*.png`.

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
