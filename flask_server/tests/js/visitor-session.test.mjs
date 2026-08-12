import assert from 'node:assert/strict';
import test from 'node:test';

import {
  createRandomProfile,
  ensureTabMarker,
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
