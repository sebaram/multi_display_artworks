import assert from 'node:assert/strict';
import { readFile, readdir } from 'node:fs/promises';
import { join } from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

const roomRoot = new URL('../../app/metamuseum/static/js/room/', import.meta.url);
const roomRootPath = fileURLToPath(roomRoot);
const templateUrl = new URL('../../app/metamuseum/templates/room_aframe.html', import.meta.url);

async function listJavaScriptFiles(directory) {
  const entries = await readdir(directory, { withFileTypes: true });
  const nested = await Promise.all(entries.map((entry) => (
    entry.isDirectory()
      ? listJavaScriptFiles(join(directory, entry.name))
      : entry.name.endsWith('.js') ? [join(directory, entry.name)] : []
  )));
  return nested.flat();
}

test('room template is declarative and has one application entry module', async () => {
  const template = await readFile(templateUrl, 'utf8');
  const executableInlineScripts = [...template.matchAll(/<script(?![^>]*\bsrc=)([^>]*)>([\s\S]*?)<\/script>/giu)]
    .filter((match) => !/type="application\/json"/iu.test(match[1]));

  assert.deepEqual(executableInlineScripts, []);
  assert.equal(template.match(/type="module"/gu)?.length, 1);
  assert.match(template, /filename='js\/room\/bootstrap\.js'/u);
  assert.doesNotMatch(template, /roomLegacySocketAdapter|\bposSocket\b/u);
  assert.doesNotMatch(template, /filename='js\/share-qr\.js'/u);
});

test('room modules do not depend on legacy socket state, query-derived room IDs, or first-party window globals', async () => {
  const files = await listJavaScriptFiles(roomRootPath);
  const supportedWindowGlobals = new Set([
    'AFRAME',
    'addEventListener',
    'alert',
    'cancelAnimationFrame',
    'clearInterval',
    'clearTimeout',
    'console',
    'document',
    'io',
    'localStorage',
    'matchMedia',
    'navigator',
    'prompt',
    'qrcode',
    'requestAnimationFrame',
    'setInterval',
    'setTimeout',
    'window',
  ]);

  for (const file of files) {
    const source = await readFile(file, 'utf8');
    const allowedWindowGlobals = new Set(supportedWindowGlobals);
    if (file === join(roomRootPath, 'bootstrap.js')) {
      ['sessionStorage', 'fetch', 'history', 'location'].forEach((name) => {
        allowedWindowGlobals.add(name);
      });
    }
    assert.doesNotMatch(source, /roomLegacySocketAdapter|\bposSocket(?:Connected)?\b/u, file);
    assert.doesNotMatch(source, /\b(?:URLSearchParams|searchParams)\b/u, file);

    for (const match of source.matchAll(/\b(?:window|globalThis)\.([A-Za-z_$][\w$]*)/gu)) {
      assert.ok(allowedWindowGlobals.has(match[1]), `${file} reads first-party global ${match[1]}`);
    }
  }
});

test('room client no longer ships the unloaded guest-name socket bridge', async () => {
  const staticRoot = new URL('../../app/metamuseum/static/js/', import.meta.url);

  await assert.rejects(readFile(new URL('guest-name.js', staticRoot), 'utf8'), { code: 'ENOENT' });
  await assert.rejects(readFile(new URL('share-qr.js', staticRoot), 'utf8'), { code: 'ENOENT' });
});

test('room bootstrap composes rendering, teleport, admin transforms, hand tracking, and share modules', async () => {
  const bootstrap = await readFile(new URL('bootstrap.js', roomRoot), 'utf8');

  for (const modulePath of [
    './rendering/scene.js',
    './interaction/teleport.js',
    './interaction/admin-transforms.js',
    './interaction/hand-tracking.js',
    './ui/share.js',
  ]) {
    assert.match(bootstrap, new RegExp(`from ['"]${modulePath.replaceAll('.', '\\.')}`), modulePath);
  }
});

test('room entry imports first-party adapters instead of loading or reading classic-script globals', async () => {
  const [template, bootstrap] = await Promise.all([
    readFile(templateUrl, 'utf8'),
    readFile(new URL('bootstrap.js', roomRoot), 'utf8'),
  ]);

  for (const modulePath of [
    '../drag-component.js',
    '../location-features.js',
    'js/marker-ar.js',
    'js/ar-receiver.js',
    'js/voice-chat.js',
    'js/avatar-expression.js',
    'js/room-effects.js',
    'js/llm-layout.js',
  ]) {
    const importPath = modulePath.startsWith('../') ? modulePath : `../${modulePath.slice(3)}`;
    assert.match(bootstrap, new RegExp(`from ['"]${importPath.replaceAll('.', '\\.')}`), importPath);
  }

  const firstPartyScripts = [...template.matchAll(
    /<script[^>]+src="\{\{\s*url_for\('static',\s*filename='([^']+)'\)\s*\}\}"[^>]*>/giu,
  )].map((match) => match[1]);
  assert.deepEqual(firstPartyScripts, ['js/room/bootstrap.js']);
  assert.doesNotMatch(
    bootstrap,
    /window\.(?:initVoiceChat|VoiceChat|RoomEffects|AvatarExpressions|addLLMLayoutButton|addLLMEffectsButton|bootstrapARMode|bootstrapARReceiverMode)\b/u,
  );
});

test('classic A-Frame includes expose components but not moved room business logic', async () => {
  const staticRoot = new URL('../../app/metamuseum/static/js/', import.meta.url);
  const [locationFeatures, dragComponent] = await Promise.all([
    readFile(new URL('location-features.js', staticRoot), 'utf8'),
    readFile(new URL('drag-component.js', staticRoot), 'utf8'),
  ]);

  assert.match(locationFeatures, /registerLocationComponents/u);
  assert.doesNotMatch(locationFeatures, /function (?:teleportTo|saveCurrentPositionAsPreset|initLocationFeatures)\b/u);
  assert.match(dragComponent, /registerDragComponent/u);
  assert.doesNotMatch(dragComponent, /function (?:initTransformControls|enableARPassthrough)\b/u);
});

test('other A-Frame templates load the converted drag component as an ES module', async () => {
  for (const templateName of ['wall_aframe.html', 'element_aframe.html']) {
    const template = await readFile(
      new URL(`../../app/metamuseum/templates/${templateName}`, import.meta.url),
      'utf8',
    );
    assert.match(
      template,
      /<script type="module" src="\{\{\s*url_for\('static',\s*filename='js\/drag-component\.js'\)\s*\}\}"><\/script>/u,
      templateName,
    );
  }
});
