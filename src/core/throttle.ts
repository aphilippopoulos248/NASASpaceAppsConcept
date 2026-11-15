// Redrawing something a few times a second while a value changes on every frame, without ever
// leaving the last value undrawn: a call inside the quiet interval is not dropped, it is run
// once when the interval ends, and reads the value as it is then.

export interface Throttled {
  /** Ask for a run: at once when the last one was long enough ago, otherwise once at the end of the interval. */
  (): void;
  /** Forget a run that is still waiting. */
  cancel(): void;
  /** True while a run is waiting for the interval to end. */
  readonly pending: boolean;
}

/**
 * `run` at most once per `intervalMs`, and always once more after the last request.
 * `run` takes no arguments on purpose: it must read the current state when it runs.
 */
export function throttle(run: () => void, intervalMs: number, now: () => number = () => performance.now()): Throttled {
  let last = -Infinity;
  let timer: ReturnType<typeof setTimeout> | null = null;
  const fire = () => {
    timer = null;
    last = now();
    run();
  };
  const request = (() => {
    if (timer !== null) return; // a run is already due and will draw the newest value
    const wait = intervalMs - (now() - last);
    if (wait <= 0) fire();
    else timer = setTimeout(fire, wait);
  }) as Throttled & { pending: boolean };
  request.cancel = () => {
    if (timer !== null) clearTimeout(timer);
    timer = null;
  };
  Object.defineProperty(request, 'pending', { get: () => timer !== null });
  return request;
}
