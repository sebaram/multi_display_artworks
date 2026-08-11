import assert from 'node:assert/strict';
import test from 'node:test';

import { mountAdminTransforms } from '../../app/metamuseum/static/js/room/interaction/admin-transforms.js';

class FakeElement {
  constructor(tagName) {
    this.tagName = tagName;
    this.attributes = new Map();
    this.children = [];
    this.listeners = new Map();
    this.parentNode = null;
    this.style = {};
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

  addEventListener(type, listener) {
    this.listeners.set(type, listener);
  }

  removeEventListener(type) {
    this.listeners.delete(type);
  }

  dispatchEvent(event) {
    this.listeners.get(event.type)?.(event);
  }

  remove() {
    if (!this.parentNode) return;
    this.parentNode.children = this.parentNode.children.filter((child) => child !== this);
  }
}

function descendants(element) {
  return [element, ...element.children.flatMap(descendants)];
}

test('admin transform setup enables draggable elements and owns its controls', () => {
  const body = new FakeElement('body');
  const scene = new FakeElement('a-scene');
  const art = new FakeElement('a-image');
  art.setAttribute('data-element-id', 'art-1');
  art.setAttribute('data-element-type', 'image');
  const document = {
    body,
    createElement: (tagName) => new FakeElement(tagName),
    getElementById(id) {
      return descendants(body).find((element) => element.id === id) ?? null;
    },
    querySelector(selector) {
      if (selector === 'a-scene') return scene;
      if (selector === '[data-element-id]') return art;
      return null;
    },
    querySelectorAll(selector) {
      return selector === '[data-element-id]' ? [art] : [];
    },
  };

  const controls = mountAdminTransforms({
    document,
    navigator: {},
    fetch: () => Promise.reject(new Error('unused')),
    alert() {},
    setTimeout(callback, delay) {
      if (delay <= 1000) callback();
      return delay;
    },
  });

  assert.equal(art.getAttribute('drag-element'), 'elementId: art-1, elementType: image');
  assert.equal(art.getAttribute('class'), 'clickable');
  const indicator = document.getElementById('admin-indicator');
  const panel = document.getElementById('transform-panel');
  assert.ok(indicator);
  assert.ok(panel);
  assert.equal(panel.style.display, 'none');

  indicator.dispatchEvent({ type: 'click' });
  assert.equal(panel.style.display, 'block');

  controls.destroy();
  assert.equal(document.getElementById('admin-indicator'), null);
  assert.equal(document.getElementById('transform-panel'), null);
});
