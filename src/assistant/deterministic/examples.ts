// One request per action that deterministic mode understands, with what has to happen first.
//
// The list itself is examples.json, so that the browser test (e2e/scenario/control.test.mjs)
// can read it without a TypeScript step. It is the reference for three checks: the unit test
// runs every example against the stand-in app and expects its action in the log; the browser
// test expects every action registered in the real build to have an example, so a new action
// without a phrase is noticed, and runs them in the real app; and the help text is tested
// against the same phrases.
import data from './examples.json';

export interface Example {
  /** The registered action the request must run. */
  action: string;
  /** What the user types. */
  say: string;
  /** Requests to run first, so the example has what it needs on screen (a site, the surface view, saved slots). */
  given?: string[];
}

export const EXAMPLES: readonly Example[] = data.examples;

/** The example for an action, if there is one. */
export function exampleFor(action: string): Example | undefined {
  return EXAMPLES.find((e) => e.action === action);
}
