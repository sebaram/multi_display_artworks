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

test('room modules do not depend on the temporary socket bridge', async () => {
  const files = await listJavaScriptFiles(roomRootPath);

  for (const file of files) {
    const source = await readFile(file, 'utf8');
    assert.doesNotMatch(source, /roomLegacySocketAdapter|\bposSocket(?:Connected)?\b/u, file);
  }
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

test('room entry preserves AR modes and externally loaded voice, expression, effects, and admin adapters', async () => {
  const [template, bootstrap] = await Promise.all([
    readFile(templateUrl, 'utf8'),
    readFile(new URL('bootstrap.js', roomRoot), 'utf8'),
  ]);

  for (const script of [
    'js/marker-ar.js',
    'js/ar-receiver.js',
    'js/voice-chat.js',
    'js/avatar-expression.js',
    'js/room-effects.js',
    'js/llm-layout.js',
  ]) {
    assert.match(template, new RegExp(script.replaceAll('.', '\\.')), script);
  }
  assert.match(bootstrap, /bootstrapData\.isArMarker[\s\S]*bootstrapARMode/u);
  assert.match(bootstrap, /bootstrapData\.isArCompanion[\s\S]*bootstrapARReceiverMode/u);
  assert.match(bootstrap, /addLLMLayoutButton/u);
  assert.match(bootstrap, /addLLMEffectsButton/u);
});

test('classic A-Frame includes expose components but not moved room business logic', async () => {
  const staticRoot = new URL('../../app/metamuseum/static/js/', import.meta.url);
  const [locationFeatures, dragComponent] = await Promise.all([
    readFile(new URL('location-features.js', staticRoot), 'utf8'),
    readFile(new URL('drag-component.js', staticRoot), 'utf8'),
  ]);

  assert.match(locationFeatures, /AFRAME\.registerComponent\('boundary-clamp'/u);
  assert.doesNotMatch(locationFeatures, /function (?:teleportTo|saveCurrentPositionAsPreset|initLocationFeatures)\b/u);
  assert.match(dragComponent, /AFRAME\.registerComponent\('drag-element'/u);
  assert.doesNotMatch(dragComponent, /function (?:initTransformControls|enableARPassthrough)\b/u);
});
