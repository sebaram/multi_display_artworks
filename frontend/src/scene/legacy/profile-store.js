import { AVATAR_CATALOG } from './avatar-catalog.js';
import { normalizeAppearance } from '../../avatar/appearance-core.js';

const DEFAULT_PROFILE = Object.freeze({
  displayName: 'Visitor',
  avatarId: 'shiba',
  color: '#4CAF50',
});
const NAME_PATTERN = /^[a-zA-Z0-9가-힣\s\-_'.]{3,20}$/u;
const COLOR_PATTERN = /^#[0-9A-Fa-f]{6}$/;

function profileKey(visitorId) {
  return `metamuseum.profile.${visitorId}`;
}

export function normalizeProfile(draft) {
  const displayName = String(draft?.displayName ?? '').trim();
  const avatarId = draft?.avatarId;
  const color = String(draft?.color ?? '').toUpperCase();

  const profile = {
    displayName: NAME_PATTERN.test(displayName)
      ? displayName
      : DEFAULT_PROFILE.displayName,
    avatarId: typeof avatarId === 'string' && Object.hasOwn(AVATAR_CATALOG, avatarId)
      ? avatarId
      : DEFAULT_PROFILE.avatarId,
    color: COLOR_PATTERN.test(color) ? color : DEFAULT_PROFILE.color,
  };
  if (draft?.appearance && AVATAR_CATALOG.casual) {
    const appearance = normalizeAppearance(draft.appearance, { presets: Object.entries(AVATAR_CATALOG).map(([id, p]) => ({ id, ...p })) });
    profile.appearance = appearance;
    profile.avatarId = appearance.presetId;
    profile.color = appearance.colors.top;
  }
  return profile;
}

export function isValidProfile(profile) {
  if (profile === null || typeof profile !== 'object') return false;

  const normalized = normalizeProfile(profile);
  return (
    profile.displayName === normalized.displayName
    && profile.avatarId === normalized.avatarId
    && profile.color === normalized.color
  );
}

export function loadProfile(storage, visitorId) {
  try {
    const storedProfile = storage.getItem(profileKey(visitorId));
    return normalizeProfile(storedProfile === null ? null : JSON.parse(storedProfile));
  } catch {
    return normalizeProfile(null);
  }
}

export function saveProfile(storage, visitorId, draft) {
  const profile = normalizeProfile(draft);
  storage.setItem(profileKey(visitorId), JSON.stringify(profile));
  return profile;
}
