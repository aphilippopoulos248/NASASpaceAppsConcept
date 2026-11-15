# Browser tests

```bash
npm run e2e                 # build, start the app, run every e2e/*.test.mjs
npm run e2e -- assistant    # only files whose name contains "assistant"
npm run e2e -- --no-build   # reuse the existing dist/
```

The runner (`e2e/run.mjs`) builds the app, starts two `vite preview` servers on free ports
and runs the test files one at a time with Node's own test runner. The tests use the
`playwright` package directly (headless Chromium; `npx playwright install chromium` once on
a new machine).

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
| `a11y.test.mjs` | accessible names, tab order, focus ring, contrast, reduced motion, phone width (findings: `docs/lunyx/accessibility.md`) |
| `assistant.test.mjs` | the drawer, deterministic mode, the scripted model, keyboard use, no credential in anything sent |
| `equivalence.test.mjs` | using a control and calling its action leave the same state (the list is in `docs/lunyx/actions.md`) |
| `flow.test.mjs` | the main journey: pin, landing, surface, time, delay, comparison, assistant; values on screen against the analysis |
| `lib/app.mjs`, `lib/servers.mjs` | helpers: browser, offline page, reading app state; preview servers |

## Expected failures

A test marked `todo` checks something the app does not do yet or does wrongly, and that
has been reported to its owner. It runs, its failure does not fail the suite, and its
reason is printed next to it. When the app is fixed the test passes and the mark comes off.

## Speed

Headless Chromium draws WebGL in software. The functional tests ask for half the device
pixel ratio (a quarter of the pixels) and reduced motion, and wait on conditions rather
than on frames, but on a busy machine a run still takes several minutes. Timeouts scale
with `E2E_TIMEOUT_MS` (default 120000). While a run is going, `e2e/artifacts/last-run.tap`
(not committed) has the details of each failure as soon as its test ends.

## A run with a real language model

Not part of `npm run e2e`. With a key, start the app yourself and use the drawer:

```bash
ANTHROPIC_API_KEY=... npm run dev
```

The drawer's mode line then names the model, and every reply is labelled with it.
