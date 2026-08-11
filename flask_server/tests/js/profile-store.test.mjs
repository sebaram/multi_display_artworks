import assert from 'node:assert/strict';
import test from 'node:test';

import {
  loadProfile,
  normalizeProfile,
  saveProfile,
} from '../../app/metamuseum/static/js/room/profile-store.js';

function createStorage() {
  const values = new Map();
  return {
    getItem: (key) => values.get(key) ?? null,
    setItem: (key, value) => values.set(key, value),
  };
}

test('profile stays local to its signed visitor id', () => {
  const storage = createStorage();

  saveProfile(storage, 'visitor-a', {
    displayName: 'Visitor A',
    avatarId: 'robot',
    color: '#abcdef',
  });

  assert.deepEqual(loadProfile(storage, 'visitor-a'), {
    displayName: 'Visitor A',
    avatarId: 'robot',
    color: '#ABCDEF',
  });
  assert.deepEqual(loadProfile(storage, 'visitor-b'), {
    displayName: 'Visitor',
    avatarId: 'shiba',
    color: '#4CAF50',
  });
});

test('normalizeProfile accepts only public names, catalog IDs, and hex colors', () => {
  assert.deepEqual(normalizeProfile({
    displayName: '  Valid Name  ',
    avatarId: 'rigged-simple',
    color: '#12abef',
  }), {
    displayName: 'Valid Name',
    avatarId: 'rigged-simple',
    color: '#12ABEF',
  });

  assert.deepEqual(normalizeProfile({
    displayName: 'x',
    avatarId: 'https://attacker.invalid/avatar.glb',
    color: 'blue',
  }), {
    displayName: 'Visitor',
    avatarId: 'shiba',
    color: '#4CAF50',
  });
});

test('loadProfile recovers from invalid stored JSON', () => {
  const storage = createStorage();
  storage.setItem('metamuseum.profile.visitor-a', '{not json');

  assert.deepEqual(loadProfile(storage, 'visitor-a'), {
    displayName: 'Visitor',
    avatarId: 'shiba',
    color: '#4CAF50',
  });
});
