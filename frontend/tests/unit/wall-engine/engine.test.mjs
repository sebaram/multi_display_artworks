import test from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
const root = new URL('../../../', import.meta.url);
const moduleUrl = path => new URL(`src/wall-engine/${path}`, root);
test('wall engine normalizes source states, keeps stable edits and uploaded assets', async () => {
  assert.ok(existsSync(moduleUrl('config.js')), 'managed source config adapter exists');
  const { normalizeWallLook, SOURCE_COMMIT } = await import(moduleUrl('config.js'));
  const look = normalizeWallLook({ variant: 5, screens: [{id:'front',width:1920,height:1080}], authored:{5:{edits:{'preset-logo-front-part-1':{x:42}},objects:[]}},videoLayers:[{id:'v',assetId:'asset-1'}] });
  assert.equal(look.source_commit, SOURCE_COMMIT);
  assert.equal(look.state.authored[5].edits['preset-logo-front-part-1'].x,42);
  assert.equal(look.state.videoLayers[0].assetId,'asset-1');
  assert.throws(() => normalizeWallLook({...look,logical_screen:'missing'}), /screen/i);
  assert.throws(() => normalizeWallLook({...look,schema_version:2}), /version/i);
});
test('test_uv_pointer_orientation', async () => {
  assert.ok(existsSync(moduleUrl('motion.js')), 'managed absolute-time motion adapter exists');
  const { pointerFromUV } = await import(moduleUrl('motion.js'));
  assert.deepEqual(pointerFromUV({u:0,v:1}),{x:-.5,y:-.5});
  assert.deepEqual(pointerFromUV({u:1,v:0}),{x:.5,y:.5});
  assert.throws(()=>pointerFromUV({u:NaN,v:0}), /UV/);
});
test('test_same_seed_and_time_give_same_motion', async () => {
  assert.ok(existsSync(moduleUrl('motion.js')), 'managed absolute-time motion adapter exists');
  const { seededUnit, mediaTarget } = await import(moduleUrl('motion.js'));
  assert.equal(seededUnit(42),seededUnit(42));
  assert.notEqual(seededUnit(42),seededUnit(43));
  assert.equal(mediaTarget(12,{motionSpeed:2,motionAnchor:2,motionOffset:1},10),1);
});
test('all 44 actual source configs are bundled with pinned provenance', () => {
  const path = new URL('public/wall-presets/manifest.json',root);
  assert.ok(existsSync(path),'source catalog manifest exists');
  const manifest = JSON.parse(readFileSync(path,'utf8'));
  assert.equal(manifest.presets.length,44);
  assert.equal(new Set(manifest.presets.map(p=>p.source_key)).size,44);
  for(const entry of manifest.presets) {
    const preset = JSON.parse(readFileSync(new URL(`public/wall-presets/${entry.file}`,root),'utf8'));
    assert.equal(preset.config.source_commit,'b247fd238fe6cb2c8c860c77d13488b28b8a0290');
    assert.ok(Number.isInteger(preset.config.state.variant));
  }
});
