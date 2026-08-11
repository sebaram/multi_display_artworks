import assert from 'node:assert/strict';
import test from 'node:test';

import {
  buildShareRoomUrl,
  mountShare,
} from '../../app/metamuseum/static/js/room/ui/share.js';

test('shared room URL uses the injected room ID and omits page query parameters', () => {
  assert.equal(
    buildShareRoomUrl({
      protocol: 'https:',
      host: 'example.test',
      search: '?room_id=abc&avatar=robot',
    }, 'abc'),
    'https://example.test/room?room_id=abc',
  );
});

test('share button generates a QR for the injected room and removes its UI on destroy', () => {
  class FakeElement {
    constructor(tagName) {
      this.tagName = tagName;
      this.children = [];
      this.listeners = new Map();
      this.parentNode = null;
      this.style = {};
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
      event.target ??= this;
      this.listeners.get(event.type)?.call(this, event);
    }

    remove() {
      if (!this.parentNode) return;
      this.parentNode.children = this.parentNode.children.filter((child) => child !== this);
    }
  }

  const document = {
    createElement: (tagName) => new FakeElement(tagName),
  };
  document.body = document.createElement('body');
  const qrData = [];
  const share = mountShare({
    document,
    location: { protocol: 'https:', host: 'example.test', search: '' },
    roomId: 'room-a',
    navigator: {},
    qrcode() {
      return {
        addData(value) { qrData.push(value); },
        make() {},
        createImgTag() { return '<img alt="QR">'; },
      };
    },
    setTimeout() {},
  });

  document.body.children[0].dispatchEvent({ type: 'click' });
  assert.deepEqual(qrData, ['https://example.test/room?room_id=room-a']);
  assert.equal(document.body.children.length, 2);

  share.destroy();
  assert.deepEqual(document.body.children, []);
});
