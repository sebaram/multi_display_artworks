import assert from 'node:assert/strict';
import test from 'node:test';

import {
  createRandomProfile,
  replaceVisitorSession,
  resolveVisitorSession,
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
    random: () => 0,
  });

  assert.equal(record.visitorId, 'visitor-a');
  assert.equal(record.capability, 'capability-a');
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
  });

  assert.equal(record.visitorId, 'visitor-b');
  assert.equal(issue.calls.length, 1);
});

test('replaceVisitorSession always persists a fresh issued record', async () => {
  const storage = createStorage({
    'metamuseum.tab-visitor.v1': JSON.stringify({
      visitorId: 'visitor-a',
      capability: 'capability-a',
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
  });

  assert.equal(record.visitorId, 'visitor-b');
  assert.equal(issue.calls.length, 1);
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
