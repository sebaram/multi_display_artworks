import type { AvatarAppearanceV2, AvatarCatalog } from './types';
import { normalizeAppearance as normalize } from './appearance-core.js';
export function normalizeAppearance(input: unknown, catalog: AvatarCatalog): AvatarAppearanceV2 {
  return normalize(input, catalog) as AvatarAppearanceV2;
}

export function resolveSavedProfile(profile: any, saved: { appearance: AvatarAppearanceV2 | null; ownerScopeToken: string }, storage: Storage, catalog: AvatarCatalog) {
  const key = 'metamuseum.avatar-owner-drafts.v1';
  let defaults: Record<string, AvatarAppearanceV2> = {};
  let initialized = false;
  try {
    const stored = JSON.parse(storage.getItem(key) ?? 'null');
    if (stored && stored.defaults && typeof stored.defaults === 'object' && !Array.isArray(stored.defaults)) {
      defaults = stored.defaults; initialized = true;
    }
  } catch { /* Invalid local metadata must not restore a previous owner's appearance. */ }
  let appearance = saved.appearance ?? defaults[saved.ownerScopeToken];
  if (!appearance) {
    // Only initial three-field legacy data can seed an unsaved owner's default.
    appearance = normalizeAppearance(!initialized && !profile.appearance ? profile : { avatarId: 'shiba', color: '#4CAF50' }, catalog);
    defaults[saved.ownerScopeToken] = appearance;
  }
  storage.setItem(key, JSON.stringify({ defaults }));
  appearance = normalizeAppearance(appearance, catalog);
  return { ...profile, appearance, avatarId: appearance.presetId, color: appearance.colors.top };
}
