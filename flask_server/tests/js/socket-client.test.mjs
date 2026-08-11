import assert from 'node:assert/strict';
import test from 'node:test';

import { createSocketClient } from '../../app/metamuseum/static/js/room/core/socket-client.js';

class FakeSocket {
  constructor(order) {
    this.connected = false;
    this.connectCalls = 0;
    this.disconnectCalls = 0;
    this.emitted = [];
    this.listeners = new Map();
    this.order = order;
  }

  on(eventName, handler) {
    this.order.push(`on:${eventName}`);
    const listeners = this.listeners.get(eventName) ?? [];
    listeners.push(handler);
    this.listeners.set(eventName, listeners);
  }

  off(eventName, handler) {
    const listeners = this.listeners.get(eventName) ?? [];
    this.listeners.set(eventName, listeners.filter((listener) => listener !== handler));
  }

  connect() {
    this.order.push('connect');
    this.connectCalls += 1;
  }

  disconnect() {
    this.disconnectCalls += 1;
    this.connected = false;
  }

  emit(eventName, payload) {
    this.emitted.push([eventName, payload]);
  }

  trigger(eventName, payload) {
    for (const handler of this.listeners.get(eventName) ?? []) handler(payload);
  }
}

function createFactory() {
  const calls = [];
  const sockets = [];
  const order = [];
  const factory = (url, options) => {
    calls.push([url, options]);
    const socket = new FakeSocket(order);
    sockets.push(socket);
    return socket;
  };
  return { calls, factory, order, sockets };
}

test('connect registers handlers before starting one socket connection', () => {
  const fake = createFactory();
  const received = [];
  const client = createSocketClient(fake.factory, {
    room_state: (payload) => received.push(payload),
    connect: () => received.push('connected'),
  });

  client.connect('https://museum.test', { transports: ['websocket', 'polling'] });
  client.connect('https://museum.test', { transports: ['websocket'] });
  fake.sockets[0].trigger('room_state', { users: [] });

  assert.equal(fake.calls.length, 1);
  assert.deepEqual(fake.calls[0], [
    'https://museum.test',
    { transports: ['websocket', 'polling'], autoConnect: false },
  ]);
  assert.deepEqual(fake.order, ['on:room_state', 'on:connect', 'connect']);
  assert.deepEqual(received, [{ users: [] }]);
});

test('emit is gated by connection state and remains available after reconnect', () => {
  const fake = createFactory();
  const client = createSocketClient(fake.factory, {});

  client.connect('https://museum.test');
  const socket = fake.sockets[0];
  assert.equal(client.emit('position_update', { position: '0 0 0' }), false);

  socket.connected = true;
  assert.equal(client.emit('position_update', { position: '1 2 3' }), true);
  socket.connected = false;
  assert.equal(client.emit('position_update', { position: '4 5 6' }), false);
  socket.connected = true;
  assert.equal(client.emit('profile_update', { profile: {} }), true);

  assert.deepEqual(socket.emitted, [
    ['position_update', { position: '1 2 3' }],
    ['profile_update', { profile: {} }],
  ]);
});

test('destroy detaches handlers and a later connect creates a clean socket', () => {
  const fake = createFactory();
  let connects = 0;
  const client = createSocketClient(fake.factory, {
    connect: () => { connects += 1; },
  });

  client.connect('https://museum.test');
  const first = fake.sockets[0];
  first.trigger('connect');
  client.destroy();
  first.trigger('connect');

  client.connect('https://museum.test');
  const second = fake.sockets[1];
  second.trigger('connect');

  assert.equal(first.disconnectCalls, 1);
  assert.equal(first.listeners.get('connect').length, 0);
  assert.equal(fake.calls.length, 2);
  assert.equal(connects, 2);
});
