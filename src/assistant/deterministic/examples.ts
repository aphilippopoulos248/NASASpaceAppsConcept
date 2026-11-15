// One request per action that deterministic mode understands, with what has to happen first.
//
// It is the reference for three checks: the unit test runs every example against the stand-in
// app and expects its action in the log; the browser test (e2e/scenario/control.test.mjs)
// expects every action registered in the real build to have an example here, so a new action
// without a phrase is noticed; and the help text is tested against the same phrases.
export interface Example {
  /** The registered action the request must run. */
  action: string;
  /** What the user types. */
  say: string;
  /** Requests to run first, so the example has what it needs on screen (a site, the surface view, saved slots). */
  given?: string[];
}

const SITE = ['go to IM-2'];
const SURFACE = ['go to IM-2', 'enter the surface'];
const PAIR = ['go to IM-2', 'save as A', 'mast 10 m', 'save as B'];

export const EXAMPLES: readonly Example[] = [
  // time
  { action: 'setTime', say: 'set time to 2025-03-14 06:00' },
  { action: 'play', say: 'play' },
  { action: 'pause', say: 'pause' },
  { action: 'setRate', say: 'speed 12 hours per second' },
  { action: 'setLightMode', say: 'even lighting' },
  { action: 'jumpToEvent', say: 'jump to next sunset', given: SITE },
  // sites and views
  { action: 'selectSite', say: 'go to IM-2' },
  { action: 'dropPin', say: 'drop a pin at 85.3 S, 31.2 E' },
  { action: 'clearSite', say: 'clear the pin', given: SITE },
  { action: 'enterSurface', say: 'enter the surface', given: SITE },
  { action: 'exitSurface', say: 'back to the globe', given: SURFACE },
  { action: 'listSites', say: 'list the landing sites' },
  // cameras
  { action: 'setGlobeCamera', say: 'show the whole Moon' },
  { action: 'resetNorth', say: 'north up' },
  { action: 'setLocatorZoom', say: 'locator map 4' },
  { action: 'lookAt', say: 'look north', given: SURFACE },
  { action: 'lookAtBody', say: 'face the sun', given: SURFACE },
  { action: 'setFieldOfView', say: 'field of view 10', given: SURFACE },
  { action: 'walkTo', say: 'walk 200 m north', given: SURFACE },
  { action: 'setSkyAnnotations', say: 'hide the sky paths', given: SURFACE },
  { action: 'setGeneratedDetail', say: 'hide generated detail', given: SURFACE },
  { action: 'getSurfaceView', say: 'what is the ground made of', given: SURFACE },
  // layers and filters
  { action: 'setOverlay', say: 'show the sun band overlay' },
  { action: 'showMissions', say: 'hide missions' },
  { action: 'setFilters', say: 'only crewed' },
  { action: 'setReliefExaggeration', say: 'relief x5' },
  { action: 'showCoverage', say: 'show elevation coverage' },
  { action: 'showIceTargets', say: 'show the ice targets' },
  // mission parameters and requirements
  { action: 'setMastHeight', say: 'mast 10 m' },
  { action: 'setMissionWindow', say: 'mission window 3 days' },
  { action: 'setDelay', say: 'delay arrival by 24 h' },
  { action: 'setSlopeLimit', say: 'slope limit 8' },
  { action: 'setMaxEarthGap', say: 'maximum earth gap 12 h' },
  { action: 'setSunBand', say: 'sun elevation between 5 and 60' },
  // analysis and site science
  { action: 'getState', say: 'status' },
  { action: 'getAnalysis', say: 'what is the illumination?', given: SITE },
  { action: 'getSiteScience', say: 'dsn stations', given: SITE },
  { action: 'nearestIceTargets', say: 'nearest ice targets', given: SITE },
  { action: 'explainBlockage', say: 'what blocks the earth', given: SITE },
  // comparison
  { action: 'saveScenario', say: 'save as A', given: SITE },
  { action: 'compare', say: 'compare', given: PAIR },
  { action: 'stopCompare', say: 'close the comparison', given: PAIR },
  { action: 'compareDelayedArrival', say: 'compare with a 24 h delay', given: SITE },
  { action: 'compareMastHeights', say: 'compare mast 2 m and 10 m', given: SITE },
  { action: 'openCompare', say: 'open the compare panel' },
  { action: 'swapComparison', say: 'swap A and B', given: PAIR },
  { action: 'clearComparison', say: 'clear slot B', given: PAIR },
  { action: 'saveComparison', say: 'save this comparison as Baseline', given: PAIR },
  { action: 'listComparisons', say: 'list saved comparisons' },
  { action: 'loadComparison', say: 'load comparison Baseline', given: [...PAIR, 'save this comparison as Baseline'] },
  { action: 'deleteComparison', say: 'delete comparison Baseline', given: [...PAIR, 'save this comparison as Baseline'] },
  // nearby alternatives
  { action: 'rankNearby', say: 'rank nearby sites', given: SITE },
  { action: 'selectCandidate', say: 'select candidate 2', given: [...SITE, 'rank nearby sites'] },
  // panels and the assistant
  { action: 'showPanel', say: 'fold the site details' },
  { action: 'setAssistantOpen', say: 'close the assistant' },
  { action: 'clearConversation', say: 'clear the chat' },
];

/** The action every example of a name stands for, for a quick lookup. */
export function exampleFor(action: string): Example | undefined {
  return EXAMPLES.find((e) => e.action === action);
}
