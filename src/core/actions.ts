// The action registry: the ONE way anything user-facing happens in Lunyx (decision D-1).
//
// Every navigation, visualisation, analysis and output operation is declared here once,
// with a name, a description and a parameter schema. UI controls run the action; the
// assistant's tool list is generated from this same registry. So whatever ships in the
// UI is available to the assistant by construction, and both leave the same state behind.
//
// Rules for authors:
//   - If you ship a control, gesture or output, register its action in your own module
//     (`registerActions([...])` at mount time) and make the control call `runAction`.
//   - A continuous gesture (drag, scroll, walk) maps to an action with absolute
//     parameters (e.g. a camera pose), so the assistant can reach the same end state.
//   - `run` returns a small JSON-serialisable result taken from real app state/results.
//     The assistant quotes numbers only from these results.
//   - Throw `ActionError` with a sentence a person can act on when something cannot be done.

export type ParamSchema =
  | { type: 'number' | 'integer'; description: string; minimum?: number; maximum?: number }
  | { type: 'string'; description: string; enum?: readonly string[] }
  | { type: 'boolean'; description: string }
  | { type: 'array'; description: string; items: ParamSchema; minItems?: number; maxItems?: number }
  | ObjectSchema;

export interface ObjectSchema {
  type: 'object';
  description?: string;
  properties: Record<string, ParamSchema>;
  required?: readonly string[];
}

export interface ActionDef<P = Record<string, unknown>, R = unknown> {
  /** Stable camelCase identifier, also the assistant tool name: /^[a-zA-Z][a-zA-Z0-9_]{0,63}$/. */
  name: string;
  /** Short label for menus and the action log. */
  title: string;
  /** What it does and when to use it. Written for the assistant as much as for people. */
  description: string;
  /** 'query' reads state or results and changes nothing; 'command' changes what the user sees. */
  effect: 'query' | 'command';
  params: ObjectSchema;
  run(params: P): R | Promise<R>;
}

export type ActionOrigin = 'ui' | 'assistant' | 'url' | 'test';

export interface ActionLogEntry {
  seq: number;
  name: string;
  params: unknown;
  origin: ActionOrigin;
  ok: boolean;
  result?: unknown;
  error?: string;
}

export type ActionOutcome<R = unknown> = { ok: true; result: R } | { ok: false; error: string };

/** A failure the user (or the assistant) can understand and act on. */
export class ActionError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ActionError';
  }
}

const registry = new Map<string, ActionDef<any, any>>();
const logListeners = new Set<(entry: ActionLogEntry) => void>();
const log: ActionLogEntry[] = [];
let seq = 0;

export function defineAction<P, R>(def: ActionDef<P, R>): ActionDef<P, R> {
  return def;
}

export function registerActions(defs: readonly ActionDef<any, any>[]): void {
  for (const def of defs) {
    if (!/^[a-zA-Z][a-zA-Z0-9_]{0,63}$/.test(def.name)) throw new Error(`Invalid action name "${def.name}"`);
    if (registry.has(def.name) && registry.get(def.name) !== def) throw new Error(`Action "${def.name}" is already registered`);
    registry.set(def.name, def);
  }
}

/** Removes every action and clears the log. For tests. */
export function resetActions(): void {
  registry.clear();
  log.length = 0;
  seq = 0;
}

export function listActions(): ActionDef<any, any>[] {
  return [...registry.values()];
}

export function getAction(name: string): ActionDef<any, any> | undefined {
  return registry.get(name);
}

/** The most recent actions, oldest first. */
export function actionLog(): readonly ActionLogEntry[] {
  return log;
}

export function onAction(fn: (entry: ActionLogEntry) => void): () => void {
  logListeners.add(fn);
  return () => logListeners.delete(fn);
}

/** Checks a value against a schema. Returns problems as sentences; an empty list means valid. */
export function validateParams(schema: ParamSchema, value: unknown, path = 'params'): string[] {
  switch (schema.type) {
    case 'number':
    case 'integer': {
      if (typeof value !== 'number' || !Number.isFinite(value)) return [`${path} must be a number`];
      if (schema.type === 'integer' && !Number.isInteger(value)) return [`${path} must be a whole number`];
      if (schema.minimum !== undefined && value < schema.minimum) return [`${path} must be at least ${schema.minimum}`];
      if (schema.maximum !== undefined && value > schema.maximum) return [`${path} must be at most ${schema.maximum}`];
      return [];
    }
    case 'string':
      if (typeof value !== 'string') return [`${path} must be text`];
      if (schema.enum && !schema.enum.includes(value)) return [`${path} must be one of: ${schema.enum.join(', ')}`];
      return [];
    case 'boolean':
      return typeof value === 'boolean' ? [] : [`${path} must be true or false`];
    case 'array': {
      if (!Array.isArray(value)) return [`${path} must be a list`];
      if (schema.minItems !== undefined && value.length < schema.minItems) return [`${path} needs at least ${schema.minItems} item(s)`];
      if (schema.maxItems !== undefined && value.length > schema.maxItems) return [`${path} allows at most ${schema.maxItems} item(s)`];
      return value.flatMap((v, i) => validateParams(schema.items, v, `${path}[${i}]`));
    }
    case 'object': {
      if (typeof value !== 'object' || value === null || Array.isArray(value)) return [`${path} must be an object`];
      const record = value as Record<string, unknown>;
      const problems: string[] = [];
      for (const key of schema.required ?? []) if (record[key] === undefined) problems.push(`${path}.${key} is required`);
      for (const [key, v] of Object.entries(record)) {
        const sub = schema.properties[key];
        if (!sub) problems.push(`${path}.${key} is not a known parameter`);
        else if (v !== undefined) problems.push(...validateParams(sub, v, `${path}.${key}`));
      }
      return problems;
    }
  }
}

/**
 * Runs an action by name. Never throws: failures come back as `{ ok: false, error }`
 * so a control can show them and the assistant can read them and try something else.
 */
export async function runAction<R = unknown>(name: string, params: unknown = {}, origin: ActionOrigin = 'ui'): Promise<ActionOutcome<R>> {
  const def = registry.get(name);
  const entry: ActionLogEntry = { seq: ++seq, name, params, origin, ok: false };
  const finish = (outcome: ActionOutcome<R>): ActionOutcome<R> => {
    entry.ok = outcome.ok;
    if (outcome.ok) entry.result = outcome.result;
    else entry.error = outcome.error;
    log.push(entry);
    if (log.length > 500) log.shift();
    for (const fn of [...logListeners]) fn(entry);
    return outcome;
  };
  if (!def) return finish({ ok: false, error: `Unknown action "${name}"` });
  const problems = validateParams(def.params, params ?? {});
  if (problems.length) return finish({ ok: false, error: problems.join('; ') });
  try {
    return finish({ ok: true, result: (await def.run(params ?? {})) as R });
  } catch (err) {
    if (!(err instanceof ActionError)) console.error(`Action ${name} failed`, err);
    return finish({ ok: false, error: err instanceof Error ? err.message : String(err) });
  }
}

/** The registry as plain JSON-schema tool definitions (the shape LLM tool-calling APIs take). */
export function toolDefinitions(): { name: string; description: string; input_schema: ObjectSchema }[] {
  return listActions().map((a) => ({ name: a.name, description: `${a.description}${a.effect === 'query' ? ' (Read-only.)' : ''}`, input_schema: a.params }));
}
