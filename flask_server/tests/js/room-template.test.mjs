import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const templateUrl = new URL('../../app/metamuseum/templates/room_aframe.html', import.meta.url);

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
  const template = await readFile(templateUrl, 'utf8');
  const positionPayload = template.match(/posSocket\.emit\('position_update',\s*\{([\s\S]*?)\}\);/u)?.[1];

  assert.match(template, /roomProfileController\.joinPayload\(\)/);
  assert.ok(positionPayload, 'position_update payload should exist');
  assert.doesNotMatch(positionPayload, /userId|avatar|profile/);
  assert.match(template, /userData\.avatarId/);
  assert.match(template, /userData\.color/);
  assert.match(template, /posSocket\.on\('profile_updated'/);
  assert.doesNotMatch(template, /initGuestName\(/);
});
