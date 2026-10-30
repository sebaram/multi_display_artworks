import type { AvatarAppearanceV2, AvatarCatalog } from './types';
import { normalizeAppearance as normalize } from './appearance-core.js';
export function normalizeAppearance(input: unknown, catalog: AvatarCatalog): AvatarAppearanceV2 {
  return normalize(input, catalog) as AvatarAppearanceV2;
}
