// /api/assistant: the in-app assistant's link to the language model.
//
//   GET  /api/assistant -> { available, model, router, reason? }   (never the key)
//   POST /api/assistant -> one model step: body { messages, tools }, answer as
//                          newline-delimited JSON events (see src/assistant/protocol.ts)
//
// The browser sends the tool list generated from the action registry and runs the tool
// calls itself with runAction(); this server only relays to the model and keeps the
// credentials. With no key configured it answers 503 { error: { kind: "no_model" } } and
// the browser uses its clearly labelled deterministic mode.
//
// Configuration (server environment or an env file, see .env.example): LUNYX_ENV_FILE,
// LUNYX_LLM_MODEL, LUNYX_LLM_EFFORT, LUNYX_LLM_PROVIDER, LUNYX_LLM_ROUTER. Credentials
// come from the Anthropic SDK (ant auth login). The implementation lives in server/llm/.
import { createAssistantHandler } from '../llm/handler';
import type { ApiHandler } from '../plugin';

const handler: ApiHandler = createAssistantHandler();

export default handler;
