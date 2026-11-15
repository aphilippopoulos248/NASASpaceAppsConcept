// Deterministic mode: what answers when no language model is available.
//
// It is a fixed command grammar, not a model. A request is split into steps, each step
// must match one known intent, and each intent runs registered actions through
// `runAction(name, params, 'assistant')`: the same registry the UI and the model use.
// It never guesses: if any step is not understood, nothing is run and the reply says
// which part was not understood. Numbers in replies come from action results only.
//
// Every action stays reachable even without a matching phrase: "/actions" lists the
// registry and "/<actionName> {json}" runs any action by name.
import { Ctx, Halt, registryApi, type ActionApi, type Memory } from './context';
import { plural } from './format';
import { matchIntent, type Plan } from './intents';
import { normalise, splitSteps, splitWeak } from './parse';

export interface DeterministicReply {
  text: string;
  /** False when the request (or part of it) was not understood and nothing was run. */
  understood: boolean;
}

export interface Responder {
  reply(text: string): Promise<DeterministicReply>;
}

export interface EngineOptions {
  /** Waiting between polls while an analysis is running. Tests pass a no-op. */
  wait?: (ms: number) => Promise<void>;
  now?: () => number;
}

interface Planned {
  text: string;
  plan: Plan;
}

export class DeterministicEngine implements Responder {
  readonly memory: Memory = {};
  private readonly wait: (ms: number) => Promise<void>;
  private readonly now: () => number;

  constructor(
    private readonly api: ActionApi = registryApi,
    options: EngineOptions = {},
  ) {
    this.wait = options.wait ?? ((ms) => new Promise((ok) => setTimeout(ok, ms)));
    this.now = options.now ?? (() => Date.now());
  }

  /** Splits a request into understood plans and the parts nothing matched. Runs nothing. */
  plan(text: string): { planned: Planned[]; unknown: string[] } {
    const planned: Planned[] = [];
    const unknown: string[] = [];
    for (const raw of splitSteps(text.trim())) {
      const step = normalise(raw);
      if (!step) continue;
      // Commas and "and" join steps only when every part is a command of its own
      // ("find a flatter site, compare it against this pin"); otherwise the step is read
      // as a whole ("compare A and B", "lat -85.3, lon 31.2").
      const parts = splitWeak(raw).map((p) => ({ raw: p, plan: matchIntent(normalise(p), p) }));
      if (parts.length > 1 && parts.every((p) => p.plan)) {
        for (const p of parts) planned.push({ text: p.raw, plan: p.plan! });
        continue;
      }
      const whole = matchIntent(step, raw);
      if (whole) {
        planned.push({ text: raw, plan: whole });
      } else if (parts.length > 1 && parts.some((p) => p.plan)) {
        for (const p of parts) {
          if (p.plan) planned.push({ text: p.raw, plan: p.plan });
          else unknown.push(p.raw);
        }
      } else {
        unknown.push(raw);
      }
    }
    return { planned, unknown };
  }

  async reply(text: string): Promise<DeterministicReply> {
    const { planned, unknown } = this.plan(text);
    if (!planned.length && !unknown.length) {
      return { understood: false, text: 'Type a request, or "help" to see what deterministic mode understands.' };
    }
    if (unknown.length) {
      const lines = [`I did not understand ${unknown.map((u) => `"${u.replace(/[.!?]+$/, '')}"`).join(' and ')}.`];
      if (planned.length) lines.push(`I did understand: ${planned.map((p) => p.plan.does).join('; ')}.`);
      lines.push('Nothing was changed. Deterministic mode follows a fixed set of commands and does not guess. Type "help" to see them, or "/actions" for every action by name.');
      return { understood: false, text: lines.join('\n') };
    }

    const ctx = new Ctx(this.api, this.memory, this.wait, this.now);
    const lines: string[] = [];
    for (const [i, p] of planned.entries()) {
      try {
        lines.push(await p.plan.run(ctx));
      } catch (err) {
        if (!(err instanceof Halt)) throw err;
        lines.push(err.message);
        const rest = planned.length - i - 1;
        if (rest > 0) lines.push(`I stopped there: ${plural(rest, 'later step')} ${rest === 1 ? 'was' : 'were'} not run.`);
        break;
      }
    }
    return { understood: true, text: lines.filter(Boolean).join('\n') };
  }
}
