import assert from 'node:assert/strict';
import test from 'node:test';

import { createRoomState } from '../../app/metamuseum/static/js/room/core/room-state.js';

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
