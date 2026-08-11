import assert from 'node:assert/strict';
import test from 'node:test';

import { bootstrapRoomRealtime } from '../../app/metamuseum/static/js/room/bootstrap.js';

class FakeSocket {
  constructor() {
    this.connected = false;
    this.listeners = new Map();
    this.emitted = [];
  }

  on(eventName, handler) {
    this.listeners.set(eventName, handler);
  }

  off(eventName, handler) {
    if (this.listeners.get(eventName) === handler) this.listeners.delete(eventName);
  }

  connect() {}

  disconnect() {
    this.connected = false;
  }

  emit(eventName, payload) {
    this.emitted.push([eventName, payload]);
  }

  trigger(eventName, payload) {
    if (eventName === 'connect') this.connected = true;
    if (eventName === 'disconnect') this.connected = false;
    this.listeners.get(eventName)?.(payload);
  }
}

test('room realtime rejoins on reconnect and renders reducer snapshots', () => {
  const socket = new FakeSocket();
  const initialized = [];
  const rendered = [];
  const received = [];
  let injectedClient = null;
  const profileController = {
    joinPayload: () => ({
      room_id: 'room-a',
      profile: { displayName: 'Visitor', avatarId: 'shiba', color: '#4CAF50' },
    }),
    setSocketClient(client) {
      injectedClient = client;
    },
  };

  const realtime = bootstrapRoomRealtime({
    bootstrapData: { visitorId: 'self', roomId: 'room-a' },
    ioFactory: () => socket,
    profileController,
    socketUrl: 'https://museum.test',
    consumers: {
      initialize: (client) => initialized.push(client),
      renderUsers: (users) => rendered.push(users),
      handleSocketEvent: (eventName, payload) => received.push([eventName, payload]),
    },
  });

  assert.equal(injectedClient, realtime.socketClient);
  assert.deepEqual(initialized, [realtime.socketClient]);

  socket.trigger('connect');
  socket.trigger('disconnect');
  socket.trigger('connect');
  assert.deepEqual(socket.emitted, [
    ['join_position_room', profileController.joinPayload()],
    ['voice.get_state', { room_id: 'room-a' }],
    ['join_position_room', profileController.joinPayload()],
    ['voice.get_state', { room_id: 'room-a' }],
  ]);

  socket.trigger('room_state', {
    users: [
      { userId: 'self', displayName: 'Local', position: '0 1.6 0', rotation: '0 0 0' },
      { userId: 'other', displayName: 'Other', position: '0 1.6 0', rotation: '0 0 0' },
    ],
  });
  socket.trigger('position_update', { userId: 'other', position: '1 2 3' });
  socket.trigger('profile_updated', { userId: 'other', displayName: 'Updated' });
  socket.trigger('user_left', { userId: 'other' });

  assert.deepEqual(rendered, [
    [{ userId: 'other', displayName: 'Other', position: '0 1.6 0', rotation: '0 0 0' }],
    [{ userId: 'other', displayName: 'Other', position: '1 2 3', rotation: '0 0 0' }],
    [{ userId: 'other', displayName: 'Updated', position: '1 2 3', rotation: '0 0 0' }],
    [],
  ]);
  assert.deepEqual(received, [['user_left', { userId: 'other' }]]);
});

test('room realtime forwards ancillary public socket events unchanged', () => {
  const socket = new FakeSocket();
  const received = [];
  bootstrapRoomRealtime({
    bootstrapData: { visitorId: 'self', roomId: 'room-a' },
    ioFactory: () => socket,
    profileController: {
      joinPayload: () => ({ room_id: 'room-a', profile: {} }),
      setSocketClient() {},
    },
    socketUrl: 'https://museum.test',
    consumers: {
      initialize() {},
      renderUsers() {},
      handleSocketEvent: (eventName, payload) => received.push([eventName, payload]),
    },
  });

  const events = [
    'expression',
    'voice_admin_toggle',
    'voice.offer',
    'voice.answer',
    'voice.ice',
    'voice.join',
    'voice.leave',
    'voice.mute',
    'voice.transcript',
    'room_effects',
    'room_effects_cleared',
  ];
  events.forEach((eventName) => socket.trigger(eventName, { eventName }));

  assert.deepEqual(received, events.map((eventName) => [eventName, { eventName }]));
});

test('user join is stored but waits for renderable position data', () => {
  const socket = new FakeSocket();
  const rendered = [];
  const realtime = bootstrapRoomRealtime({
    bootstrapData: { visitorId: 'self', roomId: 'room-a' },
    ioFactory: () => socket,
    profileController: {
      joinPayload: () => ({ room_id: 'room-a', profile: {} }),
      setSocketClient() {},
    },
    socketUrl: 'https://museum.test',
    consumers: {
      initialize() {},
      renderUsers: (users) => rendered.push(users),
      handleSocketEvent() {},
    },
  });

  socket.trigger('user_joined', { userId: 'other', displayName: 'Other' });
  assert.deepEqual(realtime.state.users(), [{ userId: 'other', displayName: 'Other' }]);
  assert.deepEqual(rendered, []);

  socket.trigger('profile_updated', { userId: 'other', displayName: 'Updated' });
  assert.deepEqual(realtime.state.users(), [{ userId: 'other', displayName: 'Updated' }]);
  assert.deepEqual(rendered, [[]]);

  socket.trigger('position_update', {
    userId: 'other',
    position: '0 1.6 0',
    rotation: '0 0 0',
  });
  assert.deepEqual(rendered, [
    [],
    [{
      userId: 'other',
      displayName: 'Updated',
      position: '0 1.6 0',
      rotation: '0 0 0',
    }],
  ]);
});
