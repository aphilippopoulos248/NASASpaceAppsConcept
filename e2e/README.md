# Browser tests

```bash
npm run e2e                 # build, start the app, run every e2e/*.test.mjs
npm run e2e -- assistant    # only files whose name contains "assistant"
npm run e2e -- --no-build   # reuse the existing dist/
npm run e2e -- --lock       # on the shared build machine: wait for the lock that fits the renderer
E2E_GL=swiftshader npm run e2e   # software rendering, as on a machine without a GPU
```

The runner (`e2e/run.mjs`) builds the app, finds out whether headless Chromium gets the GPU,
starts two `vite preview` servers on free ports and runs the test files one at a time with
Node's own test runner. It ends with the number of files, the duration, the renderer and the
load average. The tests use the `playwright` package directly (headless Chromium;
`npx playwright install chromium` once on a new machine).

## Rendering: GPU first, software as the fallback

| `E2E_GL` | What Chromium uses |
| --- | --- |
| `auto` (default) | the GPU when Chromium gets one through ANGLE on the desktop OpenGL ES driver (`--use-gl=angle --use-angle=gl-egl --ignore-gpu-blocklist --enable-gpu`), otherwise SwiftShader |
| `gpu` | the GPU or nothing: the run stops if Chromium only gets a software renderer |
| `swiftshader` | software rendering (`--use-gl=swiftshader`) |

The runner prints the renderer it found (`UNMASKED_RENDERER_WEBGL`, for example
`ANGLE (NVIDIA Corporation, NVIDIA GeForce GTX 1050 Ti/PCIe/SSE2, OpenGL ES 3.2)`) and gives
every test file the same choice. On a GPU the app draws its surface view at full settings;
under SwiftShader it picks its low-power settings by itself.

On the shared build machine (decision D-7 of the lunyx-experience project) GPU runs go under
`/tmp/lunyx-gpu.lock` and software-rendered runs under `/tmp/lunyx-heavy.lock`. With
`--lock` the runner builds first, outside any lock, then waits for the lock that fits the
renderer it found and holds it only for the browser run. Without `--lock` it takes no lock.
Do not wrap a `--lock` run in another `flock`.

## What the tests run against

| Server | Setting | Assistant path it exercises |
| --- | --- | --- |
| deterministic | `LUNYX_LLM_PROVIDER=off` | deterministic mode (no language model) |
| scripted | `LUNYX_LLM_PROVIDER=scripted` | the scripted test model, through the real `/api/assistant` route, streaming and tool loop |

Both servers are started with every model credential removed from their environment, so a
test run never calls a paid API, whatever is in your shell or in `.env.local`.

**The scripted test model is not a language model.** It is a small program
(`server/llm/scripted.ts`) that asks for tool calls and reads their results, so that the
path a real model would use is exercised end to end. A pass here says the plumbing works;
it says nothing about how well a real model drives the app.

**No network.** Every request from the page that does not go to the preview server is
refused, and so are `/api/terrain` and `/api/horizons` (the two routes that fetch from the
internet). The tests therefore show the app working from bundled data only. The one thing
the app reaches for outside is optional close-up imagery (NASA Moon Trek tiles).

## Files

| File | Covers |
| --- | --- |
| `a11y.test.mjs` | desktop: accessible names, tab order, focus ring, contrast, reduced motion, the compare dialog's focus handling, the surface Key metrics and chart (findings: `docs/lunyx/accessibility.md`) |
| `assistant.test.mjs` | the drawer, deterministic mode, the scripted model, keyboard use, no credential in anything sent |
| `equivalence.test.mjs` | using a control and calling its action leave the same state (the list is in `docs/lunyx/actions.md`) |
| `flow.test.mjs` | the main journey: pin at typed coordinates, search criteria, A, nearby scan, a ranked alternative as B, the compare table, a landing on the surface, Key metrics, time, delay, "Compare arrivals", assistant; values on screen against the analysis. Its last block runs with motion on (coordinate entry while the globe flies) |
| `lib/app.mjs`, `lib/servers.mjs`, `lib/read.mjs` | helpers: browser (GPU or SwiftShader), offline page, reading app state; preview servers; readers for the panels and their comparison with the analysis |
| `qa/` | the judge's walkthrough with screenshots (`qa/walkthrough.mjs`) and defect reproductions (`qa/repro-*.mjs`); not part of `npm run e2e` |

## Expected failures

A test marked `todo` checks something the app does not do yet or does wrongly, and that
has been reported to its owner. It runs, its failure does not fail the suite, and its
reason is printed next to it. When the app is fixed the test passes and the mark comes off.

## Speed

With software rendering a frame can take a second or more. The functional tests therefore
ask for half the device pixel ratio (a quarter of the pixels) and reduced motion, and wait on
conditions rather than on frames; on a busy machine a software-rendered run still takes many
minutes (41 min for the whole suite at load 11 to 20). Timeouts scale with `E2E_TIMEOUT_MS`
(default 120000). While a run is going, `e2e/artifacts/last-run.tap` (not committed) has the
details of each failure as soon as its test ends.

## A run with a real language model

Not part of `npm run e2e`. Authenticate with your Claude subscription and start the app:

```bash
ant auth login   # once
npm run dev
```

The drawer's mode line then names the model, and every reply is labelled with it.
