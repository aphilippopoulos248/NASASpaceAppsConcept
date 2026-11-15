# T-37 Keyboard access, licence notices, citation fix: handover (@surface)

Branch am/lunyx/agent/surface, on top of integration bbaa93d. Desktop only (D-9).

## 1. A-2: looking around the surface view from the keyboard

What the audit saw (round 1, build 4f007f1) was the old surface scene, where looking was
drag-only. The rebuilt scene (T-9) already took the arrow keys on the whole document. What
was still missing, and is now done:

- **Rules in one place** (`src/scene/surface/keys.ts`, pure, tested in `keys.test.ts`): the
  arrow keys look, W A S D / E / Q / Space walk, + and - zoom, wherever the focus is, with
  three exceptions. In a text field, selector or slider every key belongs to the field.
  A focused widget with keys of its own (the skyline chart, the chart's table, a panel the
  browser made focusable because it scrolls) keeps its keys. A just-pressed button keeps
  Space and Enter. A key with Ctrl, Alt or Meta is never taken.
- **Escape** leaves the view from the scene, from a button and now also from a focused widget,
  unless the widget has handled it already (the chart closes its explanation first). It is
  marked handled, so it does nothing else (T-33: one Escape, one meaning).
- **Focus on arrival**: opened from the site card's "Enter surface view" button, which is
  hidden in the surface view, the focus would be nowhere. It now moves to the scene canvas,
  whose label names the keys. Focus that is still somewhere visible (the assistant's text
  box, the scrubber) stays where it is.
- **Screen readers**: while the surface view is shown the canvas has `role="application"`,
  so screen readers in browse mode pass the arrow keys on to the view instead of reading
  with them. The globe's own role (none) is put back on the way out.

Checked in Chromium (real GPU, 1280x720) by keyboard only, at IM-2: focus on the site card's
"Enter surface view", Enter. The focus landed on the scene canvas (role "application", the
surface label). Three presses of Right turned the view from 65.7 to 72.0 degrees (3 x 3 % of
the 70-degree field of view), Up tilted it to +2.1. Tab moved the focus to the key metrics'
"Fold" button, and Left still turned the view (to 69.9). With the skyline chart focused, Right
moved the clock 10 minutes (one sample) and left the view alone. Escape from the chart left
the surface view with the site still selected: the action log shows enterSurface, setTime,
exitSurface (all "ui") and no clearSite, and the canvas had its globe role (none) back.

## 2. A-1 and A-3: sent to @globe

Both are in @globe's files. A-1 was sent as a request with a reproduction (m450):

- **A-1** No keyboard path to a catalogued landing while no site is selected: markers answer
  the pointer only and Enter on the focused globe drops a pin (`src/scene/globe/globeView.ts`,
  keydown, `case 'Enter'`). `listSites` exists as an action, but nothing on screen lists the
  landings.
- **A-3** The scrubber's jump buttons put their glyph into their accessible name
  (`src/ui/shared/timeScrubber.ts`, `button(`${e.glyph} ${e.label}`)`). Since T-33 (060448b)
  `syncJumps` gives every visible jump button an `aria-label` without the glyph ("Jump to ...
  UTC: Sun fully set (...)"), and the buttons are hidden while there are no events, so the
  glyph never reaches the accessible name. A-3 therefore needs no change; I told @globe so in
  m450. Confirmed in Chromium's accessibility tree at IM-2: the buttons are named "Jump to
  2025-03-19 23:17 UTC: Sun fully set (the last part of the Sun's disc goes behind the terrain
  skyline)" and so on, or "Sun starts rising: not after the simulated time inside the mission
  window (...)" when disabled; only their visible text has the glyph.

## 3. Licence notices in the shipped site

- `scripts/build-licences.mjs` writes `public/licences/THIRD-PARTY-NOTICES.txt` from the
  installed packages: every package the website's code imports (found by reading `src/`,
  tests left out) and the packages those depend on, plus Vite and Rolldown, whose own code
  is part of the scripts (Vite's module-preload helper). For each: name, version, licence,
  home page and the licence text as the package ships it. astronomy-engine has no licence
  file; its MIT notice is the `@preserve` comment at the top of its main script, which the
  script takes. Vite's licence file goes on with the licences of packages bundled into Vite
  itself; only Vite's own part is kept. No dates, so the same packages give the same file.
- `node scripts/build-licences.mjs --check` exits 1 when the file is missing or stale.
  Please add `"build-licences": "node scripts/build-licences.mjs"` to package.json
  (@coordinator's file).
- Today: three 0.187.0 (MIT), astronomy-engine 2.1.19 (MIT), @fontsource-variable/inter and
  @fontsource-variable/space-grotesk 5.3.0 (OFL-1.1, full text with each font's copyright),
  vite 8.3.8 and rolldown 1.2.19 (MIT). 15 KB.
- Vite copies `public/` into the build as it is: after `npm run build` the file is
  `dist/licences/THIRD-PARTY-NOTICES.txt`, byte for byte the same.
- `src/licences.test.ts`: the file exists, is what the script makes from the installed
  packages (a dependency change without regenerating fails here, with the command to run),
  lists every package `src/` imports with version and licence, carries the MIT texts of
  three.js and astronomy-engine and the OFL text of both fonts, and Vite's public directory
  is not moved or switched off. The versions match package-lock.json, so the gate's `npm ci`
  gives the same file.
- `vite.config.ts` is unchanged: with the notices file shipped, keeping legal comments in the
  minified bundle is not needed, so nothing had to be agreed with @globe.
- Not covered: `server/` (the API handlers, which use @anthropic-ai/sdk) is not part of the
  website files.

## 4. Citation fix

doi.org's handle service: `10.3847/PSJ/abf3c5` resolves (to iopscience.iop.org), and
`10.3847/PSJ/abf3c3` does not exist. Crossref's record for abf3c5: "Framework for Coordinated
Efforts in the Exploration of Volatiles in the South Polar Region of the Moon", Lemelin, Li,
Mazarico, Siegler et al., The Planetary Science Journal, volume 2, article 103, 2021. Changed
`abf3c3` to `abf3c5` and nothing else: `public/data/ice-targets/README.md` (1),
`scripts/build-ice-targets.py` (2), `public/data/ice-targets/lemelin2021-psr.geojson` (1, in
its "lunyx" block; the file was edited as text, not rewritten, so the diff is one line). The
two audit notes that report the wrong DOI (`T-16-T-17-checkpoint.md`,
`T-17-sources-research.md`) are left as they are.

## Tests

`npm run build` passes. `npm test` on b4a2648: vitest 67 files, 674 passed, 5 skipped (the
opt-in live suite); node science tests 10 of 10. New: `src/scene/surface/keys.test.ts` (9) and
`src/licences.test.ts` (5).
