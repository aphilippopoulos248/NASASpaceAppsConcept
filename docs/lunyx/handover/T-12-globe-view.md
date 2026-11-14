# T-12 Globe view per mockup: handover (@globe)

Branch am/lunyx/agent/globe. Builds on T-3. Screenshots are in `screens/` next to this note; compare them with docs/reference/globe.jpg. The screenshots add about 2.5 MB to the repository.

## Built (mockup item → where)
1. **Left "Filters" panel** (src/ui/globe/filtersPanel.ts):
   - Date and time (UTC).
   - Latitude and longitude (°N / °E, east-positive) of the point at the screen centre. They update live while the globe turns or auto-rotates, and typing a value flies there (setGlobeCamera). Also shows the camera altitude, and a "Drop pin at centre" button.
   - Solar elevation requirement `[min] < α < [max]` in degrees (setSunBand).
   - Mast height (setMastHeight) and mission window length (setMissionWindow).
   - Real/Even sunlight.
   - "Show previous missions" (showMissions), with the existing program, country, type and year filters folded under "Mission filters" (setFilters).
   - "Show optimal landing area": overlay selector (setOverlay) plus a legend that states the meaning of each overlay (src/ui/globe/overlayLegend.ts; the shared colour ramp for T-13).
2. **Pin**:
   - Clicking empty ground drops a pin (dropPin, 5-decimal coordinates). Markers still select landings.
   - Keyboard: focus the globe, then arrow keys turn it, +/- zoom, and Enter drops a pin at the centre.
   - The card for a pin shows its coordinates, elevation and the DEM product/resolution from loadTerrainFor(). Until T-4 is merged it says "Not available yet: the elevation service is not merged."
   - **Little person** (src/ui/globe/person.ts): click it to enter the surface view at the selected site, or at the centre of the view when nothing is selected. Drag it onto the globe to drop a pin there and step down.
3. **Compass** (src/ui/shared/compass.ts): the needle shows the screen angle of lunar north. Clicking it runs resetNorth.
4. **Locator map** (src/ui/shared/locatorMap.ts), used in both views:
   - Equirectangular whole-Moon map with a graticule and labels.
   - Globe view: the true view outline, rebuilt from the shared camera state (src/ui/shared/footprint.ts, unit-tested). Views that contain a pole are filled to the map edge.
   - Surface view: the site and a look-direction wedge.
   - Click or drag turns the globe (setGlobeCamera). Scroll and the +/- buttons zoom the map (setLocatorZoom). A pointer/centre coordinate readout is shown. Arrow keys work when the map is focused.
5. **Time scrubber** (src/ui/shared/timeScrubber.ts), used in both views:
   - The slider spans the mission window (start + delay, 24 h by default; 3/7/14/29.5-day choices). It shows start/end UTC labels and the current instant, and warns when the clock is outside the window, with a "Start window here" button.
   - Play/pause, speed, exact UTC input, Now.
   - Sunrise/sunset/Earthrise/Earthset marks and jump buttons (jumpToEvent; selection logic in src/core/skyEvents.ts, tested) appear once the analysis is ready. Until then a sentence says why.
6. **Stars** are fixed in the world, so they turn with the view. Wordmark top centre. The assistant button region is lower right (its contents belong to @assistant).
7. **Responsive**: checked at 1280x720, 1920x1080 and 390x844. On a phone the Filters panel is a sheet opened from the "Filters" button. Every control has an accessible name, focus is visible, and reduced motion skips the fly-to and the fades.

## Registered actions
- New: resetNorth, setLocatorZoom, jumpToEvent.
- Used by this view from T-3: setTime, play, pause, setRate, setLightMode, selectSite, dropPin, clearSite, enterSurface, exitSurface, setGlobeCamera, setMastHeight, setMissionWindow, setSunBand, setOverlay, showMissions, setFilters, getState.

## Verified
- `npm run build` passes; `npm test`: 33 vitest tests plus the science node tests.
- Playwright on Chromium (software WebGL) at 1280x720:
  - Typing a latitude/longitude flies the globe there (the field the user is not editing keeps its typed value).
  - Clicking the globe dropped `pin:12.51053,167.53943` and the card showed the pin.
  - The sun band (5 to 90°) and "Show optimal landing area" set overlay=sun-band.
  - Clicking the locator turned the globe to about 95°E; ArrowUp on the focused globe moved it north.
  - The little person on a pin gave the toast explaining that pins need the elevation service; on Apollo 11 it entered the surface view.
  - jumpToEvent without an analysis returned the reason.

## Deviations from the mockup, with reasons
- **The compass needle normally stays at north-up.** The globe uses OrbitControls with lunar north as the camera's up axis, so north cannot rotate away. The compass is still live and computed, and resetNorth exists for future free-rotation modes.
- **No overlay colours on the globe yet.** Drawing the overlay is T-13 (needs the relief work). The selector, legend and meaning text are done, and the legend uses the same ramp T-13 will draw.
- **No sunrise/sunset marks or jump buttons yet.** They need analyse() (science core, not merged); the code is in place and tested.
- **Surface view from a custom pin is refused with a reason.** The surface model needs the elevation service (T-4).
- **The date/time appears twice** (Filters panel and scrubber). The mockup puts a date field in Filters, and the scrubber must work in the surface view too, where the panel is hidden.
- **The scrubber's longer windows** go up to one lunar day (29.5 days) as presets; any length up to 8760 h is possible through setMissionWindow.
