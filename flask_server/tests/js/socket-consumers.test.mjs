import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

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
  assert.match(expressions, /function initAvatarExpressions\(socketClient\)/u);
  assert.match(effects, /init: function\(roomId, socketClient\)/u);
});
