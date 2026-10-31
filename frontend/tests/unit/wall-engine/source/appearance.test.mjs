import test from 'node:test';
import assert from 'node:assert/strict';
import {sanitize} from '../../../../src/wall-engine/reference/state.js';
import {encodeLook,decodeLook} from '../../../../src/wall-engine/reference/look-url.js';
import * as stateTools from '../../../../src/wall-engine/reference/state.js';

test('scene appearance has safe defaults and independent per-preset adjustments',()=>{
 assert.equal(typeof stateTools.appearanceFor,'function');assert.equal(typeof stateTools.patchAppearance,'function');
 const initial=sanitize({variant:5});assert.equal(stateTools.appearanceFor(initial).mode,'preset');assert.equal(stateTools.appearanceFor(initial).lighting,1);
 const next=stateTools.patchAppearance(initial,{mode:'solid',backgroundColor:'#124578',glowColor:'#f0f',glow:.7,lighting:1.4,floor:.2});
 assert.equal(next.variant,5);assert.equal(stateTools.appearanceFor(next).backgroundColor,'#124578');assert.equal(stateTools.appearanceFor(next).glowColor,'#ff00ff');assert.equal(stateTools.appearanceFor({...next,variant:1}).mode,'preset');assert.deepEqual(initial.appearance,{});
 assert.deepEqual(decodeLook(encodeLook(next)).appearance,next.appearance);
});

test('appearance rejects invalid colors and bounds lighting, glow and floor settings',()=>{
 const state=sanitize({variant:5,appearance:{5:{mode:'injected',backgroundColor:'url(evil)',glowColor:'#fff',glow:900,lighting:-1,floor:100,unknown:'x'},12:{mode:'solid'}}});
 const a=stateTools.appearanceFor(state);assert.equal(a.mode,'preset');assert.equal(a.glowColor,'#ffffff');assert.equal(a.glow,2);assert.equal(a.lighting,0);assert.equal(a.floor,1);assert.equal(state.appearance[12],undefined);assert.equal(state.appearance[5].unknown,undefined);assert.notEqual(a.backgroundColor,'url(evil)');
 assert.equal(stateTools.appearanceFor(sanitize({appearance:null})).lighting,1);
});
