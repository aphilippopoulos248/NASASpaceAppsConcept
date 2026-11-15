# T-15 Assistant core: handover (@assistant)

Branch `am/lunyx/agent/assistant`. Adds about 6,100 lines (source, tests, this note and
`.env.example`), two screenshots (566 KB) and no other binaries. Screens: `screens/t15-1280.png`, `screens/t15-390.png`.

## How a request travels

1. The drawer (`src/ui/assistant/drawer.ts`) hands the text to the session
   (`src/assistant/session.ts`).
2. With a model: the session POSTs the whole conversation, the tool list from
   `toolDefinitions()` and a state snapshot (the `getState` result) to `/api/assistant`.
   The server relays one model step and streams it back as newline-delimited JSON.
3. Tool calls in that step are run in the browser with `runAction(name, input, 'assistant')`,
   in the order given; all results go back in one message; repeat until the model answers
   in words (at most 24 steps per message).
4. Without a model (server answers 503 `no_model`, or cannot be reached): the deterministic
   engine (`src/assistant/deterministic/`) answers. Every such reply carries the label
   "Deterministic mode: no language model".

There is no second tool list anywhere: the server keeps none, deterministic mode binds to
actions by name through the registry, and "/actions" and "/<action> {json}" reach every
registered action.

## Built

| Part | Where | Notes |
| --- | --- | --- |
| Wire protocol | `src/assistant/protocol.ts` | One request = one model step. Append-only history; the provider's own blocks travel as an opaque field and come back unchanged. |
| HTTP handler | `server/api/assistant.ts`, `server/llm/handler.ts` | `GET` = status (available, model label, router; never a key). `POST` = step. Request validated before any model is involved (`validate.ts`). |
| Claude provider | `server/llm/anthropic.ts` | Official SDK, streamed. Default model `claude-opus-5-5`, effort `medium` (both settable). Adaptive thinking, tool choice left on auto, tools sorted by name, cached system prefix, state snapshot inside the user turn. Assistant turns are replayed with the blocks the API returned (thinking included). `refusal` and `max_tokens` are checked before any tool is run. Typed error classes mapped to sentences. |
| Scripted test model | `server/llm/scripted.ts` | `LUNYX_LLM_PROVIDER=scripted`. Not a language model, and labelled so in the UI. `call <action> {json}; ...` runs tools step by step; anything else reads `getState`. |
| Router slot | `server/llm/router.ts`, `server/llm/jev.ts` | A router sees the full request. `assertFullCapability` rejects a routed request that dropped, added or changed a tool. `jev` (TypeSafe) is implemented from the published OpenAPI document: it only chooses the model's effort for a turn. |
| Settings | `server/llm/env.ts`, `.env.example` | Process environment, then `.env.local`, then `.env`, or the file named by `LUNYX_ENV_FILE`. Re-read when the file changes. `redact()` scrubs keys from anything leaving the server. |
| Session | `src/assistant/session.ts`, `tools.ts`, `transport.ts` | Tool loop, stop button, step limit, fresh model context before the 1 MB body limit, fallback to deterministic mode when the model fails before doing anything. |
| Deterministic mode | `src/assistant/deterministic/` | Fixed grammar: sites, coordinates, views, time, events, delay, compare (A/B, delay, mast heights), nearby alternatives with conditions, blocking terrain, mission settings, overlays, filters, lighting, cameras, questions. If any step is not understood nothing runs and the reply says which part. |
| Drawer | `src/ui/assistant/drawer.ts`, `drawer.css` | Button lower right, drawer from the right edge. Mode line, conversation, per-reply source label, the actions each reply ran (expandable: parameters and result or error), New chat, Stop. |
| Voice | `src/assistant/voice.ts` | Web Speech API dictation into the message box (the user still presses Send). The microphone button is hidden where the browser has no speech recognition. |

New actions: `setAssistantOpen {open}`, `clearConversation` (31 in the build at the time of writing).

## Verified, and with what

**With a real language model: nothing.** There are no credentials on this machine. A real run:
`ant auth login` (once), then `npm run dev`.

With the Anthropic SDK types and a fake SDK client (`server/llm/anthropic.test.ts`):
request shape (model, effort, adaptive thinking, no forced tool choice, betas, cache
markers, sorted tools), replay rules (thinking blocks unchanged, rules around a fallback
block), stop reasons (tool calls, refusal, cut-off, context exceeded), the retry without
beta features after a 400, re-issue after an unreadable streamed tool input, error wording,
no key in messages or logs.

With the scripted model, in process (`server/llm/loop.test.ts`): session -> transport ->
handler -> registry, including the T-1 sentence as a 5-step chain against a stand-in app,
failing / unknown / malformed calls, follow-ups, and no credential in any response body.

With the scripted model in headless Chromium against the built app (`npm run build`,
`LUNYX_LLM_PROVIDER=scripted npx vite preview`): status, chunked streaming through the real
`/api/assistant` route, three chained tool calls changing the real store, unknown action and
bad argument returned as errors.

Deterministic mode in headless Chromium against the built app and the real science core:
`go to IM-2` -> `what is the illumination?` answered 53.6 % illumination, 6.0 h longest
darkness, 100.0 % Earth line of sight, slope 2.1 deg for the 24 h window from load time;
`compare with a 24 h delay` reported both sides (56.8 % and 100.0 % illumination) and the
difference, and left the comparison state set (it is what the screenshots show). Those are the app's numbers at that moment,
not fixtures.

Keyboard, 1280x720: the button is reachable by Tab (35 stops from page start), Enter opens
the drawer and focus lands in the message box, Enter sends, Shift+Enter adds a line, Tab
order inside is New chat > Close > conversation > actions > message box > microphone > Send,
Escape closes the drawer and returns focus to the button without leaving the surface view,
the closed drawer is `inert`. Phone, 390x844: the drawer is full width.

Counts: `npx vitest run` 29 files, 298 passed, 1 skipped (mine: 10 files, 121 tests);
`npm run test:science` 10 of 10; `npm run build` green. The built bundle contains none of: ANTHROPIC, sk-ant, LUNYX_LLM, the
system prompt.

## Not done, and limits

- Nothing has run against the real Claude API or the real TypeSafe API. The request shapes
  come from the SDK's types (1.8.0) and from TypeSafe's OpenAPI 0.2.0. The beta features
  (server-side refusal fallback, thinking-binding controls) are the most likely thing to
  need a change on first contact: a 400 is retried once as a plain request automatically,
  and `LUNYX_LLM_BETAS=off` turns them off.
- Deterministic intents for nearby ranking, candidate selection, blocking terrain, analysis
  readout and export bind to `rankNearby`, `selectCandidate`, `explainBlockage`,
  `getAnalysis`, `exportResults`. Those actions are not registered yet (T-10, T-11, T-25).
  Until they are, the reply is "this build has no ... action". They are tested against a
  stand-in app with the agreed result shapes and must be re-checked in T-16.
- Until `getAnalysis` exists, "where is the Sun/Earth" and "when is the next sunset" answer
  that the readout is not available here; metrics come from the `getState` summary.
- `set time` moves the clock only. The mission window keeps its own start (as in the UI).
- Model replies are shown as plain text. The conversation is not kept across reloads.
- Dictation uses the browser's speech service and could not be exercised headless.
- First-token latency with a real model through `vite preview` has not been measured.
- `npm test` can fail on `src/analysis/nearby.test.ts` (a 10 s limit) when the machine is
  busy: 2 of 5 full runs here; it passes when run alone. Not assistant code; tracked as T-28.
