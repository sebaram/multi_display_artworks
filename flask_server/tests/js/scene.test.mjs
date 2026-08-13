import assert from 'node:assert/strict';
import test from 'node:test';

import { createSceneRenderer } from '../../app/metamuseum/static/js/room/rendering/scene.js';

class FakeElement {
  constructor(tagName) {
    this.tagName = tagName;
    this.attributes = new Map();
    this.children = [];
    this.parentNode = null;
  }

  setAttribute(name, value) {
    this.attributes.set(name, value);
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
    if (!selector.startsWith('.')) return null;
    const className = selector.slice(1);
    return this.children.find((child) => (
      String(child.getAttribute('class') ?? '').split(/\s+/u).includes(className)
    )) ?? null;
  }

  remove() {
    if (!this.parentNode) return;
    this.parentNode.children = this.parentNode.children.filter((child) => child !== this);
    this.parentNode = null;
  }
}

function descendants(element) {
  return [element, ...element.children.flatMap(descendants)];
}

function createDocument(scene) {
  return {
    createElement: (tagName) => new FakeElement(tagName),
    getElementById(id) {
      return descendants(scene).find((element) => element.getAttribute('id') === id) ?? null;
    },
  };
}

test('scene renderer reconciles remote presence snapshots without rendering self', () => {
  const scene = new FakeElement('a-scene');
  const localEntity = new FakeElement('a-entity');
  localEntity.setAttribute('id', 'room-art');
  scene.appendChild(localEntity);
  const document = createDocument(scene);
  const avatarProfiles = [];
  const renderer = createSceneRenderer({
    document,
    scene,
    selfId: 'self',
    createAvatarEntity(profile) {
      avatarProfiles.push(profile);
      const avatar = new FakeElement('a-entity');
      avatar.setAttribute('class', 'remote-avatar');
      return avatar;
    },
  });

  renderer.syncRoster([
    { userId: 'self', position: '9 9 9', rotation: '0 0 0' },
    {
      userId: 'other',
      displayName: 'Other Visitor',
      avatarId: 'robot',
      color: '#123456',
      position: '1 2 3',
      rotation: '0 90 0',
      handTracking: true,
      leftHand: { wrist: { position: [0.1, 0.2, 0.3] } },
      rightHand: null,
    },
  ]);

  const remote = document.getElementById('camera-other');
  assert.ok(remote);
  assert.equal(document.getElementById('camera-self'), null);
  assert.deepEqual(avatarProfiles, [{ avatarId: 'robot', color: '#123456' }]);
  assert.equal(remote.querySelector('.display-name').getAttribute('value'), 'Other Visitor');
  assert.ok(document.getElementById('hand-left-other'));

  renderer.syncRoster([{
    userId: 'other',
    displayName: 'Renamed',
    avatarId: 'shiba',
    color: '#ABCDEF',
    position: '4 5 6',
    rotation: '0 180 0',
    handTracking: false,
  }]);

  assert.equal(remote.querySelector('.display-name').getAttribute('value'), 'Renamed');
  assert.deepEqual(avatarProfiles.at(-1), { avatarId: 'shiba', color: '#ABCDEF' });
  assert.equal(document.getElementById('hand-left-other'), null);

  renderer.syncRoster([]);

  assert.equal(document.getElementById('camera-other'), null);
  assert.equal(document.getElementById('room-art'), localEntity);
});

test('applyPoses writes transforms without touching the roster', () => {
  const scene = new FakeElement('a-scene');
  const renderer = createSceneRenderer({
    document: createDocument(scene),
    scene,
    selfId: 'self',
    createAvatarEntity: () => new FakeElement('a-entity'),
  });

  renderer.syncRoster([{ userId: 'other', displayName: 'Other' }]);
  const created = scene.children.length;

  renderer.applyPoses(new Map([['other', {
    position: { x: 1, y: 2, z: 3 },
    rotation: { x: 0, y: 90, z: 0 },
  }]]));

  const camera = scene.children.find((child) => child.getAttribute('id') === 'camera-other');
  assert.equal(scene.children.length, created);
  assert.deepEqual(camera.getAttribute('position'), { x: 1, y: 2, z: 3 });
  assert.deepEqual(camera.getAttribute('rotation'), { x: 0, y: 90, z: 0 });
});

test('applyPoses prefers object3D and converts rotation to radians', () => {
  const scene = new FakeElement('a-scene');
  const renderer = createSceneRenderer({
    document: createDocument(scene),
    scene,
    selfId: 'self',
    createAvatarEntity: () => new FakeElement('a-entity'),
  });

  renderer.syncRoster([{ userId: 'other' }]);
  const camera = scene.children.find((child) => child.getAttribute('id') === 'camera-other');
  const written = { position: null, rotation: null };
  camera.object3D = {
    position: { set: (x, y, z) => { written.position = { x, y, z }; } },
    rotation: { set: (x, y, z) => { written.rotation = { x, y, z }; } },
  };

  renderer.applyPoses(new Map([['other', {
    position: { x: 1, y: 2, z: 3 },
    rotation: { x: 0, y: 180, z: 0 },
  }]]));

  assert.deepEqual(written.position, { x: 1, y: 2, z: 3 });
  assert.equal(Math.round(written.rotation.y * 1000), Math.round(Math.PI * 1000));
  assert.equal(camera.getAttribute('position'), null);
});

test('unchanged hand payloads do not rebuild hand entities', () => {
  const scene = new FakeElement('a-scene');
  const document = createDocument(scene);
  const renderer = createSceneRenderer({
    document, scene, selfId: 'self', createAvatarEntity: () => new FakeElement('a-entity'),
  });

  const user = {
    userId: 'other',
    handTracking: true,
    leftHand: { wrist: { position: [0, 1, 0] } },
  };
  renderer.syncRoster([user]);
  const firstHand = document.getElementById('hand-left-other');

  renderer.syncRoster([{ ...user }]);
  assert.equal(document.getElementById('hand-left-other'), firstHand);

  renderer.syncRoster([{ ...user, leftHand: { wrist: { position: [0, 2, 0] } } }]);
  assert.notEqual(document.getElementById('hand-left-other'), firstHand);
});
