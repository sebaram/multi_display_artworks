import assert from 'node:assert/strict';
import test from 'node:test';

import { AVATAR_CATALOG } from '../../app/metamuseum/static/js/room/avatar-catalog.js';
import { createAvatarEntity } from '../../app/metamuseum/static/js/room/avatar-renderer.js';

class FakeElement {
  constructor(tagName) {
    this.tagName = tagName;
    this.attributes = {};
    this.children = [];
  }

  setAttribute(name, value) {
    this.attributes[name] = value;
  }

  appendChild(child) {
    this.children.push(child);
    return child;
  }
}

const fakeDocument = {
  createElement: (tagName) => new FakeElement(tagName),
};

test('robot renderer applies the selected normalized color', () => {
  const entity = createAvatarEntity({ avatarId: 'robot', color: '#123456' }, fakeDocument);

  assert.equal(entity.children[0].attributes.color, '#123456');
  assert.equal(entity.children[1].attributes.color, '#123456');
});

test('GLB renderer uses only the catalog asset and adds a color accent', () => {
  const entity = createAvatarEntity({
    avatarId: 'rigged-simple',
    color: '#ABCDEF',
    assetUrl: 'https://attacker.invalid/avatar.glb',
  }, fakeDocument);

  assert.equal(entity.attributes['gltf-model'], AVATAR_CATALOG['rigged-simple'].assetUrl);
  assert.equal(entity.children[0].attributes.color, '#ABCDEF');
});

test('unknown catalog id falls back to the shiba model', () => {
  const entity = createAvatarEntity({ avatarId: 'bad', color: '#123456' }, fakeDocument);

  assert.equal(entity.attributes['gltf-model'], AVATAR_CATALOG.shiba.assetUrl);
});

test('none renders no avatar entity', () => {
  assert.equal(createAvatarEntity({ avatarId: 'none', color: '#123456' }, fakeDocument), null);
});
