// Claude through the official SDK: one streamed Messages request per step.
//
// What this file is careful about (see the Claude API docs for the current models):
//   - The conversation is replayed append-only and each assistant turn is echoed with the
//     content blocks the API returned (thinking blocks included, unmodified): current
//     models bind their reasoning to the conversation that produced it.
//   - `system` and `tools` are identical on every step, tools sorted by name, and nothing
//     volatile sits in front of the conversation, so the prompt cache keeps matching.
//   - Tool choice is always "auto" (current models reject forced tool use), thinking is
//     adaptive (it cannot be disabled) and depth is set with `output_config.effort`.
//   - A refusal is an HTTP 200 with stop_reason "refusal": checked before anything is read.
//     Server-side fallback is on by default, so a declined request is retried by the API
//     on the model it recommends (LUNYX_LLM_BETAS=off turns that off).
//   - Tools are never run from a turn that was refused or cut off at max_tokens.
import Anthropic from '@anthropic-ai/sdk';
import type { AssistantWireMessage, ModelInfo, StepEvent, StepUsage, StopKind, WireError, WireMessage, WireTool, WireToolCall } from '../../src/assistant/protocol';
import { modelLabel, redact, type LlmConfig } from './env';
import { renderUserTurn } from './prompt';
import type { LlmProvider, ProviderRequest } from './types';

type StreamParams = Parameters<Anthropic['beta']['messages']['stream']>[0];
type MessageParam = Anthropic.Beta.BetaMessageParam;
type BlockParam = Anthropic.Beta.BetaContentBlockParam;
type BetaMessage = Anthropic.Beta.BetaMessage;
type StreamEvent = Anthropic.Beta.BetaRawMessageStreamEvent;

export const PROVIDER_ID = 'anthropic';

/** Betas sent unless LUNYX_LLM_BETAS=off: refusal fallback chosen by the API, and control over invalidated thinking blocks. */
export const BETAS = ['server-side-fallback-2026-07-01', 'thinking-binding-controls-2026-08-01'] as const;

/** The part of the SDK client this provider uses; tests pass a fake. */
export interface MessagesClient {
  beta: {
    messages: {
      stream(params: StreamParams, options?: { signal?: AbortSignal }): AsyncIterable<StreamEvent> & { finalMessage(): Promise<BetaMessage> };
    };
  };
}

type Json = Record<string, unknown>;
const isObject = (v: unknown): v is Json => typeof v === 'object' && v !== null && !Array.isArray(v);

/**
 * The blocks of an earlier assistant turn, as they go back to the API. Only block types
 * this app can receive are echoed, field by field, so the browser cannot smuggle other
 * content types through the relay. Rules for a turn that contains a server-side fallback:
 * before the last `fallback` block only text is echoed, and the block itself stays put.
 */
export function echoBlocks(blocks: unknown, stripThinking: boolean): BlockParam[] {
  if (!Array.isArray(blocks)) return [];
  let lastFallback = -1;
  blocks.forEach((b, i) => {
    if (isObject(b) && b.type === 'fallback') lastFallback = i;
  });
  const out: BlockParam[] = [];
  blocks.forEach((b, i) => {
    if (!isObject(b)) return;
    const beforeFallback = i < lastFallback;
    switch (b.type) {
      case 'text':
        if (typeof b.text === 'string' && b.text.trim() !== '') out.push({ type: 'text', text: b.text });
        break;
      case 'thinking':
        if (!stripThinking && !beforeFallback && typeof b.thinking === 'string' && typeof b.signature === 'string') {
          out.push({ type: 'thinking', thinking: b.thinking, signature: b.signature });
        }
        break;
      case 'redacted_thinking':
        if (!stripThinking && !beforeFallback && typeof b.data === 'string') out.push({ type: 'redacted_thinking', data: b.data });
        break;
      case 'tool_use':
        if (!beforeFallback && typeof b.id === 'string' && typeof b.name === 'string') {
          out.push({ type: 'tool_use', id: b.id, name: b.name, input: isObject(b.input) ? b.input : {} });
        }
        break;
      case 'fallback':
        if (isObject(b.from) && isObject(b.to) && typeof b.from.model === 'string' && typeof b.to.model === 'string') {
          out.push(b as unknown as BlockParam);
        }
        break;
      default:
        break;
    }
  });
  return out;
}

/** The wire conversation as Messages API parameters. Deterministic: the same input always gives the same bytes. */
export function toMessageParams(messages: readonly WireMessage[], stripThinking = false): MessageParam[] {
  const out: MessageParam[] = [];
  for (const m of messages) {
    if (m.role === 'user') {
      out.push({ role: 'user', content: renderUserTurn(m).map((text) => ({ type: 'text' as const, text })) });
    } else if (m.role === 'tool') {
      out.push({
        role: 'user',
        content: m.results.map((r) => ({ type: 'tool_result' as const, tool_use_id: r.id, content: r.content, ...(r.ok ? {} : { is_error: true }) })),
      });
    } else {
      let content = m.provider?.id === PROVIDER_ID ? echoBlocks(m.provider.blocks, stripThinking) : [];
      if (!content.length) {
        // A turn from another source (deterministic mode, the scripted model, a refusal note): plain text and calls.
        content = [
          ...(m.text.trim() ? [{ type: 'text' as const, text: m.text }] : []),
          ...m.toolCalls.map((c) => ({ type: 'tool_use' as const, id: c.id, name: c.name, input: isObject(c.input) ? c.input : {} })),
        ];
      }
      if (!content.length) content = [{ type: 'text', text: '(no reply)' }];
      out.push({ role: 'assistant', content });
    }
  }
  return out;
}

/** The registry's tools as API tool definitions, sorted by name so the request prefix is stable. */
export function toToolParams(tools: readonly WireTool[], eager: boolean): NonNullable<StreamParams['tools']> {
  return [...tools]
    .sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0))
    .map((t) => ({
      name: t.name,
      description: t.description,
      input_schema: t.input_schema as Anthropic.Beta.BetaTool['input_schema'],
      // Streamed requests with client tools: let tool inputs stream as generated. The browser
      // validates every input against the registry schema before running the action.
      ...(eager ? { eager_input_streaming: true } : {}),
    }));
}

export function buildParams(cfg: LlmConfig, req: ProviderRequest, opts: { betas: boolean; stripThinking: boolean }): StreamParams {
  const params: StreamParams = {
    model: cfg.model,
    max_tokens: cfg.maxTokens,
    // One explicit breakpoint after the static prefix (tools + system) and automatic caching for the growing conversation.
    system: [{ type: 'text', text: req.system, cache_control: { type: 'ephemeral' } }],
    cache_control: { type: 'ephemeral' },
    tools: toToolParams(req.tools, !cfg.customBaseUrl),
    messages: toMessageParams(req.messages, opts.stripThinking),
    output_config: { effort: req.effort ?? cfg.effort },
    thinking: { type: 'adaptive' },
  };
  if (opts.betas) {
    params.betas = [...BETAS];
    params.fallbacks = 'default';
    // If an earlier turn's reasoning no longer matches the conversation, drop it and go on instead of failing the request.
    params.thinking = { type: 'adaptive', block_binding: { prefix_mismatch_behavior: 'drop_block' } };
  }
  return params;
}

function usageOf(m: BetaMessage): StepUsage {
  return {
    inputTokens: m.usage.input_tokens ?? 0,
    outputTokens: m.usage.output_tokens ?? 0,
    cacheReadTokens: m.usage.cache_read_input_tokens ?? 0,
    cacheWriteTokens: m.usage.cache_creation_input_tokens ?? 0,
  };
}

/** Turns a finished API message into the step's final event. */
export function finish(message: BetaMessage, requested: ModelInfo): StepEvent {
  const servedBy: ModelInfo = message.model && message.model !== requested.model ? { provider: PROVIDER_ID, model: message.model, label: modelLabel(message.model) } : requested;
  const usage = usageOf(message);

  // A refusal is a normal response: check it before reading any content. Partial output is discarded.
  if (message.stop_reason === 'refusal') {
    const category = message.stop_details?.category;
    const text = `The language model declined this request${category ? ` (category: ${category})` : ''}. Nothing was changed. You can rephrase it, or use the controls directly.`;
    return { type: 'done', stop: 'refusal', servedBy, usage, message: { role: 'assistant', text, toolCalls: [] } };
  }
  if (message.stop_reason === 'model_context_window_exceeded') {
    return { type: 'error', error: { kind: 'model_request', message: 'This conversation has become too long for the model. Start a new conversation.' } };
  }

  // After a server-side fallback only the blocks after the last switch are live.
  let lastFallback = -1;
  message.content.forEach((b, i) => {
    if (b.type === 'fallback') lastFallback = i;
  });
  const text = message.content
    .filter((b): b is Anthropic.Beta.BetaTextBlock => b.type === 'text')
    .map((b) => b.text)
    .filter((t) => t.trim() !== '')
    .join('\n\n');
  const toolCalls: WireToolCall[] = message.content
    .filter((b, i): b is Anthropic.Beta.BetaToolUseBlock => b.type === 'tool_use' && i > lastFallback)
    .map((b) => ({ id: b.id, name: b.name, input: b.input }));

  if (message.stop_reason === 'max_tokens' && toolCalls.length) {
    // A truncated tool input can still look valid: never run it.
    return { type: 'error', error: { kind: 'model_request', message: "The model's reply was cut off before it finished a tool call, so nothing was run. Ask again, or raise LUNYX_LLM_MAX_TOKENS on the server." } };
  }

  const stop: StopKind = toolCalls.length && message.stop_reason === 'tool_use' ? 'tool_calls' : message.stop_reason === 'max_tokens' ? 'max_tokens' : 'end';
  const wire: AssistantWireMessage = {
    role: 'assistant',
    text,
    toolCalls: stop === 'tool_calls' ? toolCalls : [],
    provider: { id: PROVIDER_ID, blocks: message.content },
  };
  const notices: string[] = [];
  if (servedBy !== requested) notices.push(`Answered by ${servedBy.label}: ${requested.label} declined this request.`);
  if (stop === 'max_tokens') notices.push('The reply was cut off at the length limit.');
  return { type: 'done', stop, servedBy, usage, message: wire, ...(notices.length ? { notice: notices.join(' ') } : {}) };
}

/** Maps an SDK failure to a sentence for the user. Most specific class first. */
export function describeFailure(err: unknown, cfg: Pick<LlmConfig, 'model' | 'secrets'>): WireError {
  if (err instanceof Anthropic.APIUserAbortError) return { kind: 'aborted', message: 'The request was cancelled.' };
  if (err instanceof Anthropic.AuthenticationError || err instanceof Anthropic.PermissionDeniedError) {
    return { kind: 'auth', status: err.status, message: `The Claude API rejected the server's credentials (HTTP ${err.status}). Check ANTHROPIC_API_KEY on the server.` };
  }
  if (err instanceof Anthropic.NotFoundError) {
    return { kind: 'model_request', status: 404, message: `The Claude API does not know the model "${cfg.model}". Check LUNYX_LLM_MODEL on the server.` };
  }
  if (err instanceof Anthropic.RateLimitError) {
    return { kind: 'rate_limit', status: 429, message: 'The Claude API rate limit was reached. Wait a moment and try again.' };
  }
  if (err instanceof Anthropic.BadRequestError) {
    return { kind: 'model_request', status: 400, message: `The Claude API rejected the request: ${redact(String(err.message), cfg.secrets).slice(0, 400)}` };
  }
  if (err instanceof Anthropic.InternalServerError) {
    return { kind: 'overloaded', status: err.status, message: `The Claude API is unavailable or overloaded right now (HTTP ${err.status}). Try again shortly.` };
  }
  if (err instanceof Anthropic.APIConnectionError) {
    return { kind: 'network', message: 'The server could not reach the Claude API (network error).' };
  }
  if (err instanceof Anthropic.APIError) {
    return { kind: 'server', status: err.status, message: `The Claude API returned an error${err.status ? ` (HTTP ${err.status})` : ''}.` };
  }
  return { kind: 'server', message: 'The language model request failed.' };
}

export function createClient(cfg: LlmConfig): MessagesClient {
  // The key comes from the server's settings only. With neither key nor token the SDK
  // resolves credentials itself (an `ant auth login` profile or workload identity).
  if (cfg.apiKey) return new Anthropic({ apiKey: cfg.apiKey });
  if (cfg.authToken) return new Anthropic({ authToken: cfg.authToken });
  return new Anthropic();
}

/** How many times a step is issued again when a tool input arrives as unparseable JSON. */
const MAX_JSON_RETRIES = 2;

export class AnthropicProvider implements LlmProvider {
  readonly info: ModelInfo;

  constructor(
    private readonly cfg: LlmConfig,
    private readonly client: MessagesClient = createClient(cfg),
    private readonly log: (line: string) => void = (line) => console.warn(line),
  ) {
    this.info = { provider: PROVIDER_ID, model: cfg.model, label: modelLabel(cfg.model) };
  }

  async *step(req: ProviderRequest): AsyncIterable<StepEvent> {
    yield { type: 'meta', ...this.info };
    // First with the beta features; if the API rejects the request, once more as a plain
    // request without them and without replayed reasoning (the documented recovery).
    let mode = { betas: this.cfg.betas, stripThinking: false };
    let degraded = false;
    let jsonRetries = 0;
    for (;;) {
      let streamed = false;
      try {
        const stream = this.client.beta.messages.stream(buildParams(this.cfg, req, mode), { signal: req.signal });
        for await (const ev of stream) {
          if (ev.type === 'content_block_delta' && ev.delta.type === 'text_delta' && ev.delta.text) {
            streamed = true;
            yield { type: 'text', delta: ev.delta.text };
          }
        }
        const message = await stream.finalMessage();
        const dropped = message.input_transformations?.length ?? 0;
        if (dropped) this.log(`[assistant] ${dropped} earlier reasoning block(s) were dropped or flagged by the API (${[...new Set(message.input_transformations!.map((t) => t.type))].join(', ')}).`);
        const done = finish(message, this.info);
        // The final message is authoritative: after a refusal the streamed partial text is void.
        if (streamed && done.type === 'done' && done.stop === 'refusal') yield { type: 'reset' };
        yield done;
        return;
      } catch (err) {
        if (streamed) yield { type: 'reset' };
        if (req.signal.aborted || err instanceof Anthropic.APIUserAbortError) {
          yield { type: 'error', error: { kind: 'aborted', message: 'The request was cancelled.' } };
          return;
        }
        if (err instanceof Anthropic.BadRequestError && !degraded) {
          degraded = true;
          mode = { betas: false, stripThinking: true };
          this.log(`[assistant] The API rejected the request (${redact(String(err.message), this.cfg.secrets).slice(0, 300)}); retrying once without beta features and without replayed reasoning.`);
          continue;
        }
        if (!(err instanceof Anthropic.APIError) && jsonRetries < MAX_JSON_RETRIES) {
          // Not an API error: with eager input streaming this is a tool input that could not be parsed. Issue the step again.
          jsonRetries++;
          this.log(`[assistant] A streamed step could not be read (${err instanceof Error ? err.name : 'error'}); issuing it again (${jsonRetries}/${MAX_JSON_RETRIES}).`);
          continue;
        }
        const failure = describeFailure(err, this.cfg);
        this.log(`[assistant] ${failure.kind}${failure.status ? ` ${failure.status}` : ''}: ${redact(err instanceof Error ? err.message : String(err), this.cfg.secrets).slice(0, 300)}`);
        yield { type: 'error', error: failure };
        return;
      }
    }
  }
}
