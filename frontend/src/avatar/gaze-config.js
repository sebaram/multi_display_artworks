export const GAZE_ALGORITHM_VERSION = 'attention-v1';
export const GAZE_WEIGHT_KEYS = Object.freeze(['center', 'proximity', 'person', 'speaking', 'interaction', 'motion', 'salience', 'novelty']);
export const GAZE_NUMERIC_LIMITS = Object.freeze({
  coneDegrees: [10, 160, 1], maxDistance: [0.1, 100, 0.1],
  minFixationMs: [0, 10000, 50], maxFixationMs: [100, 30000, 100],
  switchMargin: [0, 1, 0.01], lostHoldMs: [0, 2000, 25], smoothingMs: [0, 2000, 10],
  maxSpeedDegrees: [1, 720, 1], maxYawDegrees: [0, 80, 1], maxPitchDegrees: [0, 60, 1],
  seed: [0, 4294967295, 1], exploration: [0, 1, 0.01],
});
export const DEFAULT_GAZE_CONFIG = Object.freeze({
  version: 1, mode: 'weighted', coneDegrees: 60, maxDistance: 15,
  minFixationMs: 600, maxFixationMs: 4000, switchMargin: 0.15,
  lostHoldMs: 200, smoothingMs: 150, maxSpeedDegrees: 120, maxYawDegrees: 25, maxPitchDegrees: 15,
  seed: 1, exploration: 0,
  weights: Object.freeze({ center: 1, proximity: 0.5, person: 0.5, speaking: 1, interaction: 1, motion: 0.25, salience: 0.5, novelty: 0.25 }),
});

const object = value => value !== null && typeof value === 'object' &&
  (Object.getPrototypeOf(value) === Object.prototype || Object.getPrototypeOf(value) === null);
const own = (value, key) => Object.prototype.hasOwnProperty.call(value, key);

/** Strict imports reject malformed values; partial stored profiles inherit defaults. */
export function normalizeGazeConfig(input, strict = false) {
  if (!object(input)) {
    if (strict) throw new Error('Gaze configuration must be an object');
    input = {};
  }
  const result = { ...DEFAULT_GAZE_CONFIG, weights: { ...DEFAULT_GAZE_CONFIG.weights } };
  const known = new Set(['version', 'mode', 'weights', ...Object.keys(GAZE_NUMERIC_LIMITS)]);
  if (strict && Object.keys(input).some(key => !known.has(key))) throw new Error('Unknown gaze configuration field');
  if (own(input, 'version') && input.version !== 1 && strict) throw new Error('Unsupported gaze configuration version');
  if (own(input, 'mode')) {
    if (['forward', 'nearest', 'weighted'].includes(input.mode)) result.mode = input.mode;
    else if (strict) throw new Error('Invalid gaze mode');
  }
  for (const [key, [min, max]] of Object.entries(GAZE_NUMERIC_LIMITS)) {
    if (!own(input, key)) continue;
    const value = input[key];
    if (typeof value !== 'number' || !Number.isFinite(value)) {
      if (strict) throw new Error(`Invalid gaze ${key}`);
      continue;
    }
    if (strict && (value < min || value > max || (key === 'seed' && !Number.isInteger(value)))) throw new Error(`Out of range gaze ${key}`);
    result[key] = Math.max(min, Math.min(max, key === 'seed' ? Math.trunc(value) : value));
  }
  if (own(input, 'weights')) {
    if (!object(input.weights)) {
      if (strict) throw new Error('Gaze weights must be an object');
    } else {
      if (strict && Object.keys(input.weights).some(key => !GAZE_WEIGHT_KEYS.includes(key))) throw new Error('Unknown gaze weight');
      for (const key of GAZE_WEIGHT_KEYS) {
        if (!own(input.weights, key)) continue;
        const value = input.weights[key];
        if (typeof value !== 'number' || !Number.isFinite(value)) {
          if (strict) throw new Error(`Invalid gaze weight ${key}`);
          continue;
        }
        if (strict && (value < 0 || value > 10)) throw new Error(`Out of range gaze weight ${key}`);
        result.weights[key] = Math.max(0, Math.min(10, value));
      }
    }
  }
  if (result.minFixationMs > result.maxFixationMs) {
    if (strict) throw new Error('Minimum fixation exceeds maximum fixation');
    result.minFixationMs = result.maxFixationMs;
  }
  return result;
}
