import assert from 'node:assert/strict';
import test from 'node:test';

import { AVATAR_CATALOG } from '../../app/metamuseum/static/js/room/avatar-catalog.js';
import { mountProfilePanel } from '../../app/metamuseum/static/js/room/profile-panel.js';

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
    return !event.defaultPrevented;
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
    this.parentNode = null;
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

function findByText(root, text) {
  return find(root, (element) => element.textContent === text);
}

function click(element) {
  element.focus();
  element.dispatchEvent({ type: 'click' });
}

const initialProfile = {
  displayName: 'Visitor One',
  avatarId: 'robot',
  color: '#123456',
};

test('visitor controls are closed by default and reveal editing only after Edit', () => {
  const document = createDocument();
  mountProfilePanel({
    profile: initialProfile,
    catalog: AVATAR_CATALOG,
    onSave: (profile) => profile,
    onNewVisitor() {},
    document,
  });

  const visitorButton = findByText(document.body, 'Visitor');
  assert.equal(visitorButton?.tagName, 'button');
  assert.equal(find(document.body, (element) => element.attributes.id === 'profile-display-name'), undefined);

  click(visitorButton);
  const editButton = findByText(document.body, 'Edit');
  assert.equal(editButton?.tagName, 'button');
  assert.equal(findByText(document.body, 'New visitor')?.tagName, 'button');
  assert.match(descendants(document.body).map((element) => element.textContent).join(' '), /Visitor One/);
  assert.equal(find(document.body, (element) => element.attributes.id === 'profile-display-name'), undefined);

  click(editButton);
  const dialog = find(document.body, (element) => element.tagName === 'dialog');
  assert.equal(dialog.attributes['aria-labelledby'], 'profile-dialog-title');
  assert.equal(dialog.open, true);
  assert.equal(document.activeElement.attributes.id, 'profile-display-name');
});

test('Escape closes the dialog and returns focus to Edit', () => {
  const document = createDocument();
  const panel = mountProfilePanel({
    profile: initialProfile,
    catalog: AVATAR_CATALOG,
    onSave: (profile) => profile,
    onNewVisitor() {},
    document,
  });
  click(findByText(document.body, 'Visitor'));
  const editButton = findByText(document.body, 'Edit');

  editButton.focus();
  click(editButton);
  const dialog = find(document.body, (element) => element.tagName === 'dialog');
  dialog.dispatchEvent({ type: 'keydown', key: 'Escape' });

  assert.equal(dialog.open, false);
  assert.equal(document.activeElement, editButton);
});

test('Save publishes the draft, updates the visible profile, and restores focus', () => {
  const document = createDocument();
  const savedProfiles = [];
  mountProfilePanel({
    profile: initialProfile,
    catalog: AVATAR_CATALOG,
    onSave(profile) {
      savedProfiles.push(profile);
      return profile;
    },
    onNewVisitor() {},
    document,
  });
  click(findByText(document.body, 'Visitor'));
  const editButton = findByText(document.body, 'Edit');
  click(editButton);

  find(document.body, (element) => element.attributes.id === 'profile-display-name').value = 'New Visitor';
  find(document.body, (element) => element.attributes.id === 'profile-avatar').value = 'shiba';
  find(document.body, (element) => element.attributes.id === 'profile-color').value = '#abcdef';
  click(find(document.body, (element) => element.textContent === 'Save'));

  assert.deepEqual(savedProfiles, [{
    displayName: 'New Visitor',
    avatarId: 'shiba',
    color: '#abcdef',
  }]);
  assert.match(descendants(document.body).map((element) => element.textContent).join(' '), /New Visitor/);
  assert.equal(document.activeElement, editButton);
});

test('Cancel discards edits and destroy removes panel and dialog', () => {
  const document = createDocument();
  const savedProfiles = [];
  const panel = mountProfilePanel({
    profile: initialProfile,
    catalog: AVATAR_CATALOG,
    onSave: (profile) => savedProfiles.push(profile),
    onNewVisitor() {},
    document,
  });
  click(findByText(document.body, 'Visitor'));
  click(findByText(document.body, 'Edit'));
  find(document.body, (element) => element.attributes.id === 'profile-display-name').value = 'Discard Me';
  click(find(document.body, (element) => element.textContent === 'Cancel'));

  assert.deepEqual(savedProfiles, []);
  assert.match(descendants(document.body).map((element) => element.textContent).join(' '), /Visitor One/);

  panel.destroy();
  assert.equal(document.body.children.length, 0);
});

test('Save keeps the dialog open when native profile constraints fail', () => {
  const document = createDocument();
  const savedProfiles = [];
  mountProfilePanel({
    profile: initialProfile,
    catalog: AVATAR_CATALOG,
    onSave: (profile) => savedProfiles.push(profile),
    onNewVisitor() {},
    document,
  });
  click(findByText(document.body, 'Visitor'));
  click(findByText(document.body, 'Edit'));
  const dialog = find(document.body, (element) => element.tagName === 'dialog');
  const form = find(document.body, (element) => element.tagName === 'form');
  form.reportValidity = () => false;

  click(find(document.body, (element) => element.textContent === 'Save'));

  assert.deepEqual(savedProfiles, []);
  assert.equal(dialog.open, true);
});

test('New visitor waits for its callback and updateProfile refreshes the summary', async () => {
  const document = createDocument();
  let finishReplacement;
  const calls = [];
  const panel = mountProfilePanel({
    profile: initialProfile,
    catalog: AVATAR_CATALOG,
    onSave: (profile) => profile,
    onNewVisitor: () => new Promise((resolve) => {
      calls.push('replace');
      finishReplacement = resolve;
    }),
    document,
  });

  panel.open();
  click(findByText(document.body, 'New visitor'));
  assert.deepEqual(calls, ['replace']);
  assert.equal(findByText(document.body, 'New visitor').disabled, true);

  panel.updateProfile({
    displayName: 'Visitor Two',
    avatarId: 'shiba',
    color: '#ABCDEF',
  });
  assert.match(descendants(document.body).map((element) => element.textContent).join(' '), /Visitor Two/);

  finishReplacement();
  await Promise.resolve();
  assert.equal(findByText(document.body, 'New visitor').disabled, false);
});
