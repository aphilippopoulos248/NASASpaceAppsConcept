# e2e/scenario: AI control of the navigator, end to end (team tasks T-1 and T-6)

Owner: @assistant. Browser checks of the assistant's control of the app, on the built app,
offline, with no credentials. The shared harness (`e2e/lib/*`, `e2e/run.mjs`) belongs to
@desktop-workflow; these files only import it.

| File | What it checks |
| --- | --- |
| `control.test.mjs` | Every registered action, called the way a model calls it (scripted test model through the real `/api/assistant` route), does what it says and leaves on screen what the UI control for it shows; every action's phrase (`src/assistant/deterministic/examples.json`) runs it in deterministic mode through the drawer; the tool list a model receives is the registry and passes the route's validation. An action without a case or without a phrase fails the run. |
| `scenario.test.mjs` | The brief's request "Find a flatter nearby site with a shorter blackout, compare it against this pin for the same dates, then show me the ridge at Earthset" at a south-polar pin (88.0° S, 136.7° E, bundled 40 m layer): as three follow-ups and as one sentence in deterministic mode, as three follow-ups with the scripted test model (`LUNYX_LLM_SCRIPT=scenario`). Every value in the replies is compared with the action result it came from; the end state (comparison, site, clock, camera, explanation) is checked on screen. |
| `real-model.mjs` | The same three requests with a real language model. Not a test: run by hand, writes a transcript. **Never run so far: there are no credentials on the build machine.** |
| `setup.mjs` | The pin, the mission window and the three requests, shared by the two above. |
| `gpu.mjs` | `E2E_GPU=1` renders on the GPU (ANGLE over EGL) instead of SwiftShader, and the runs report the WebGL renderer (decision D-7). |

## Running

```bash
npm run build
# GPU, under the GPU lock (D-7):
E2E_GPU=1 flock /tmp/lunyx-gpu.lock node --test --test-concurrency=1 e2e/scenario/control.test.mjs
E2E_GPU=1 flock /tmp/lunyx-gpu.lock node --test --test-concurrency=1 e2e/scenario/scenario.test.mjs
# Software rendering, under the CPU lock:
flock /tmp/lunyx-heavy.lock node --test --test-concurrency=1 e2e/scenario/control.test.mjs
```

Each file starts its own `vite preview` servers (every model credential removed from their
environment) unless `npm run e2e` passes them in. `e2e/run.mjs` does not pick up this folder
yet (it reads `e2e/*.test.mjs` only).

## A run with a real language model (T-6, third path)

```bash
ant auth login                          # authenticate with your Claude subscription (once)
npm run build
E2E_GPU=1 flock /tmp/lunyx-gpu.lock node e2e/scenario/real-model.mjs
```

It prints each reply, the model that served it and the actions it ran, and writes the whole
transcript (replies, actions with parameters and results, the state after each turn) to
`e2e/artifacts/real-model-<time>.json`. For each reply it lists the numbers that appear in no
action result of that turn, for a person to check. It exits with code 2 and runs nothing when
the server has no language model. Credentials stay on the server: the page talks only to
`/api/assistant`.

## What each path proves

- **Deterministic mode**: the fixed grammar reaches every action and words its replies from
  their results. It is not a language model.
- **Scripted test model**: the model path works end to end (route, streaming, tool loop,
  results back, follow-ups using earlier results, state snapshot). It is a fixed script, not a
  language model: a pass says nothing about how a real model chooses or chains actions.
- **Real language model**: not verified. `real-model.mjs` is the one command for it.
