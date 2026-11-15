// /api/assistant: relays one conversation step between the browser and the model.
//
//   GET  -> AssistantStatus: is a model available, and what is it called (never the key).
//   POST -> body StepRequest { messages, tools }; answers with newline-delimited JSON
//           StepEvents (text deltas, then one 'done' or 'error'). With no model
//           configured it answers 503 { error: { kind: 'no_model' } } and the browser
//           switches to its deterministic mode.
//
// The tool list always comes from the browser's action registry: the server keeps none.
// Credentials are read from the server's settings and never leave this process: nothing
// here echoes configuration, and every error message is redacted before it is sent.
import { NDJSON_CONTENT_TYPE, type AssistantStatus, type StepEvent, type WireError } from '../../src/assistant/protocol';
import { AnthropicProvider } from './anthropic';
import { loadConfig, redact, type LlmConfig } from './env';
import { createJevRouter } from './jev';
import { SYSTEM_PROMPT } from './prompt';
import { assertFullCapability, getRouter, routerIds } from './router';
import { getScript, scriptNames, ScriptedProvider } from './scripted';
import type { LlmProvider, LlmRouter, ProviderRequest, ProviderSet } from './types';
import { validateStepRequest } from './validate';

/** Structurally the same as ApiRequest / ApiResponse in server/plugin.ts. */
export interface HttpRequest {
  method: string;
  subpath: string;
  query: URLSearchParams;
  headers: Record<string, string | string[] | undefined>;
  body: unknown;
  rawBody: string;
  signal: AbortSignal;
}

export interface HttpResponse {
  status: number;
  json?: unknown;
  body?: string | Uint8Array;
  stream?: AsyncIterable<string | Uint8Array>;
  headers?: Record<string, string>;
}

export interface HandlerDeps {
  loadConfig(): LlmConfig;
  /** The provider for a configuration, or null when it has none. */
  provider(cfg: LlmConfig): LlmProvider | null;
  log(line: string): void;
  /** The router for a configuration, or a sentence saying why there is none. Default: the registered routers, plus Jev when its key is set. */
  router?(cfg: LlmConfig): LlmRouter | string;
}

const providerCache = new Map<string, LlmProvider>();

function defaultProvider(cfg: LlmConfig): LlmProvider | null {
  if (cfg.provider === 'none') return null;
  if (cfg.provider === 'scripted') {
    const script = getScript(cfg.script);
    return script ? new ScriptedProvider(script, cfg.script) : null;
  }
  // One SDK client per distinct configuration. The cache key stays in this process.
  // The SDK resolves credentials itself (ant auth login, workload identity, env var).
  const key = JSON.stringify([cfg.model, cfg.effort, cfg.maxTokens, cfg.betas, cfg.customBaseUrl]);
  let p = providerCache.get(key);
  if (!p) {
    try {
      p = new AnthropicProvider(cfg);
    } catch {
      return null;
    }
    providerCache.clear();
    providerCache.set(key, p);
  }
  return p;
}

let jevRouter: { key: string; router: LlmRouter } | null = null;

export function defaultRouter(cfg: LlmConfig): LlmRouter | string {
  if (cfg.router === 'jev') {
    if (!cfg.jev) return 'LUNYX_LLM_ROUTER=jev needs TYPESAFE_API_KEY in the server environment (see .env.example).';
    const key = JSON.stringify(cfg.jev);
    if (jevRouter?.key !== key) jevRouter = { key, router: createJevRouter(cfg.jev) };
    return jevRouter.router;
  }
  return getRouter(cfg.router) ?? `LUNYX_LLM_ROUTER names a router this build does not have ("${cfg.router}"). Available: ${[...routerIds(), 'jev'].join(', ')}.`;
}

export const defaultDeps: HandlerDeps = {
  loadConfig: () => loadConfig(),
  provider: defaultProvider,
  log: (line) => console.warn(line),
};

async function resolve(deps: HandlerDeps): Promise<{ cfg: LlmConfig; provider: LlmProvider | null; router: LlmRouter | null; reason?: string }> {
  const cfg = deps.loadConfig();
  if (cfg.provider === 'none') return { cfg, provider: null, router: null, reason: cfg.reason ?? 'No language model is configured on this server.' };
  const router = (deps.router ?? defaultRouter)(cfg);
  if (typeof router === 'string') return { cfg, provider: null, router: null, reason: router };
  const provider = deps.provider(cfg);
  if (!provider) {
    const why = cfg.provider === 'scripted' ? `Unknown LUNYX_LLM_SCRIPT "${cfg.script}". Available: ${scriptNames().join(', ')}.` : 'No Claude credentials found. Run `ant auth login` to authenticate with your Claude subscription, then restart the server.';
    return { cfg, provider: null, router: null, reason: why };
  }
  // A provider that cannot answer (no credentials) counts as none: the browser then uses its
  // deterministic mode from the start, instead of failing on every message.
  const problem = provider.ready ? await provider.ready() : null;
  if (problem) return { cfg, provider: null, router: null, reason: redact(problem, cfg.secrets) };
  return { cfg, provider, router };
}

async function status(deps: HandlerDeps): Promise<AssistantStatus> {
  const r = await resolve(deps);
  return r.provider ? { available: true, model: r.provider.info, router: r.cfg.router } : { available: false, model: null, router: r.cfg.router, reason: r.reason };
}

const line = (e: StepEvent): string => `${JSON.stringify(e)}\n`;

export function createAssistantHandler(deps: HandlerDeps = defaultDeps): (req: HttpRequest) => Promise<HttpResponse> {
  return async (req): Promise<HttpResponse> => {
    if (req.subpath && req.subpath !== '/') return { status: 404, json: { error: { kind: 'invalid_request', message: 'Unknown assistant endpoint.' } satisfies WireError } };
    if (req.method === 'GET' || req.method === 'HEAD') return { status: 200, json: await status(deps) };
    if (req.method !== 'POST') return { status: 405, headers: { allow: 'GET, POST' }, json: { error: { kind: 'invalid_request', message: 'Use GET for the status or POST for a conversation step.' } satisfies WireError } };

    const parsed = validateStepRequest(req.body);
    if (!parsed.ok) return { status: 400, json: { error: { kind: 'invalid_request', message: parsed.error } satisfies WireError } };

    const r = await resolve(deps);
    if (!r.provider || !r.router) return { status: 503, json: { error: { kind: 'no_model', message: r.reason ?? 'No language model is configured on this server.' } satisfies WireError } };

    const request: ProviderRequest = { system: SYSTEM_PROMPT, tools: parsed.value.tools, messages: parsed.value.messages, signal: req.signal };
    const primary = r.provider;
    const router = r.router!;
    const providers: ProviderSet = { primary, get: (id) => (id === primary.info.provider ? primary : null) };
    const secrets = r.cfg.secrets;

    async function* run(): AsyncIterable<string> {
      let ended = false;
      try {
        const decision = await router.route(request, providers);
        assertFullCapability(request, decision.request);
        for await (const event of decision.provider.step(decision.request)) {
          if (ended) break;
          if (event.type === 'error') event.error.message = redact(event.error.message, secrets);
          if (event.type === 'done' || event.type === 'error') ended = true;
          yield line(event);
        }
        if (!ended) yield line({ type: 'error', error: { kind: 'server', message: 'The model ended the step without an answer.' } });
      } catch (err) {
        deps.log(`[assistant] step failed: ${redact(err instanceof Error ? (err.stack ?? err.message) : String(err), secrets)}`);
        if (!ended) yield line({ type: 'error', error: { kind: 'server', message: 'The assistant server failed while handling this step.' } });
      }
    }

    return { status: 200, headers: { 'content-type': NDJSON_CONTENT_TYPE, 'x-accel-buffering': 'no' }, stream: run() };
  };
}
