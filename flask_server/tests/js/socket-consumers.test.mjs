import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

import { createRoomConsumers } from '../../app/metamuseum/static/js/room/bootstrap.js';

const staticRoot = new URL('../../app/metamuseum/static/js/', import.meta.url);

test('legacy room consumers receive the socket client explicitly', async () => {
  const [voice, expressions, effects] = await Promise.all([
    readFile(new URL('voice-chat.js', staticRoot), 'utf8'),
    readFile(new URL('avatar-expression.js', staticRoot), 'utf8'),
    readFile(new URL('room-effects.js', staticRoot), 'utf8'),
  ]);

  for (const source of [voice, expressions, effects]) {
    assert.doesNotMatch(source, /\bposSocket(?:Connected)?\b/u);
  }
  assert.match(voice, /function initVoiceChat\(roomId, userId, isAdmin, socketClient\)/u);
  assert.match(expressions, /function initAvatarExpressions\(socketClient, roomId, userId\)/u);
  assert.match(effects, /init: function\(roomId, socketClient\)/u);
});

test('room consumers route scene, effects, expressions, and voice through injected adapters', () => {
  const calls = [];
  const socketClient = {};
  const consumers = createRoomConsumers({
    sceneRenderer: { renderUsers: (users) => calls.push(['render', users]) },
    roomId: 'room-a',
    visitorId: 'visitor-a',
    isAdmin: true,
    effects: {
      init: (...args) => calls.push(['effects.init', ...args]),
      handleSocketEvent: (...args) => calls.push(['effects.event', ...args]),
    },
    expressions: {
      init: (...args) => calls.push(['expressions.init', ...args]),
      handleSocketEvent: (...args) => calls.push(['expressions.event', ...args]),
    },
    initializeVoice: (...args) => calls.push(['voice.init', ...args]),
    voice: { handleSocketEvent: (...args) => calls.push(['voice.event', ...args]) },
  });

  consumers.initialize(socketClient);
  consumers.renderUsers([{ userId: 'other' }]);
  consumers.handleSocketEvent('expression', { expression: '😊' });

  assert.deepEqual(calls, [
    ['effects.init', 'room-a', socketClient],
    ['expressions.init', socketClient, 'room-a', 'visitor-a'],
    ['voice.init', 'room-a', 'visitor-a', true, socketClient],
    ['render', [{ userId: 'other' }]],
    ['effects.event', 'expression', { expression: '😊' }],
    ['expressions.event', { expression: '😊' }],
    ['voice.event', 'expression', { expression: '😊' }],
  ]);
});
