import assert from 'node:assert/strict';
import test from 'node:test';

import { bootstrapRoomProfile } from '../../app/metamuseum/static/js/room/bootstrap.js';

class FakeElement {
  constructor(tagName, ownerDocument) {
    this.tagName = tagName;
    this.ownerDocument = ownerDocument;
    this.attributes = {};
    this.children = [];
    this.listeners = new Map();
    this.parentNode = null;
    this.textContent = '';
    this.value = '';
    this.open = false;
  }

  setAttribute(name, value) {
    this.attributes[name] = String(value);
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

  dispatchEvent(event) {
    event.target ??= this;
    event.currentTarget = this;
    event.preventDefault ??= () => { event.defaultPrevented = true; };
    for (const listener of this.listeners.get(event.type) ?? []) listener(event);
  }

  focus() {
    this.ownerDocument.activeElement = this;
  }

  showModal() {
    this.open = true;
  }

  close() {
    this.open = false;
  }

  remove() {
    if (!this.parentNode) return;
    this.parentNode.children = this.parentNode.children.filter((child) => child !== this);
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
  document.activeElement = document.body;
  return document;
}

function createStorage(initial = {}) {
  const values = new Map(Object.entries(initial));
  return {
    getItem: (key) => values.get(key) ?? null,
    setItem: (key, value) => values.set(key, value),
    values,
  };
}

function descendants(root) {
  return [root, ...root.children.flatMap(descendants)];
}

function find(root, predicate) {
  return descendants(root).find(predicate);
}

const bootstrapData = {
  visitorId: 'signed-visitor-id',
  roomId: 'room-a',
  avatarCatalog: ['none', 'rigged-simple', 'robot', 'shiba'],
};

test('first entry opens the profile dialog and join payload has only room and profile', () => {
  const document = createDocument();
  const controller = bootstrapRoomProfile({
    bootstrapData,
    document,
    storage: createStorage(),
  });

  assert.equal(find(document.body, (element) => element.tagName === 'dialog').open, true);
  assert.deepEqual(controller.joinPayload(), {
    room_id: 'room-a',
    profile: {
      displayName: 'Visitor',
      avatarId: 'shiba',
      color: '#4CAF50',
    },
  });

  const dialog = find(document.body, (element) => element.tagName === 'dialog');
  const editButton = find(document.body, (element) => element.textContent === 'Edit');
  dialog.dispatchEvent({ type: 'keydown', key: 'Escape' });
  assert.equal(document.activeElement, editButton);
});

test('saved profile stays closed on entry and Save emits only when connected', () => {
  const document = createDocument();
  const storageKey = 'metamuseum.profile.signed-visitor-id';
  const storage = createStorage({
    [storageKey]: JSON.stringify({
      displayName: 'Stored Visitor',
      avatarId: 'robot',
      color: '#123456',
    }),
  });
  const emitted = [];
  const socketClient = {
    connected: false,
    emit(eventName, payload) {
      if (!this.connected) return false;
      emitted.push([eventName, payload]);
      return true;
    },
  };
  const controller = bootstrapRoomProfile({ bootstrapData, document, storage });
  controller.setSocketClient(socketClient);
  const dialog = find(document.body, (element) => element.tagName === 'dialog');

  assert.equal(dialog.open, false);
  find(document.body, (element) => element.textContent === 'Edit').dispatchEvent({ type: 'click' });
  find(document.body, (element) => element.attributes.id === 'profile-display-name').value = 'Updated Visitor';
  find(document.body, (element) => element.attributes.id === 'profile-avatar').value = 'rigged-simple';
  find(document.body, (element) => element.attributes.id === 'profile-color').value = '#abcdef';
  find(document.body, (element) => element.textContent === 'Save').dispatchEvent({ type: 'click' });

  assert.deepEqual(emitted, []);
  assert.equal(JSON.parse(storage.values.get(storageKey)).displayName, 'Updated Visitor');

  socketClient.connected = true;
  find(document.body, (element) => element.textContent === 'Edit').dispatchEvent({ type: 'click' });
  find(document.body, (element) => element.attributes.id === 'profile-display-name').value = 'Online Visitor';
  find(document.body, (element) => element.textContent === 'Save').dispatchEvent({ type: 'click' });

  assert.deepEqual(emitted, [[
    'profile_update',
    {
      room_id: 'room-a',
      profile: {
        displayName: 'Online Visitor',
        avatarId: 'rigged-simple',
        color: '#ABCDEF',
      },
    },
  ]]);
});
