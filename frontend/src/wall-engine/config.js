import { sanitize } from './reference/state.js';
export const SOURCE_COMMIT = 'b247fd238fe6cb2c8c860c77d13488b28b8a0290';
export const RENDERER_VERSION = 'gsmv-wall-1';
export const SOURCE_LIMITS = Object.freeze({customObjects:32,edits:4096,screens:8,videos:8});

// Original variant numbers, screen IDs and authored part IDs are the persistence contract.
export function normalizeWallLook(input = {}) {
  if (!input || typeof input !== 'object' || Array.isArray(input)) throw new TypeError('Wall look must be an object');
  if (input.schema_version !== undefined && input.schema_version !== 1) throw new RangeError('Unsupported wall look schema version');
  if (input.source_commit !== undefined && input.source_commit !== SOURCE_COMMIT) throw new RangeError('Unsupported renderer source commit');
  const raw = input.state ?? input;
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) throw new TypeError('Wall state must be an object');
  if (raw.screens?.length > 8 || raw.videoLayers?.length > 8) throw new RangeError('Source screen/video limits exceeded');
  for (const preset of Object.values(raw.authored ?? {})) {
    if (preset?.objects?.length > 32 || Object.keys(preset?.edits ?? {}).length > 4096) throw new RangeError('Source authored element limits exceeded');
  }
  const state = sanitize(structuredClone(raw));
  const logical_screen = input.logical_screen ?? state.screens.find(s=>s.id==='front')?.id ?? state.screens[0].id;
  if (!state.screens.some(screen=>screen.id===logical_screen)) throw new RangeError('Logical screen does not exist');
  const seed = input.seed ?? 0;
  if (!Number.isSafeInteger(seed) || seed < 0 || seed > 999999) throw new RangeError('Seed must be an integer between 0 and 999999');
  return {schema_version:1,source_commit:SOURCE_COMMIT,logical_screen,seed,state};
}
