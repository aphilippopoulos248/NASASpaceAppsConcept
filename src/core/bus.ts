// Imperative commands that are not state ("turn the globe to here", "look that way").
// One module asks, the scene or panel that owns the behaviour carries it out.
import type { AppCommands } from './types';

type Handler<K extends keyof AppCommands> = (payload: AppCommands[K]) => void;

const handlers = new Map<keyof AppCommands, Set<(payload: never) => void>>();

export function onCommand<K extends keyof AppCommands>(name: K, fn: Handler<K>): () => void {
  let set = handlers.get(name);
  if (!set) handlers.set(name, (set = new Set()));
  set.add(fn as (payload: never) => void);
  return () => set.delete(fn as (payload: never) => void);
}

/** Returns how many handlers received the command, so callers can tell when nothing is listening. */
export function emitCommand<K extends keyof AppCommands>(name: K, payload: AppCommands[K]): number {
  const set = handlers.get(name);
  if (!set) return 0;
  for (const fn of [...set]) (fn as Handler<K>)(payload);
  return set.size;
}
