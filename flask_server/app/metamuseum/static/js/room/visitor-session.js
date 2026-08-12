import { AVATAR_CATALOG } from './avatar-catalog.js';
import { isValidProfile, normalizeProfile } from './profile-store.js';

const STORAGE_KEY = 'metamuseum.tab-visitor.v1';
const TAB_MARKER_PREFIX = 'metamuseum:';
const DEFAULT_CAPABILITY_URL = '/visitor-capability';
const DEFAULT_NAMES = Object.freeze(['Mina', 'Joon', 'Sora', 'Hana', 'Yuri']);
const DEFAULT_COLORS = Object.freeze(['#1565C0', '#2E7D32', '#6A1B9A', '#C62828', '#EF6C00']);

function randomIndex(values, random) {
  const value = random();
  if (!Number.isFinite(value)) return 0;
  return Math.max(0, Math.min(values.length - 1, Math.floor(value * values.length)));
}

function decodeQueryComponent(value) {
  try {
    return decodeURIComponent(value.replaceAll('+', ' '));
  } catch {
    return null;
  }
}

function isNewVisitorEntry(entry) {
  const [key, value = ''] = entry.split('=', 2);
  return decodeQueryComponent(key) === 'user' && decodeQueryComponent(value) === 'new';
}

function isNewVisitorQuery(search) {
  return String(search ?? '').replace(/^\?/u, '').split('&').some(isNewVisitorEntry);
}

function removeNewVisitorQuery(location) {
  const query = String(location.search ?? '').replace(/^\?/u, '')
    .split('&')
    .filter((entry) => !isNewVisitorEntry(entry))
    .filter(Boolean)
    .join('&');
  return `${location.pathname ?? ''}${query ? `?${query}` : ''}${location.hash ?? ''}`;
}

function readVisitorSession(storage, tabMarker) {
  try {
    const value = storage.getItem(STORAGE_KEY);
    if (value === null) return null;
    const record = JSON.parse(value);
    if (
      record === null
      || typeof record !== 'object'
      || typeof record.visitorId !== 'string'
      || record.visitorId.length === 0
      || typeof record.capability !== 'string'
      || record.capability.length === 0
      || record.tabMarker !== tabMarker
      || !isValidProfile(record.profile)
    ) return null;
    return record;
  } catch {
    return null;
  }
}

export function ensureTabMarker({ tab, createMarker }) {
  if (
    typeof tab.name === 'string'
    && tab.name.startsWith(TAB_MARKER_PREFIX)
    && tab.name.length > TAB_MARKER_PREFIX.length
  ) return tab.name;

  const marker = String(createMarker()).trim();
  if (!marker) throw new Error('Unable to create a tab marker');
  tab.name = `${TAB_MARKER_PREFIX}${marker}`;
  return tab.name;
}

function writeVisitorSession(storage, record) {
  storage.setItem(STORAGE_KEY, JSON.stringify(record));
}

export function updateVisitorSession({ storage, visitorSession }) {
  const record = {
    ...visitorSession,
    profile: normalizeProfile(visitorSession.profile),
  };
  writeVisitorSession(storage, record);
  return record;
}

function allowedDefaultAvatars(avatarIds) {
  return avatarIds.filter((avatarId) => (
    avatarId !== 'none' && Object.hasOwn(AVATAR_CATALOG, avatarId)
  ));
}

export function createRandomProfile({ avatarIds, random = Math.random }) {
  const avatars = allowedDefaultAvatars(avatarIds);
  if (avatars.length === 0) throw new Error('A random visitor requires a visible avatar');

  const name = DEFAULT_NAMES[randomIndex(DEFAULT_NAMES, random)];
  const suffix = 100 + randomIndex(Array.from({ length: 900 }), random);
  const color = DEFAULT_COLORS[randomIndex(DEFAULT_COLORS, random)];
  return normalizeProfile({
    displayName: `${name} ${suffix}`,
    avatarId: avatars[randomIndex(avatars, random)],
    color,
  });
}

async function issueVisitorSession({
  fetch,
  visitorCapabilityUrl = DEFAULT_CAPABILITY_URL,
  avatarIds,
  random,
  tabMarker,
}) {
  const response = await fetch(visitorCapabilityUrl, { method: 'POST' });
  if (!response?.ok) throw new Error('Unable to issue a visitor capability');

  const issued = await response.json();
  if (
    issued === null
    || typeof issued !== 'object'
    || Object.keys(issued).length !== 2
    || !Object.hasOwn(issued, 'visitorId')
    || !Object.hasOwn(issued, 'capability')
    || typeof issued.visitorId !== 'string'
    || issued.visitorId.length === 0
    || typeof issued.capability !== 'string'
    || issued.capability.length === 0
  ) throw new Error('Visitor capability response is malformed');

  return {
    visitorId: issued.visitorId,
    capability: issued.capability,
    tabMarker,
    profile: createRandomProfile({ avatarIds, random }),
  };
}

export async function resolveVisitorSession(dependencies) {
  const {
    storage,
    fetch,
    location,
    history,
    avatarIds,
    random = Math.random,
    tabMarker,
    visitorCapabilityUrl,
  } = dependencies;
  const forceNew = isNewVisitorQuery(location.search);
  const existing = forceNew ? null : readVisitorSession(storage, tabMarker);
  const record = existing ?? await issueVisitorSession({
    fetch,
    visitorCapabilityUrl,
    avatarIds,
    random,
    tabMarker,
  });

  writeVisitorSession(storage, record);
  if (forceNew) history.replaceState(null, '', removeNewVisitorQuery(location));
  return record;
}

export async function replaceVisitorSession(dependencies) {
  const {
    storage,
    fetch,
    avatarIds,
    random = Math.random,
    tabMarker,
    visitorCapabilityUrl,
  } = dependencies;
  const record = await issueVisitorSession({
    fetch,
    visitorCapabilityUrl,
    avatarIds,
    random,
    tabMarker,
  });
  writeVisitorSession(storage, record);
  return record;
}
