import assert from 'node:assert/strict';
import test from 'node:test';

import { createRoomState } from '../../../src/scene/legacy/core/room-state.js';
import { normalizeProfile } from '../../../src/scene/legacy/profile-store.js';
import { installAvatarCatalog } from '../../../src/scene/legacy/avatar-catalog.js';
import { readFileSync } from 'node:fs';

test('a three-field legacy profile update replaces an observer humanoid appearance', () => {
  const catalog = JSON.parse(readFileSync(new URL('../../../public/avatars/catalog.fixture.json', import.meta.url)));
  installAvatarCatalog(catalog);
  const state = createRoomState('self');
  state.applyJoin({ userId: 'other', displayName: 'Other', avatarId: 'casual', color: '#4587C4', appearance: catalog.presets[0].defaultAppearance });
  state.applyUpdate({ userId: 'other', displayName: 'Other', avatarId: 'robot', color: '#123456' });
  expectLegacy(state.users()[0]);
  state.applyUpdate({ userId: 'other', appearance: null, avatarId: 'robot', color: '#123456' });
  expectLegacy(state.users()[0]);
  function expectLegacy(user) {
    assert.equal(user.appearance == null, true);
    assert.equal(normalizeProfile(user).avatarId, 'robot');
    assert.equal(normalizeProfile(user).color, '#123456');
  }
});

test('room state excludes the local user and removes departed users', () => {
  const state = createRoomState('self');

  state.applyRoomState([
    { userId: 'self', displayName: 'Local' },
    { userId: 'other', displayName: 'Other' },
  ]);
  state.applyLeave({ userId: 'other' });

  assert.deepEqual(state.users(), []);
});

test('join and update events merge remote presence without admitting self', () => {
  const state = createRoomState('self');

  state.applyJoin({
    userId: 'other',
    displayName: 'Other',
    avatarId: 'shiba',
  });
  state.applyUpdate({ userId: 'other', position: '1 2 3' });
  state.applyJoin({ userId: 'self', displayName: 'Local' });
  state.applyUpdate({ userId: 'self', position: '9 9 9' });

  assert.deepEqual(state.users(), [{
    userId: 'other',
    displayName: 'Other',
    avatarId: 'shiba',
    position: '1 2 3',
  }]);
});

test('a full room state replaces stale presence and returns defensive copies', () => {
  const state = createRoomState('self');
  state.applyJoin({ userId: 'stale', displayName: 'Stale' });

  state.applyRoomState([{ userId: 'current', displayName: 'Current' }]);
  const snapshot = state.users();
  snapshot[0].displayName = 'Mutated';

  assert.deepEqual(state.users(), [{ userId: 'current', displayName: 'Current' }]);
});
