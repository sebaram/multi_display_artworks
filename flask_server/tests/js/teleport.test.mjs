import assert from 'node:assert/strict';
import test from 'node:test';

import {
  mountTeleportControls,
  teleport,
} from '../../app/metamuseum/static/js/room/interaction/teleport.js';

function fakeCamera(initial = {}) {
  return {
    ...initial,
    writes: [],
    setAttribute(name, value) {
      this[name] = value;
      this.writes.push([name, value]);
    },
  };
}

const boundary = {
  min_x: -2,
  max_x: 2,
  min_y: 0,
  max_y: 4,
  min_z: -3,
  max_z: 3,
};

test('teleport changes only the camera position and rotation', () => {
  const camera = fakeCamera({ untouched: 'keep' });

  teleport(camera, { position: '1 2 3', rotation: '0 90 0' }, boundary);

  assert.equal(camera.position, '1 2 3');
  assert.equal(camera.rotation, '0 90 0');
  assert.equal(camera.untouched, 'keep');
  assert.deepEqual(camera.writes, [
    ['position', '1 2 3'],
    ['rotation', '0 90 0'],
  ]);
});

test('teleport clamps every position axis to the room boundary', () => {
  const camera = fakeCamera();

  teleport(camera, { position: '-9 8 12', rotation: '10 20 30' }, boundary);

  assert.equal(camera.position, '-2 4 3');
  assert.equal(camera.rotation, '10 20 30');
});

test('preset control teleports to the selected preset and can be destroyed', () => {
  class FakeElement {
    constructor(tagName) {
      this.tagName = tagName;
      this.children = [];
      this.listeners = new Map();
      this.parentNode = null;
      this.style = {};
      this.value = '';
    }

    appendChild(child) {
      child.parentNode = this;
      this.children.push(child);
      return child;
    }

    addEventListener(type, listener) {
      this.listeners.set(type, listener);
    }

    dispatchEvent(event) {
      this.listeners.get(event.type)?.call(this, event);
    }

    remove() {
      this.parentNode.children = this.parentNode.children.filter((child) => child !== this);
    }
  }

  const document = {
    createElement: (tagName) => new FakeElement(tagName),
  };
  document.body = document.createElement('body');
  const camera = fakeCamera();
  const controls = mountTeleportControls({
    presets: [{ id: 'entrance', name: 'Entrance', position: '1 2 3', rotation: '0 90 0' }],
    boundary,
    roomId: 'room-a',
    isAdmin: false,
    camera,
    document,
  });

  const panel = document.body.children[0];
  const select = panel.children[0];
  select.value = 'entrance';
  select.dispatchEvent({ type: 'change' });

  assert.equal(camera.position, '1 2 3');
  assert.equal(select.value, '');

  controls.destroy();
  assert.deepEqual(document.body.children, []);
});
