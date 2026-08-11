import assert from 'node:assert/strict';
import test from 'node:test';

import { initVoiceChat, VoiceChat } from '../../app/metamuseum/static/js/voice-chat.js';

function createDocument() {
  class FakeElement {
    constructor(tagName) {
      this.tagName = tagName;
      this.children = [];
      this.parentNode = null;
      this.style = {};
      this.id = '';
      this.textContent = '';
      this.onclick = null;
    }

    appendChild(child) {
      child.parentNode = this;
      this.children.push(child);
      return child;
    }

    remove() {
      if (!this.parentNode) return;
      this.parentNode.children = this.parentNode.children.filter((child) => child !== this);
    }
  }

  const document = {
    createElement: (tagName) => new FakeElement(tagName),
    getElementById(id) {
      const visit = (element) => (
        element.id === id
          ? element
          : element.children.map(visit).find(Boolean)
      );
      return visit(document.body);
    },
  };
  document.body = document.createElement('body');
  return document;
}

test('a displaced voice session stops local media and closes peer connections', () => {
  const originalDocument = globalThis.document;
  const emitted = [];
  let trackStopped = false;
  let peerClosed = false;
  globalThis.document = { getElementById: () => null };
  Object.assign(VoiceChat, {
    enabled: true,
    active: true,
    muted: false,
    displaced: false,
    roomId: 'room-a',
    userId: 'same-browser',
    localStream: {
      getTracks: () => [{ stop() { trackStopped = true; } }],
    },
    peers: {
      peer: { close() { peerClosed = true; } },
    },
    peerStreams: { peer: {} },
    socketClient: {
      emit(eventName, payload) { emitted.push([eventName, payload]); },
    },
    transcriber: null,
  });

  try {
    VoiceChat.handleSocketEvent('voice.displaced', { room_id: 'room-a' });

    assert.equal(trackStopped, true);
    assert.equal(peerClosed, true);
    assert.equal(VoiceChat.active, false);
    assert.equal(VoiceChat.enabled, false);
    assert.equal(VoiceChat.displaced, true);
    assert.deepEqual(VoiceChat.peers, {});
    assert.deepEqual(VoiceChat.peerStreams, {});
    assert.deepEqual(emitted, [[
      'voice.leave',
      { room_id: 'room-a', userId: 'same-browser' },
    ]]);
  } finally {
    globalThis.document = originalDocument;
  }
});

test('displacement during microphone permission stops the acquired stream', async () => {
  const originalDocument = globalThis.document;
  const originalNavigator = Object.getOwnPropertyDescriptor(globalThis, 'navigator');
  const originalSetTimeout = globalThis.setTimeout;
  const document = createDocument();
  let resolveMedia;
  let trackStopped = false;
  const track = {
    enabled: true,
    stop() { trackStopped = true; },
  };
  const mediaPromise = new Promise((resolve) => { resolveMedia = resolve; });
  globalThis.document = document;
  globalThis.setTimeout = () => 0;
  Object.defineProperty(globalThis, 'navigator', {
    configurable: true,
    value: { mediaDevices: { getUserMedia: () => mediaPromise } },
  });

  try {
    initVoiceChat('room-a', 'same-browser', false, { emit() {} });
    VoiceChat.enabled = true;
    VoiceChat.active = false;
    VoiceChat.localStream = null;
    document.getElementById('voice-btn').onclick();

    VoiceChat.handleSocketEvent('voice.displaced', { room_id: 'room-a' });
    resolveMedia({
      getTracks: () => [track],
      getAudioTracks: () => [track],
    });
    await mediaPromise;
    await Promise.resolve();

    assert.equal(trackStopped, true);
    assert.equal(VoiceChat.active, false);
    assert.equal(VoiceChat.localStream, null);
  } finally {
    globalThis.document = originalDocument;
    globalThis.setTimeout = originalSetTimeout;
    if (originalNavigator) {
      Object.defineProperty(globalThis, 'navigator', originalNavigator);
    } else {
      delete globalThis.navigator;
    }
  }
});
