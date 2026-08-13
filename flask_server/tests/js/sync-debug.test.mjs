import assert from 'node:assert/strict';
import test from 'node:test';

import { mountSyncDebug } from '../../app/metamuseum/static/js/room/ui/sync-debug.js';

function fakeDocument() {
  const created = [];
  return {
    created,
    createElement(tagName) {
      const element = { tagName, style: {}, textContent: '', appendChild() {}, remove() {} };
      created.push(element);
      return element;
    },
    body: { appendChild() {} },
  };
}

test('the overlay reports send rate, receive rate, and worst staleness', () => {
  const document = fakeDocument();
  const timers = [];
  let clock = 0;
  const emitted = [];
  const socketClient = { emit: (event) => { emitted.push(event); return true; } };

  const overlay = mountSyncDebug({
    document,
    poseBuffer: { userIds: () => ['a', 'b'], stalenessMs: (id) => (id === 'a' ? 40 : 900) },
    socketClient,
    now: () => clock,
    setInterval: (callback) => { timers.push(callback); return timers.length; },
    clearInterval: () => {},
  });

  socketClient.emit('position_update', {});
  socketClient.emit('position_update', {});
  overlay.recordReceive();
  clock = 1000;
  timers.forEach((callback) => callback());

  const panel = document.created[0];
  assert.match(panel.textContent, /send 2\/s/u);
  assert.match(panel.textContent, /recv 1\/s/u);
  assert.match(panel.textContent, /stale 900ms/u);
  assert.deepEqual(emitted, ['position_update', 'position_update']);  // still forwarded
});
