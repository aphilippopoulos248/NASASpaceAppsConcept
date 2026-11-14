// The routing slot in front of the model providers (decision D-1: a router such as "Jev"
// may route intents, but routing must never reduce what the assistant can do).
//
// A router receives the complete step request: the whole conversation and EVERY tool from
// the action registry. It returns the provider to use and the request to send. Whatever
// it returns is checked by `assertFullCapability`: a routed request that lost or changed
// a tool is rejected, so a router cannot quietly narrow the assistant.
//
// To add a router (for example Jev, once its API is known): implement LlmRouter, call
// registerRouter() from server/api/assistant.ts, and select it with LUNYX_LLM_ROUTER=<id>.
import type { LlmRouter, ProviderRequest } from './types';

/** No routing: every step goes to the configured provider with the request untouched. */
export const directRouter: LlmRouter = {
  id: 'direct',
  route(req, providers) {
    if (!providers.primary) throw new Error('No model provider is configured.');
    return { provider: providers.primary, request: req };
  },
};

const routers = new Map<string, LlmRouter>([[directRouter.id, directRouter]]);

export function registerRouter(router: LlmRouter): void {
  routers.set(router.id, router);
}

export function getRouter(id: string): LlmRouter | undefined {
  return routers.get(id);
}

export function routerIds(): string[] {
  return [...routers.keys()];
}

/** Throws when the routed request does not carry exactly the tools the browser sent. */
export function assertFullCapability(original: ProviderRequest, routed: ProviderRequest): void {
  const sent = new Map(original.tools.map((t) => [t.name, t]));
  const kept = new Map(routed.tools.map((t) => [t.name, t]));
  const missing = [...sent.keys()].filter((name) => !kept.has(name));
  if (missing.length) throw new Error(`The router dropped ${missing.length} tool(s): ${missing.slice(0, 5).join(', ')}${missing.length > 5 ? ', ...' : ''}. A router must pass the full tool list.`);
  for (const [name, tool] of kept) {
    const before = sent.get(name);
    if (!before) throw new Error(`The router added a tool the app does not have: ${name}.`);
    if (JSON.stringify(before.input_schema) !== JSON.stringify(tool.input_schema)) throw new Error(`The router changed the parameters of tool ${name}.`);
  }
}
