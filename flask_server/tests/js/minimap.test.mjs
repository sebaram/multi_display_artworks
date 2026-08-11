import assert from 'node:assert/strict';
import test from 'node:test';

import { mountRoomControls } from '../../app/metamuseum/static/js/room/bootstrap.js';
import { mountMinimap } from '../../app/metamuseum/static/js/room/minimap.js';
import {
  isMobilePointer,
  mountMobileGuidance,
} from '../../app/metamuseum/static/js/room/mobile-guidance.js';

class RecordingContext {
  constructor() {
    this.operations = [];
    this.fillStyle = '';
    this.strokeStyle = '';
  }

  clearRect(...args) { this.operations.push({ name: 'clearRect', args }); }
  fillRect(...args) { this.operations.push({ name: 'fillRect', args, color: this.fillStyle }); }
  strokeRect(...args) { this.operations.push({ name: 'strokeRect', args, color: this.strokeStyle }); }
  beginPath() { this.operations.push({ name: 'beginPath' }); }
  moveTo(...args) { this.operations.push({ name: 'moveTo', args }); }
  lineTo(...args) { this.operations.push({ name: 'lineTo', args }); }
  stroke() { this.operations.push({ name: 'stroke', color: this.strokeStyle }); }
  arc(...args) { this.operations.push({ name: 'arc', args }); }
  fill() { this.operations.push({ name: 'fill', color: this.fillStyle }); }
  fillText(...args) { this.operations.push({ name: 'fillText', args, color: this.fillStyle }); }
  setLineDash(args) { this.operations.push({ name: 'setLineDash', args }); }
}

class FakeElement {
  constructor(tagName, ownerDocument) {
    this.tagName = tagName;
    this.ownerDocument = ownerDocument;
    this.attributes = {};
    this.children = [];
    this.listeners = new Map();
    this.parentNode = null;
    this.style = {};
    this.textContent = '';
    this.open = false;
    this.clientWidth = tagName === 'div' || tagName === 'dialog' ? 480 : 0;
    if (tagName === 'canvas') this.context = new RecordingContext();
  }

  setAttribute(name, value) {
    this.attributes[name] = String(value);
  }

  getAttribute(name) {
    return this.attributes[name] ?? null;
  }

  append(...children) {
    children.forEach((child) => this.appendChild(child));
  }

  appendChild(child) {
    child.parentNode = this;
    this.children.push(child);
    return child;
  }

  addEventListener(type, listener) {
    const listeners = this.listeners.get(type) ?? [];
    listeners.push(listener);
    this.listeners.set(type, listeners);
  }

  removeEventListener(type, listener) {
    const listeners = this.listeners.get(type) ?? [];
    this.listeners.set(type, listeners.filter((candidate) => candidate !== listener));
  }

  dispatchEvent(event) {
    event.target ??= this;
    event.currentTarget = this;
    event.preventDefault ??= () => { event.defaultPrevented = true; };
    for (const listener of this.listeners.get(event.type) ?? []) listener(event);
    return !event.defaultPrevented;
  }

  focus() {
    this.ownerDocument.activeElement = this;
  }

  showModal() {
    this.open = true;
  }

  close() {
    if (!this.open) return;
    this.open = false;
    this.dispatchEvent({ type: 'close' });
  }

  remove() {
    if (!this.parentNode) return;
    this.parentNode.children = this.parentNode.children.filter((child) => child !== this);
    this.parentNode = null;
  }

  getContext() {
    return this.context;
  }

  getBoundingClientRect() {
    return {
      left: 100,
      top: 100,
      right: 100 + this.clientWidth,
      bottom: 520,
      width: this.clientWidth,
      height: 420,
    };
  }
}

function createDocument() {
  const document = {
    activeElement: null,
    createElement(tagName) {
      return new FakeElement(tagName, document);
    },
  };
  document.body = document.createElement('body');
  return document;
}

function descendants(root) {
  return [root, ...root.children.flatMap(descendants)];
}

function find(root, predicate) {
  return descendants(root).find(predicate);
}

function visibleText(document) {
  return descendants(document.body).map((element) => element.textContent).join(' ');
}

function createFrameScheduler() {
  let nextId = 1;
  const pending = new Map();
  const cancelled = [];
  return {
    pending,
    cancelled,
    request(callback) {
      const id = nextId;
      nextId += 1;
      pending.set(id, callback);
      return id;
    },
    cancel(id) {
      cancelled.push(id);
      pending.delete(id);
    },
    runNext() {
      const [id, callback] = pending.entries().next().value;
      pending.delete(id);
      callback();
    },
  };
}

const boundary = { min_x: -10, max_x: 10, min_z: -10, max_z: 10 };
const presets = [{ id: 'start', name: 'Start', position: '1 1.6 2', is_default: true }];
const wallList = [{
  position: '0 1 0',
  width: 8,
  rotation: '0 0 0',
  surface_type: 'wall',
  elements: [{ name: 'Artwork', type: 'image', world_x: 2, world_z: 3 }],
}];

function mountFixture() {
  const document = createDocument();
  const frames = createFrameScheduler();
  const cameraPosition = { x: 3, y: 1.6, z: 4 };
  const camera = {
    getAttribute(name) {
      if (name === 'position') return cameraPosition;
      if (name === 'rotation') return { y: 45 };
      return null;
    },
  };
  const minimap = mountMinimap({
    presets,
    boundary,
    wallList,
    getCamera: () => camera,
    document,
    requestAnimationFrame: frames.request.bind(frames),
    cancelAnimationFrame: frames.cancel.bind(frames),
  });
  return { document, frames, cameraPosition, ...minimap };
}

test('compact minimap opens an accessible large map without changing the camera', () => {
  const fixture = mountFixture();
  const before = { ...fixture.cameraPosition };

  fixture.canvas.focus();
  fixture.canvas.dispatchEvent({ type: 'click' });

  assert.equal(fixture.dialog.open, true);
  assert.deepEqual(fixture.cameraPosition, before);
  assert.equal(fixture.canvas.attributes.role, 'button');
  assert.match(fixture.canvas.attributes['aria-label'], /open.*map/i);
  assert.equal(fixture.dialog.attributes['aria-labelledby'], 'expanded-map-title');
  assert.match(fixture.dialog.style.cssText, /80vw/);
  assert.match(fixture.dialog.style.cssText, /80vh/);
});

test('large map renders the room features shown on the compact map and a legend', () => {
  const fixture = mountFixture();
  fixture.canvas.dispatchEvent({ type: 'click' });

  const expectedColors = [
    'rgba(120,160,255,0.8)',
    '#4CAF50',
    '#FFD700',
    '#00E676',
  ];
  for (const context of [fixture.canvas.context, fixture.expandedCanvas.context]) {
    const colors = context.operations.map((operation) => operation.color);
    expectedColors.forEach((color) => assert.ok(colors.includes(color), `missing ${color}`));
    assert.ok(context.operations.some((operation) => operation.name === 'strokeRect'));
  }
  assert.match(visibleText(fixture.document), /Wall/);
  assert.match(visibleText(fixture.document), /Artwork/);
  assert.match(visibleText(fixture.document), /Preset/);
  assert.match(visibleText(fixture.document), /You/);
});

test('large map closes from its button, backdrop, and Escape and restores focus', () => {
  const fixture = mountFixture();
  const closeButton = find(fixture.dialog, (element) => element.textContent === 'Close');

  fixture.canvas.focus();
  fixture.canvas.dispatchEvent({ type: 'click' });
  closeButton.dispatchEvent({ type: 'click' });
  assert.equal(fixture.dialog.open, false);
  assert.equal(fixture.document.activeElement, fixture.canvas);

  fixture.canvas.dispatchEvent({ type: 'click' });
  fixture.dialog.dispatchEvent({
    type: 'click',
    target: fixture.dialog,
    clientX: 110,
    clientY: 110,
  });
  assert.equal(fixture.dialog.open, true);
  fixture.dialog.dispatchEvent({
    type: 'click',
    target: fixture.dialog,
    clientX: 50,
    clientY: 50,
  });
  assert.equal(fixture.dialog.open, false);
  assert.equal(fixture.document.activeElement, fixture.canvas);

  fixture.canvas.dispatchEvent({ type: 'click' });
  fixture.dialog.dispatchEvent({ type: 'keydown', key: 'Escape' });
  assert.equal(fixture.dialog.open, false);
  assert.equal(fixture.document.activeElement, fixture.canvas);
});

test('minimap redraw uses a cancellable animation-frame lifecycle', () => {
  const fixture = mountFixture();

  assert.equal(fixture.frames.pending.size, 1);
  fixture.frames.runNext();
  assert.equal(fixture.frames.pending.size, 1);

  const pendingId = fixture.frames.pending.keys().next().value;
  fixture.destroy();
  assert.deepEqual(fixture.frames.cancelled, [pendingId]);
  assert.equal(fixture.frames.pending.size, 0);
  assert.equal(fixture.canvas.parentNode, null);
  assert.equal(fixture.dialog.parentNode, null);
});

function createMediaQuery(matches) {
  const listeners = new Set();
  return {
    matches,
    addEventListener(type, listener) {
      if (type === 'change') listeners.add(listener);
    },
    removeEventListener(type, listener) {
      if (type === 'change') listeners.delete(listener);
    },
    setMatches(nextMatches) {
      this.matches = nextMatches;
      listeners.forEach((listener) => listener({ matches: nextMatches }));
    },
    get listenerCount() {
      return listeners.size;
    },
  };
}

test('movement guidance requires both a coarse pointer and a mobile width', () => {
  assert.equal(isMobilePointer({ matches: true }, { matches: false }), false);
  assert.equal(isMobilePointer({ matches: false }, { matches: true }), false);
  assert.equal(isMobilePointer({ matches: true }, { matches: true }), true);
});

test('movement guidance reacts to both media queries and cleans up', () => {
  const document = createDocument();
  const coarse = createMediaQuery(true);
  const mobileWidth = createMediaQuery(false);
  const queries = {
    '(pointer: coarse)': coarse,
    '(max-width: 767px)': mobileWidth,
  };
  const guidance = mountMobileGuidance({
    document,
    matchMedia: (query) => queries[query],
  });

  assert.doesNotMatch(visibleText(document), /Hold and drag to move/);
  mobileWidth.setMatches(true);
  assert.equal(visibleText(document).match(/Hold and drag to move/g)?.length, 1);
  coarse.setMatches(false);
  assert.doesNotMatch(visibleText(document), /Hold and drag to move/);
  coarse.setMatches(true);
  assert.equal(visibleText(document).match(/Hold and drag to move/g)?.length, 1);

  guidance.destroy();
  assert.doesNotMatch(visibleText(document), /Hold and drag to move/);
  assert.equal(coarse.listenerCount, 0);
  assert.equal(mobileWidth.listenerCount, 0);
});

test('room controls keep mobile guidance when the minimap boundary is unavailable', () => {
  const document = createDocument();
  document.getElementById = () => null;
  const coarse = createMediaQuery(true);
  const mobileWidth = createMediaQuery(true);
  const queries = {
    '(pointer: coarse)': coarse,
    '(max-width: 767px)': mobileWidth,
  };
  const controls = mountRoomControls({
    bootstrapData: {
      roomControlsEnabled: true,
      boundary: null,
      presets: [],
      wallList: [],
    },
    document,
    window: {
      matchMedia: (query) => queries[query],
      requestAnimationFrame() {},
      cancelAnimationFrame() {},
    },
  });

  assert.equal(controls.minimap, null);
  assert.match(visibleText(document), /Hold and drag to move/);

  controls.destroy();
  assert.doesNotMatch(visibleText(document), /Hold and drag to move/);
  assert.equal(coarse.listenerCount, 0);
  assert.equal(mobileWidth.listenerCount, 0);
});
