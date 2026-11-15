// The pin and the mission window of the T-6 scenario, shared by the test and the real-model run.
// The pin is a south-polar point inside the bundled 40 m elevation layer (88.0° S, 136.7° E).
// The window starts on IM-2's landing day; it is long enough to hold an Earthset at the candidate.
// SCENARIO_START / SCENARIO_HOURS override it for an exploration run.
export const PIN = { lat: -88, lon: 136.7 };
export const WINDOW = { startUtc: process.env.SCENARIO_START ?? '2025-03-06T17:28Z', durationH: Number(process.env.SCENARIO_HOURS ?? 708) };
export const STEPS = ['Find a flatter nearby site with a shorter blackout', 'Compare it against this pin for the same dates', 'Then show me the ridge at Earthset'];
export const SENTENCE = 'Find a flatter nearby site with a shorter blackout, compare it against this pin for the same dates, then show me the ridge at Earthset.';
