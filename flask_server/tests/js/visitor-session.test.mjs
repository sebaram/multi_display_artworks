import assert from 'node:assert/strict';
import test from 'node:test';

import {
  createTabMarker,
  createRandomProfile,
  ensureTabMarker,
  openVisitorSession,
  replaceVisitorSession,
  resolveVisitorSession,
  updateVisitorSession,
} from '../../app/metamuseum/static/js/room/visitor-session.js';

function createStorage(initialValues = {}) {
  const values = new Map(Object.entries(initialValues));
  return {
    getItem: (key) => values.get(key) ?? null,
    setItem: (key, value) => values.set(key, value),
    values,
  };
}

function createHistory() {
  const calls = [];
  return {
    calls,
    replaceState: (_state, _title, url) => calls.push([url]),
  };
}

function createIssuer(records) {
  const calls = [];
  const issue = async (url, options) => {
    calls.push([url, options]);
    const record = records.shift();
    return {
      ok: true,
      json: async () => record,
    };
  };
  issue.calls = calls;
  return issue;
}

function cloneStorage(storage) {
  return createStorage(Object.fromEntries(storage.values));
}

function createBroadcastHub() {
  const channels = new Map();

  return function createBroadcastChannel(name) {
    const peers = channels.get(name) ?? new Set();
    const listeners = new Set();
    const channel = {
      addEventListener(type, listener) {
        if (type === 'message') listeners.add(listener);
      },
      removeEventListener(type, listener) {
        if (type === 'message') listeners.delete(listener);
      },
      postMessage(data) {
        for (const peer of peers) {
          if (peer !== channel) peer.deliver(data);
        }
      },
      deliver(data) {
        for (const listener of listeners) listener({ data });
      },
      close() {
        peers.delete(channel);
        listeners.clear();
      },
    };
    peers.add(channel);
    channels.set(name, peers);
    return channel;
  };
}

function ownershipDependencies(overrides = {}) {
  let markerNumber = 0;
  return {
    createMarker: () => `marker-${++markerNumber}`,
    createProbeId: () => `probe-${++markerNumber}`,
    scheduleTimeout: setTimeout,
    clearScheduledTimeout: clearTimeout,
    ownershipProbeMs: 1,
    ...overrides,
  };
}

test('first tab session mints and persists a random valid visitor record', async () => {
  const storage = createStorage();
  const history = createHistory();
  const issue = createIssuer([{ visitorId: 'visitor-a', capability: 'capability-a' }]);
  const avatarIds = ['none', 'robot', 'shiba'];

  const record = await resolveVisitorSession({
    storage,
    fetch: issue,
    location: { search: '', pathname: '/room' },
    history,
    avatarIds,
    tabMarker: 'tab-a',
    random: () => 0,
  });

  assert.equal(record.visitorId, 'visitor-a');
  assert.equal(record.capability, 'capability-a');
  assert.equal(record.tabMarker, 'tab-a');
  assert.notEqual(record.profile.displayName, 'Visitor');
  assert.notEqual(record.profile.avatarId, 'none');
  assert.match(record.profile.color, /^#[0-9A-F]{6}$/u);
  assert.deepEqual(JSON.parse(storage.values.get('metamuseum.tab-visitor.v1')), record);
  assert.deepEqual(issue.calls, [['/visitor-capability', { method: 'POST' }]]);
});

test('same tab reload reuses its stored capability without issuing again', async () => {
  const storage = createStorage();
  const history = createHistory();
  const issue = createIssuer([{ visitorId: 'visitor-a', capability: 'capability-a' }]);
  const dependencies = {
    storage,
    location: { search: '', pathname: '/room' },
    history,
    avatarIds: ['robot'],
    tabMarker: 'tab-a',
  };

  const first = await resolveVisitorSession({ ...dependencies, fetch: issue });
  const second = await resolveVisitorSession({
    ...dependencies,
    fetch: () => { throw new Error('must not issue'); },
  });

  assert.deepEqual(second, first);
  assert.equal(issue.calls.length, 1);
});

test('user=new replaces the tab record once and removes the query parameter', async () => {
  const storage = createStorage();
  const history = createHistory();
  const issue = createIssuer([{ visitorId: 'visitor-b', capability: 'capability-b' }]);

  const record = await resolveVisitorSession({
    storage,
    fetch: issue,
    location: { search: '?user=new', pathname: '/room' },
    history,
    avatarIds: ['robot'],
    tabMarker: 'tab-a',
  });

  assert.equal(record.visitorId, 'visitor-b');
  assert.deepEqual(history.calls, [['/room']]);
});

test('malformed stored records are discarded and reissued', async () => {
  const storage = createStorage({
    'metamuseum.tab-visitor.v1': JSON.stringify({ visitorId: 'visitor-a', capability: 42, profile: {} }),
  });
  const issue = createIssuer([{ visitorId: 'visitor-b', capability: 'capability-b' }]);

  const record = await resolveVisitorSession({
    storage,
    fetch: issue,
    location: { search: '', pathname: '/room' },
    history: createHistory(),
    avatarIds: ['robot'],
    tabMarker: 'tab-a',
  });

  assert.equal(record.visitorId, 'visitor-b');
  assert.equal(issue.calls.length, 1);
});

test('capability responses with extra own fields are rejected', async () => {
  const issue = createIssuer([{
    visitorId: 'visitor-a',
    capability: 'capability-a',
    profile: { displayName: 'Injected' },
  }]);

  await assert.rejects(
    resolveVisitorSession({
      storage: createStorage(),
      fetch: issue,
      location: { search: '', pathname: '/room' },
      history: createHistory(),
      avatarIds: ['robot'],
      tabMarker: 'tab-a',
    }),
    /malformed/u,
  );
});

test('malformed percent encoding is not treated as a new visitor query', async () => {
  const history = createHistory();
  const issue = createIssuer([{ visitorId: 'visitor-a', capability: 'capability-a' }]);

  const record = await resolveVisitorSession({
    storage: createStorage(),
    fetch: issue,
    location: { search: '?user=%E0%A4%A', pathname: '/room' },
    history,
    avatarIds: ['robot'],
    tabMarker: 'tab-a',
  });

  assert.equal(record.visitorId, 'visitor-a');
  assert.deepEqual(history.calls, []);
});

test('replaceVisitorSession always persists a fresh issued record', async () => {
  const storage = createStorage({
    'metamuseum.tab-visitor.v1': JSON.stringify({
      visitorId: 'visitor-a',
      capability: 'capability-a',
      tabMarker: 'tab-a',
      profile: { displayName: 'Mina 100', avatarId: 'robot', color: '#4CAF50' },
    }),
  });
  const issue = createIssuer([{ visitorId: 'visitor-b', capability: 'capability-b' }]);

  const record = await replaceVisitorSession({
    storage,
    fetch: issue,
    location: { search: '', pathname: '/room' },
    history: createHistory(),
    avatarIds: ['robot'],
    tabMarker: 'tab-a',
  });

  assert.equal(record.visitorId, 'visitor-b');
  assert.equal(issue.calls.length, 1);
});

test('a copied tab record is replaced when the top-level tab marker differs', async () => {
  const storage = createStorage({
    'metamuseum.tab-visitor.v1': JSON.stringify({
      visitorId: 'visitor-a',
      capability: 'capability-a',
      tabMarker: 'tab-a',
      profile: { displayName: 'Mina 100', avatarId: 'robot', color: '#4CAF50' },
    }),
  });
  const issue = createIssuer([{ visitorId: 'visitor-b', capability: 'capability-b' }]);

  const record = await resolveVisitorSession({
    storage,
    fetch: issue,
    location: { search: '', pathname: '/room' },
    history: createHistory(),
    avatarIds: ['robot'],
    tabMarker: 'tab-b',
  });

  assert.equal(record.visitorId, 'visitor-b');
  assert.equal(record.tabMarker, 'tab-b');
  assert.equal(issue.calls.length, 1);
});

test('ensureTabMarker keeps one window.name marker across reloads', () => {
  const tab = { name: '' };
  let generated = 0;
  const dependencies = {
    tab,
    createMarker: () => `marker-${++generated}`,
  };

  assert.equal(ensureTabMarker(dependencies), 'metamuseum:marker-1');
  assert.equal(ensureTabMarker(dependencies), 'metamuseum:marker-1');
  assert.equal(tab.name, 'metamuseum:marker-1');
  assert.equal(generated, 1);
});

test('tab marker generation falls back when crypto or randomUUID is unavailable', () => {
  const dependencies = {
    crypto: {},
    now: () => 123456,
    random: () => 0.25,
  };

  const first = createTabMarker(dependencies);
  const second = createTabMarker({ ...dependencies, crypto: undefined });

  assert.match(first, /^fallback-/u);
  assert.match(second, /^fallback-/u);
  assert.notEqual(first, second);
});

test('same marker with an active peer mints a fresh tab identity once', async () => {
  const createBroadcastChannel = createBroadcastHub();
  const originalTab = { name: 'metamuseum:copied-marker' };
  const originalStorage = createStorage({
    'metamuseum.tab-visitor.v1': JSON.stringify({
      visitorId: 'visitor-a',
      capability: 'capability-a',
      tabMarker: 'metamuseum:copied-marker',
      profile: { displayName: 'Mina 100', avatarId: 'robot', color: '#4CAF50' },
    }),
  });
  const shared = {
    fetch: () => { throw new Error('the original tab must reuse its visitor'); },
    location: { search: '', pathname: '/room' },
    history: createHistory(),
    avatarIds: ['robot'],
    createBroadcastChannel,
  };
  const original = await openVisitorSession({
    ...shared,
    ...ownershipDependencies(),
    tab: originalTab,
    storage: originalStorage,
  });
  const duplicateTab = { name: originalTab.name };
  const duplicateStorage = cloneStorage(originalStorage);
  const issue = createIssuer([{ visitorId: 'visitor-b', capability: 'capability-b' }]);

  const duplicate = await openVisitorSession({
    ...shared,
    ...ownershipDependencies(),
    tab: duplicateTab,
    storage: duplicateStorage,
    fetch: issue,
  });

  assert.equal(original.visitorSession.visitorId, 'visitor-a');
  assert.equal(duplicate.visitorSession.visitorId, 'visitor-b');
  assert.notEqual(duplicateTab.name, originalTab.name);
  assert.equal(duplicate.visitorSession.tabMarker, duplicateTab.name);
  assert.equal(issue.calls.length, 1);
  original.release();
  duplicate.release();
});

test('same tab with no active peer reuses its stored visitor', async () => {
  const stored = {
    visitorId: 'visitor-a',
    capability: 'capability-a',
    tabMarker: 'metamuseum:tab-a',
    profile: { displayName: 'Mina 100', avatarId: 'robot', color: '#4CAF50' },
  };
  const opened = await openVisitorSession({
    ...ownershipDependencies({ createBroadcastChannel: createBroadcastHub() }),
    tab: { name: stored.tabMarker },
    storage: createStorage({
      'metamuseum.tab-visitor.v1': JSON.stringify(stored),
    }),
    fetch: () => { throw new Error('same-tab reload must not issue'); },
    location: { search: '', pathname: '/room' },
    history: createHistory(),
    avatarIds: ['robot'],
  });

  assert.deepEqual(opened.visitorSession, stored);
  opened.release();
});

test('unavailable BroadcastChannel safely reuses the same-tab visitor', async () => {
  const stored = {
    visitorId: 'visitor-a',
    capability: 'capability-a',
    tabMarker: 'metamuseum:tab-a',
    profile: { displayName: 'Mina 100', avatarId: 'robot', color: '#4CAF50' },
  };
  const opened = await openVisitorSession({
    ...ownershipDependencies({ createBroadcastChannel: undefined }),
    tab: { name: stored.tabMarker },
    storage: createStorage({
      'metamuseum.tab-visitor.v1': JSON.stringify(stored),
    }),
    fetch: () => { throw new Error('fallback must not issue'); },
    location: { search: '', pathname: '/room' },
    history: createHistory(),
    avatarIds: ['robot'],
  });

  assert.deepEqual(opened.visitorSession, stored);
  assert.doesNotThrow(() => opened.release());
});

test('updateVisitorSession owns profile normalization and storage writes', () => {
  const storage = createStorage();
  const visitorSession = {
    visitorId: 'visitor-a',
    capability: 'capability-a',
    tabMarker: 'tab-a',
    profile: { displayName: 'Mina 100', avatarId: 'robot', color: '#1565C0' },
  };

  const updated = updateVisitorSession({
    storage,
    visitorSession: {
      ...visitorSession,
      profile: { displayName: 'Updated Visitor', avatarId: 'shiba', color: '#abcdef' },
    },
  });

  assert.deepEqual(updated, {
    ...visitorSession,
    profile: { displayName: 'Updated Visitor', avatarId: 'shiba', color: '#ABCDEF' },
  });
  assert.deepEqual(JSON.parse(storage.values.get('metamuseum.tab-visitor.v1')), updated);
});

test('createRandomProfile chooses only non-empty allowed avatars', () => {
  const profile = createRandomProfile({
    avatarIds: ['none', 'robot'],
    random: () => 0,
  });

  assert.deepEqual(profile, {
    displayName: profile.displayName,
    avatarId: 'robot',
    color: profile.color,
  });
  assert.notEqual(profile.displayName, 'Visitor');
  assert.match(profile.color, /^#[0-9A-F]{6}$/u);
});
