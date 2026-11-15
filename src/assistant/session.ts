// One assistant conversation: the messages the user sees, the history the model sees, and
// the loop that lets the model operate the app.
//
// With a language model: each user message starts a turn of model steps. A step may ask
// for actions; they are run through the action registry (the same code as the UI) and
// their results go back for the next step, until the model answers in words.
// Without one (no key on the server, or the server unreachable): the deterministic
// responder answers, and every such reply is labelled.
import { onAction, type ActionLogEntry } from '../core/actions';
import type { Responder } from './deterministic/engine';
import type { ReplySource } from './labels';
import { LIMITS, type ModelInfo, type StepEvent, type WireError, type WireMessage, type WireTool, type WireToolCall, type WireToolResult } from './protocol';
import { currentTools, runToolCalls, stateSnapshot } from './tools';
import type { Transport } from './transport';

export type { ReplySource } from './labels';

export interface ChatMessage {
  id: number;
  role: 'user' | 'assistant' | 'notice';
  text: string;
  /** Who wrote an assistant reply. Shown on every reply. */
  source?: ReplySource;
  /** The actions this reply ran, from the action log, in order. */
  actions: ActionLogEntry[];
  /** Hosted lookups completed during this reply, separate from app actions. */
  searches?: string[];
  /** Still being written, or actions still running. */
  pending: boolean;
  failed?: boolean;
  /** A line under the reply: why deterministic mode answered, a fallback model, a cut-off, a stop. */
  note?: string;
}

export type Mode =
  | { kind: 'checking' }
  | { kind: 'model'; model: ModelInfo }
  | { kind: 'deterministic'; reason: string };

export interface SessionDeps {
  transport: Transport;
  responder: Responder;
  tools?: () => WireTool[];
  snapshot?: () => Promise<unknown>;
  runTools?: (calls: readonly WireToolCall[], signal: AbortSignal) => Promise<WireToolResult[]>;
  now?: () => number;
}

/** How long a "no model" answer is trusted before the server is asked again. */
const STATUS_TTL_MS = 20_000;
/** Start a fresh model context when the next request would get close to the server's body limit. */
const CONTEXT_BUDGET_BYTES = Math.floor(LIMITS.maxRequestBytes * 0.6);

export class AssistantSession {
  readonly messages: ChatMessage[] = [];
  mode: Mode = { kind: 'checking' };
  busy = false;

  private wire: WireMessage[] = [];
  private nextId = 1;
  private abort: AbortController | null = null;
  private statusAt = -Infinity;
  private statusInFlight: Promise<void> | null = null;
  private readonly listeners = new Set<() => void>();
  private readonly tools: () => WireTool[];
  private readonly snapshot: () => Promise<unknown>;
  private readonly runTools: (calls: readonly WireToolCall[], signal: AbortSignal) => Promise<WireToolResult[]>;
  private readonly now: () => number;

  constructor(private readonly deps: SessionDeps) {
    this.tools = deps.tools ?? currentTools;
    this.snapshot = deps.snapshot ?? stateSnapshot;
    this.runTools = deps.runTools ?? runToolCalls;
    this.now = deps.now ?? (() => Date.now());
  }

  /** Called after every visible change. Returns the unsubscribe function. */
  subscribe(fn: () => void): () => void {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  }

  /** The conversation as the model would receive it next (for tests and debugging). */
  history(): readonly WireMessage[] {
    return this.wire;
  }

  private emit(): void {
    for (const fn of [...this.listeners]) fn();
  }

  private add(role: ChatMessage['role'], text: string, pending = false): ChatMessage {
    const m: ChatMessage = { id: this.nextId++, role, text, actions: [], pending };
    this.messages.push(m);
    this.emit();
    return m;
  }

  /** Asks the server whether a language model is available. Safe to call often. */
  refreshStatus(force = false): Promise<void> {
    if (this.statusInFlight) return this.statusInFlight;
    if (!force && this.now() - this.statusAt < STATUS_TTL_MS && this.mode.kind !== 'checking') return Promise.resolve();
    this.statusInFlight = this.deps.transport
      .status()
      .then((s) => {
        this.statusAt = this.now();
        this.mode = s.available && s.model ? { kind: 'model', model: s.model } : { kind: 'deterministic', reason: s.reason ?? 'No language model is configured on the server.' };
      })
      .finally(() => {
        this.statusInFlight = null;
        this.emit();
      });
    return this.statusInFlight;
  }

  /** Stops the turn in progress. Actions that already ran stay applied. */
  stop(): void {
    this.abort?.abort();
  }

  /** Forgets the conversation (on screen and for the model). App state is not touched. */
  clear(): void {
    this.stop();
    this.messages.length = 0;
    this.wire = [];
    this.emit();
  }

  async send(text: string): Promise<void> {
    const input = text.trim();
    if (!input || this.busy) return;
    if (input.length > LIMITS.maxUserTextChars) {
      this.add('notice', `That message is too long (${input.length} characters; the limit is ${LIMITS.maxUserTextChars}).`);
      return;
    }
    this.busy = true;
    this.abort = new AbortController();
    this.add('user', input);
    const reply = this.add('assistant', '', true);
    // Everything the assistant runs goes through runAction with origin "assistant": the log is the record of what was done.
    const stopLog = onAction((entry) => {
      if (entry.origin !== 'assistant') return;
      reply.actions.push(entry);
      this.emit();
    });
    try {
      if (this.mode.kind !== 'model') await this.refreshStatus();
      if (this.mode.kind === 'model') await this.modelTurn(input, reply, this.abort.signal);
      else await this.deterministicTurn(input, reply);
    } catch (err) {
      console.error('Assistant turn failed', err);
      reply.failed = true;
      reply.note = 'The assistant ran into an internal error. Actions listed above were applied.';
    } finally {
      stopLog();
      reply.pending = false;
      this.busy = false;
      this.abort = null;
      this.emit();
    }
  }

  private async deterministicTurn(input: string, reply: ChatMessage, becauseOf?: WireError): Promise<void> {
    reply.source = { kind: 'deterministic' };
    if (becauseOf) reply.note = `The language model could not answer: ${becauseOf.message}`;
    this.emit();
    const state = await this.snapshot();
    const answer = await this.deps.responder.reply(input);
    reply.text = answer.text;
    // Kept as plain text in the model's history, so a model that becomes available later knows what happened.
    this.wire.push({ role: 'user', text: input, ...(state !== undefined ? { state } : {}) }, { role: 'assistant', text: answer.text, toolCalls: [] });
  }

  /** Before a new turn: if the history has grown close to what the server accepts, start the model's context afresh. */
  private makeRoom(): void {
    const tooMany = this.wire.length > LIMITS.maxMessages - 2 * LIMITS.maxStepsPerTurn - 2;
    const tooBig = !tooMany && JSON.stringify({ messages: this.wire, tools: this.tools() }).length > CONTEXT_BUDGET_BYTES;
    if (!tooMany && !tooBig) return;
    this.wire = [];
    this.add('notice', 'This conversation got long: earlier messages are no longer sent to the language model. What is on screen now is still sent with each message.');
  }

  private async modelTurn(input: string, reply: ChatMessage, signal: AbortSignal): Promise<void> {
    this.makeRoom();
    const turnStart = this.wire.length;
    const state = await this.snapshot();
    this.wire.push({ role: 'user', text: input, ...(state !== undefined ? { state } : {}) });

    const finished: string[] = [];
    const show = (live: string) => {
      reply.text = [...finished, live].filter((t) => t.trim()).join('\n\n');
    };
    let actionsRun = 0;

    for (let step = 0; step < LIMITS.maxStepsPerTurn; step++) {
      let live = '';
      let done: Extract<StepEvent, { type: 'done' }> | null = null;
      let failure: WireError | null = null;
      for await (const ev of this.deps.transport.step({ messages: this.wire, tools: this.tools() }, signal)) {
        if (ev.type === 'meta') reply.source = { kind: 'model', label: ev.label, provider: ev.provider };
        else if (ev.type === 'text') show((live += ev.delta));
        else if (ev.type === 'web_search') {
          reply.searches ??= [];
          if (!reply.searches.includes(ev.query)) reply.searches.push(ev.query);
        }
        else if (ev.type === 'reset') show((live = ''));
        else if (ev.type === 'done') done = ev;
        else failure = ev.error;
        this.emit();
      }

      if (failure || !done) {
        const error = failure ?? { kind: 'server', message: 'The assistant server ended the answer early.' };
        show('');
        if (error.kind === 'aborted' || signal.aborted) {
          if (actionsRun === 0) this.wire.length = turnStart;
          reply.note = actionsRun ? 'Stopped. The actions above were applied.' : 'Stopped.';
          return;
        }
        if (actionsRun === 0) {
          // Nothing has been done yet: take the turn back and answer without the model.
          this.wire.length = turnStart;
          if (error.kind === 'invalid_request') this.wire = [];
          if (error.kind === 'no_model') {
            this.mode = { kind: 'deterministic', reason: error.message };
            this.statusAt = this.now();
            await this.deterministicTurn(input, reply);
          } else {
            await this.deterministicTurn(input, reply, error);
          }
          return;
        }
        reply.failed = true;
        reply.note = `${error.message} The actions above were applied before this happened.`;
        return;
      }

      this.wire.push(done.message);
      if (done.message.text.trim()) finished.push(done.message.text);
      show('');
      reply.source = { kind: 'model', label: done.servedBy.label, provider: done.servedBy.provider };
      if (done.notice) reply.note = done.notice;
      if (done.stop !== 'tool_calls' || !done.message.toolCalls.length) return;

      const results = await this.runTools(done.message.toolCalls, signal);
      actionsRun += results.length;
      this.wire.push({ role: 'tool', results });
      this.emit();
      if (signal.aborted) {
        reply.note = 'Stopped. The actions above were applied.';
        return;
      }
    }
    reply.note = `Stopped after ${LIMITS.maxStepsPerTurn} steps without a final answer. The actions above were applied.`;
  }
}
