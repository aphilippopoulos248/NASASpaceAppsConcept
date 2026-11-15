// Talks to /api/assistant: the status check and one streamed model step.
// Failures never throw: they come back as an 'error' event, so the session can decide
// whether to answer in deterministic mode instead.
import type { AssistantStatus, StepEvent, StepRequest, WireError, WireErrorKind } from './protocol';

export interface Transport {
  status(signal?: AbortSignal): Promise<AssistantStatus>;
  /** Yields the events of one step and always ends with exactly one 'done' or 'error'. */
  step(req: StepRequest, signal: AbortSignal): AsyncIterable<StepEvent>;
}

export const ASSISTANT_URL = '/api/assistant';

const UNREACHABLE = 'The assistant server cannot be reached, so no language model is available.';

function unavailable(reason: string): AssistantStatus {
  return { available: false, model: null, router: 'direct', reason };
}

function isAbort(err: unknown, signal?: AbortSignal): boolean {
  return Boolean(signal?.aborted) || (err instanceof Error && err.name === 'AbortError');
}

const KINDS: readonly WireErrorKind[] = ['no_model', 'invalid_request', 'auth', 'rate_limit', 'overloaded', 'model_request', 'network', 'aborted', 'server'];

/** Reads the `{ error }` body of a failed response; anything unexpected becomes a generic error for that status. */
async function errorFrom(res: Response): Promise<WireError> {
  let body: unknown;
  try {
    body = await res.json();
  } catch {
    body = undefined;
  }
  const e = (body as { error?: unknown } | undefined)?.error;
  if (typeof e === 'object' && e !== null) {
    const { kind, message } = e as { kind?: unknown; message?: unknown };
    if (typeof message === 'string' && typeof kind === 'string' && (KINDS as readonly string[]).includes(kind)) return { kind: kind as WireErrorKind, message, status: res.status };
  }
  // 404/501: this server has no assistant endpoint (for example a static host, or the stub).
  if (res.status === 404 || res.status === 501 || res.status === 503) return { kind: 'no_model', message: UNREACHABLE, status: res.status };
  if (res.status === 413) return { kind: 'invalid_request', message: 'The conversation has become too large to send. Start a new conversation.', status: 413 };
  return { kind: 'server', message: `The assistant server answered with an error (HTTP ${res.status}).`, status: res.status };
}

function isStepEvent(v: unknown): v is StepEvent {
  if (typeof v !== 'object' || v === null) return false;
  const e = v as Record<string, unknown>;
  switch (e.type) {
    case 'meta':
      return typeof e.provider === 'string' && typeof e.model === 'string' && typeof e.label === 'string';
    case 'text':
      return typeof e.delta === 'string';
    case 'reset':
      return true;
    case 'done': {
      const m = e.message as Record<string, unknown> | undefined;
      return typeof m === 'object' && m !== null && m.role === 'assistant' && typeof m.text === 'string' && Array.isArray(m.toolCalls) && typeof e.stop === 'string' && typeof e.servedBy === 'object' && e.servedBy !== null;
    }
    case 'error': {
      const err = e.error as Record<string, unknown> | undefined;
      return typeof err === 'object' && err !== null && typeof err.message === 'string' && typeof err.kind === 'string';
    }
    default:
      return false;
  }
}

export function httpTransport(fetchFn: typeof fetch = (...args) => fetch(...args), url: string = ASSISTANT_URL): Transport {
  return {
    async status(signal) {
      try {
        const res = await fetchFn(url, { method: 'GET', headers: { accept: 'application/json' }, signal });
        if (!res.ok) return unavailable(UNREACHABLE);
        const body = (await res.json()) as Partial<AssistantStatus> | null;
        if (!body || typeof body.available !== 'boolean') return unavailable(UNREACHABLE);
        if (body.available && body.model && typeof body.model.label === 'string') return { available: true, model: body.model, router: body.router ?? 'direct' };
        return unavailable(typeof body.reason === 'string' ? body.reason : 'No language model is configured on the server.');
      } catch {
        return unavailable(UNREACHABLE);
      }
    },

    async *step(req, signal) {
      let res: Response;
      try {
        res = await fetchFn(url, { method: 'POST', headers: { 'content-type': 'application/json', accept: 'application/x-ndjson' }, body: JSON.stringify(req), signal });
      } catch (err) {
        yield { type: 'error', error: isAbort(err, signal) ? { kind: 'aborted', message: 'Stopped.' } : { kind: 'no_model', message: UNREACHABLE } };
        return;
      }
      if (!res.ok || !res.body) {
        yield { type: 'error', error: res.ok ? { kind: 'server', message: 'The assistant server sent an empty answer.' } : await errorFrom(res) };
        return;
      }

      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let buffer = '';
      let ended = false;
      try {
        for (;;) {
          const { value, done } = await reader.read();
          if (value) buffer += decoder.decode(value, { stream: true });
          if (done) buffer += decoder.decode();
          let nl: number;
          while ((nl = buffer.indexOf('\n')) >= 0 || (done && buffer.trim())) {
            const raw = nl >= 0 ? buffer.slice(0, nl) : buffer;
            buffer = nl >= 0 ? buffer.slice(nl + 1) : '';
            if (!raw.trim()) continue;
            let event: unknown;
            try {
              event = JSON.parse(raw);
            } catch {
              event = undefined;
            }
            if (!isStepEvent(event)) continue;
            if (event.type === 'done' || event.type === 'error') ended = true;
            yield event;
            if (ended) return;
          }
          if (done) break;
        }
      } catch (err) {
        if (!ended) yield { type: 'error', error: isAbort(err, signal) ? { kind: 'aborted', message: 'Stopped.' } : { kind: 'network', message: 'The connection to the assistant server was lost.' } };
        return;
      } finally {
        reader.cancel().catch(() => undefined);
      }
      if (!ended) yield { type: 'error', error: { kind: 'server', message: 'The assistant server ended the answer early.' } };
    },
  };
}
