import assert from 'node:assert/strict';
import test from 'node:test';

import {
  bootstrapRoomApplication,
  bootstrapRoomProfile,
  bootstrapRoomRealtime,
  bootstrapRoomWithRecovery,
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

test('expired capability connect error shows an explicit retry control', async () => {
  const document = createDocument();
  let replacementAttempts = 0;
  const controller = bootstrapRoomProfile({
    bootstrapData,
    visitorSession,
    document,
    onNewVisitor: async () => {
      replacementAttempts += 1;
      return visitorSession;
    },
  });
  let socket;
  const realtime = bootstrapRoomRealtime({
    bootstrapData,
    visitorSession,
    ioFactory: () => {
      socket = new (class {
        constructor() {
          this.connected = false;
          this.listeners = new Map();
        }

        on(eventName, handler) { this.listeners.set(eventName, handler); }

        off(eventName, handler) {
          if (this.listeners.get(eventName) === handler) this.listeners.delete(eventName);
        }

        connect() {}

        disconnect() {}
      })();
      return socket;
    },
    profileController: controller,
    socketUrl: 'https://museum.test',
  });

  socket.listeners.get('connect_error')?.(new Error('Invalid visitor capability'));

  assert.match(
    descendants(document.body).map((element) => element.textContent).join(' '),
    /connection expired or was rejected/iu,
  );
  assert.equal(replacementAttempts, 0);
  find(document.body, (element) => element.textContent === 'Retry').dispatchEvent({ type: 'click' });
  await Promise.resolve();
  assert.equal(replacementAttempts, 1);
  realtime.destroy();
});

test('initial capability issuance failure is visible and retries only after a click', async () => {
  const document = createDocument();
  let attempts = 0;
  const started = bootstrapRoomWithRecovery({
    document,
    startRoom: async () => {
      attempts += 1;
      if (attempts === 1) throw new Error('capability endpoint unavailable');
      return { visitorId: 'visitor-after-retry' };
    },
  });

  assert.equal(await started, null);
  assert.equal(attempts, 1);
  assert.match(
    descendants(document.body).map((element) => element.textContent).join(' '),
    /Unable to start the visitor session/iu,
  );

  find(document.body, (element) => element.textContent === 'Retry').dispatchEvent({ type: 'click' });
  await new Promise((resolve) => setImmediate(resolve));

  assert.equal(attempts, 2);
  assert.doesNotMatch(
    descendants(document.body).map((element) => element.textContent).join(' '),
    /Unable to start the visitor session/iu,
  );
});

test('realtime requires a resolved visitor session instead of bootstrap identity fallback', () => {
  assert.throws(() => bootstrapRoomRealtime({
    bootstrapData: {
      ...bootstrapData,
      visitorId: 'legacy-id',
      capability: 'legacy-capability',
    },
    ioFactory: () => {
      throw new Error('must not connect without a visitor session');
    },
    profileController: {
      joinPayload: () => ({ room_id: 'room-a', profile: {} }),
      setSocketClient() {},
    },
  }), TypeError);
});

test('application resolves identity before initialization and replaces it before disconnect and reload', async () => {
  const document = createDocument();
  const order = [];
  let finishResolve;
  let finishReplacement;
  let onNewVisitor;
  const sockets = [];
  const startup = bootstrapRoomApplication({
    resolveVisitorSession: () => new Promise((resolve) => {
      order.push('resolve');
      finishResolve = resolve;
    }),
    replaceVisitorSession: () => new Promise((resolve) => {
      order.push('replace');
      finishReplacement = () => {
        order.push('persisted');
        resolve({
          visitorId: 'tab-b',
          capability: 'signed-b',
          profile: visitorSession.profile,
        });
      };
    }),
    initializeRoom({ visitorSession: resolvedSession, newVisitor }) {
      order.push(`initialize:${resolvedSession.visitorId}`);
      onNewVisitor = newVisitor;
      const profileController = bootstrapRoomProfile({
        bootstrapData,
        visitorSession: resolvedSession,
        document,
      });
      const socket = {
        connected: false,
        listeners: new Map(),
        on(eventName, handler) { this.listeners.set(eventName, handler); },
        off(eventName, handler) {
          if (this.listeners.get(eventName) === handler) this.listeners.delete(eventName);
        },
        connect() { order.push('connect'); },
        disconnect() { order.push('disconnect'); },
      };
      const ioFactory = (url, options) => {
        sockets.push({ url, options });
        return socket;
      };
      order.push('consumers');
      const realtime = bootstrapRoomRealtime({
        bootstrapData,
        visitorSession: resolvedSession,
        ioFactory,
        profileController,
        socketUrl: 'https://museum.test',
      });
      return { profileController, realtime };
    },
    reload() {
      order.push('reload');
    },
  });

  assert.deepEqual(order, ['resolve']);
  finishResolve(visitorSession);
  const application = await startup;

  assert.deepEqual(order, ['resolve', 'initialize:tab-a', 'consumers', 'connect']);
  assert.deepEqual(sockets[0].options.auth, { visitorCapability: 'signed' });

  const replacement = onNewVisitor();
  assert.deepEqual(order, ['resolve', 'initialize:tab-a', 'consumers', 'connect', 'replace']);
  finishReplacement();
  await replacement;
  assert.deepEqual(order, [
    'resolve',
    'initialize:tab-a',
    'consumers',
    'connect',
    'replace',
    'persisted',
    'disconnect',
    'reload',
  ]);
  assert.equal(application.visitorSession.visitorId, 'tab-a');
});
