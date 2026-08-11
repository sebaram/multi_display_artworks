import assert from 'node:assert/strict';
import test from 'node:test';

import { createAvatarExpressions } from '../../app/metamuseum/static/js/avatar-expression.js';

class FakeElement {
  constructor(tagName) {
    this.tagName = tagName;
    this.attributes = new Map();
    this.children = [];
    this.parentNode = null;
    this.style = {};
    this.readyState = 2;
  }

  setAttribute(name, value) {
    this.attributes.set(name, String(value));
  }

  getAttribute(name) {
    return this.attributes.get(name) ?? null;
  }

  appendChild(child) {
    child.parentNode = this;
    this.children.push(child);
    return child;
  }

  querySelector(selector) {
    if (selector !== '.expression-bubble') return null;
    return this.children.find((child) => child.getAttribute('class') === 'expression-bubble') ?? null;
  }

  async play() {}
}

function createDocument() {
  const camera = new FakeElement('a-camera');
  const head = new FakeElement('head');
  return {
    camera,
    head,
    body: new FakeElement('body'),
    createElement: (tagName) => new FakeElement(tagName),
    getElementById(id) {
      return id === 'camera' ? camera : null;
    },
  };
}

test('a detected smile renders on the real camera and emits through the injected socket', async () => {
  const document = createDocument();
  const emitted = [];
  let intervalCallback;
  const faceapi = {
    nets: {
      tinyFaceDetector: { loadFromUri: async () => {} },
      faceExpressionNet: { loadFromUri: async () => {} },
    },
    TinyFaceDetectorOptions: class {},
    detectAllFaces() {
      return { withFaceExpressions: async () => [{ expressions: { happy: 0.9 } }] };
    },
  };
  const expressions = createAvatarExpressions({
    document,
    navigator: {
      maxTouchPoints: 1,
      mediaDevices: { getUserMedia: async () => ({}) },
    },
    setInterval(callback) {
      intervalCallback = callback;
      return 1;
    },
    clearInterval() {},
    setTimeout() {},
    now: () => 5000,
    console: { log() {}, warn() {} },
    getFaceApi: () => faceapi,
  });
  expressions.init({ emit: (...args) => emitted.push(args) }, 'room-a', 'visitor-a');

  await document.head.children[0].onload();
  await intervalCallback();

  const bubble = document.camera.querySelector('.expression-bubble');
  assert.ok(bubble, 'the local camera should contain the expression render target');
  assert.equal(bubble.getAttribute('value'), '😊');
  assert.equal(bubble.getAttribute('position'), '0 0.8 -1.5');
  assert.deepEqual(emitted, [[
    'expression',
    { room_id: 'room-a', userId: 'visitor-a', expression: '😊' },
  ]]);
});

test('a hand-raise trigger uses the same local render and injected broadcast path', () => {
  const document = createDocument();
  const emitted = [];
  const expressions = createAvatarExpressions({
    document,
    navigator: { maxTouchPoints: 0 },
    setInterval() { return 1; },
    clearInterval() {},
    setTimeout() {},
    now: () => 5000,
    console: { log() {}, warn() {} },
  });
  expressions.init({ emit: (...args) => emitted.push(args) }, 'room-a', 'visitor-a');

  expressions.onHandRaiseDetected('left');

  assert.equal(document.camera.querySelector('.expression-bubble').getAttribute('value'), '👋');
  assert.deepEqual(emitted, [[
    'expression',
    { room_id: 'room-a', userId: 'visitor-a', expression: '👋' },
  ]]);
});
