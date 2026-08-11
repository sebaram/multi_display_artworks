import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const templateUrl = new URL('../../app/metamuseum/templates/room_aframe.html', import.meta.url);
const bootstrapUrl = new URL('../../app/metamuseum/static/js/room/bootstrap.js', import.meta.url);
const sceneUrl = new URL('../../app/metamuseum/static/js/room/rendering/scene.js', import.meta.url);
const handTrackingUrl = new URL('../../app/metamuseum/static/js/room/interaction/hand-tracking.js', import.meta.url);
const teleportUrl = new URL('../../app/metamuseum/static/js/room/interaction/teleport.js', import.meta.url);

test('room template boots the session-bound profile module without query identity', async () => {
  const template = await readFile(templateUrl, 'utf8');

  assert.match(template, /<script id="room-bootstrap" type="application\/json">/);
  assert.match(template, /visitor_id\s*\|\s*tojson/);
  assert.match(template, /avatar_catalog\s*\|\s*tojson/);
  assert.match(template, /filename='js\/room\/bootstrap\.js'/);
  assert.equal(template.match(/type="module"/g)?.length, 1);
  assert.doesNotMatch(template, /Math\.random\(\)/);
  assert.doesNotMatch(template, /const avatarType/);
});

test('room socket uses the profile controller contract', async () => {
  const [template, scene, handTracking] = await Promise.all([
    readFile(templateUrl, 'utf8'),
    readFile(sceneUrl, 'utf8'),
    readFile(handTrackingUrl, 'utf8'),
  ]);
  const positionPayload = handTracking.match(/socketClient\.emit\('position_update',\s*\{([\s\S]*?)\}\);/u)?.[1];

  assert.ok(positionPayload, 'position_update payload should exist');
  assert.doesNotMatch(positionPayload, /userId|avatar|profile/);
  assert.match(scene, /user\.avatarId/);
  assert.match(scene, /user\.color/);
  assert.doesNotMatch(template, /roomLegacySocketAdapter/);
  assert.doesNotMatch(template, /\bposSocket(?:Connected)?\b/u);
  assert.doesNotMatch(template, /initGuestName\(/);
});

test('room bootstrap owns map and mobile guidance while named preset teleport remains', async () => {
  const [template, bootstrap, teleport] = await Promise.all([
    readFile(templateUrl, 'utf8'),
    readFile(bootstrapUrl, 'utf8'),
    readFile(teleportUrl, 'utf8'),
  ]);

  assert.match(template, /"presets":\s*{{\s*presets\s*\|\s*tojson\s*}}/);
  assert.match(template, /"boundary":\s*{{\s*boundary\s*\|\s*tojson\s*}}/);
  assert.match(template, /"wallList":\s*{{\s*wall_list\s*\|\s*tojson\s*}}/);
  assert.match(bootstrap, /mountMinimap\(/);
  assert.match(bootstrap, /mountMobileGuidance\(/);
  assert.match(bootstrap, /mountTeleportControls\(/);
  assert.match(teleport, /id = 'preset-select'/);
  assert.match(teleport, /teleport\(camera, selected, boundary\)/);
});
