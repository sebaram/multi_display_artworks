import assert from 'node:assert/strict';
import test from 'node:test';

import {
  bootstrapRoomProfile,
  bootstrapRoomRealtime,
} from '../../app/metamuseum/static/js/room/bootstrap.js';

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
    if (event.type === 'click' && this.tagName === 'button' && this.attributes.type === 'submit') {
      let ancestor = this.parentNode;
      while (ancestor && ancestor.tagName !== 'form') ancestor = ancestor.parentNode;
      ancestor?.dispatchEvent({ type: 'submit' });
    }
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

function descendants(root) {
  return [root, ...root.children.flatMap(descendants)];
}

function find(root, predicate) {
  return descendants(root).find(predicate);
}

const bootstrapData = {
  roomId: 'room-a',
  avatarCatalog: ['none', 'rigged-simple', 'robot', 'shiba'],
};

const visitorSession = {
  visitorId: 'tab-a',
  capability: 'signed',
  profile: {
    displayName: 'Random Visitor',
    avatarId: 'robot',
    color: '#123456',
  },
};

test('resolved visitor profile stays opt-in and join payload has only room and profile', () => {
  const document = createDocument();
  const controller = bootstrapRoomProfile({
    bootstrapData,
    visitorSession,
    document,
  });

  assert.equal(find(document.body, (element) => element.textContent === 'Visitor')?.tagName, 'button');
  assert.equal(find(document.body, (element) => element.tagName === 'dialog'), undefined);
  assert.deepEqual(controller.joinPayload(), {
    room_id: 'room-a',
    profile: {
      displayName: 'Random Visitor',
      avatarId: 'robot',
      color: '#123456',
    },
  });
});

test('Save updates the visitor record and emits only when connected', () => {
  const document = createDocument();
  const activeSession = structuredClone(visitorSession);
  const savedSessions = [];
  const emitted = [];
  const socketClient = {
    connected: false,
    emit(eventName, payload) {
      if (!this.connected) return false;
      emitted.push([eventName, payload]);
      return true;
    },
  };
  const controller = bootstrapRoomProfile({
    bootstrapData,
    visitorSession: activeSession,
    document,
    persistVisitorSession(session) {
      savedSessions.push(structuredClone(session));
    },
  });
  controller.setSocketClient(socketClient);

  find(document.body, (element) => element.textContent === 'Visitor').dispatchEvent({ type: 'click' });
  find(document.body, (element) => element.textContent === 'Edit').dispatchEvent({ type: 'click' });
  find(document.body, (element) => element.attributes.id === 'profile-display-name').value = 'Updated Visitor';
  find(document.body, (element) => element.attributes.id === 'profile-avatar').value = 'rigged-simple';
  find(document.body, (element) => element.attributes.id === 'profile-color').value = '#abcdef';
  find(document.body, (element) => element.textContent === 'Save').dispatchEvent({ type: 'click' });

  assert.deepEqual(emitted, []);
  assert.equal(savedSessions[0].profile.displayName, 'Updated Visitor');
  assert.deepEqual(controller.joinPayload(), {
    room_id: 'room-a',
    profile: {
      displayName: 'Updated Visitor',
      avatarId: 'rigged-simple',
      color: '#ABCDEF',
    },
  });

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

test('realtime connects with the signed tab capability', () => {
  class FakeSocket {
    constructor() {
      this.connected = false;
      this.listeners = new Map();
    }

    on(eventName, handler) {
      this.listeners.set(eventName, handler);
    }

    off(eventName, handler) {
      if (this.listeners.get(eventName) === handler) this.listeners.delete(eventName);
    }

    connect() {}

    disconnect() {}
  }

  const calls = [];
  const ioFactory = (url, options) => {
    calls.push({ url, options });
    return new FakeSocket();
  };
  const realtime = bootstrapRoomRealtime({
    bootstrapData,
    visitorSession,
    ioFactory,
    socketUrl: 'https://museum.test',
    profileController: {
      joinPayload: () => ({ room_id: 'room-a', profile: visitorSession.profile }),
      setSocketClient() {},
    },
  });

  assert.deepEqual(calls[0].options.auth, { visitorCapability: 'signed' });
  realtime.destroy();
});
