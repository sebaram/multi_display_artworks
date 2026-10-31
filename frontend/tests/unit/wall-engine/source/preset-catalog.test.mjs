import test from 'node:test';
import assert from 'node:assert/strict';
import {variants,sanitize,createScreen,freshPresetDraft} from '../../../../src/wall-engine/reference/state.js';
import {addElement,patchElement} from '../../../../src/wall-engine/reference/authoring.js';
import {patchAppearance} from '../../../../src/wall-engine/reference/appearance.js';
import {encodeLook,decodeLook} from '../../../../src/wall-engine/reference/look-url.js';
import {kineticPresets} from '../../../../src/wall-engine/reference/preset-catalog.js';

test('built-in definitions are immutable and reselecting a preset always creates fresh artwork',()=>{
 const initial=sanitize({variant:8,brightness:55,branding:false,screens:[{id:'front',name:'Main',width:3840,height:2160},{id:'left',name:'Tiles',width:3840,height:2160}],videoLayers:[{id:'video-1',videoId:'clip'}],showVideo:true});
 let edited=patchElement(initial,'preset-main',{size:2,visible:false});edited=addElement(edited,'text',{textHtml:'<p>Draft only</p>'});edited=patchAppearance(edited,{mode:'solid',backgroundColor:'#ff0000'});
 edited.authored[9]={edits:{'preset-main':{x:30}},objects:[]};
 const before=structuredClone(edited),fresh=freshPresetDraft(edited,8,1000);
 assert.deepEqual(edited,before);assert.deepEqual(fresh.authored,{});assert.deepEqual(fresh.appearance,{});assert.equal(fresh.variant,8);assert.equal(fresh.activeElement,null);assert.equal(fresh.editElements,false);
 assert.deepEqual(fresh.screens,initial.screens);assert.deepEqual(fresh.videoLayers,initial.videoLayers);assert.equal(fresh.brightness,55);
 assert.equal(Object.isFrozen(variants),true);assert.ok(variants.every(Object.isFrozen));assert.equal(Object.isFrozen(kineticPresets),true);
 assert.throws(()=>{variants[8].name='Overwritten';},TypeError);assert.equal(variants[8].name,'Co-presence');
 assert.throws(()=>freshPresetDraft(initial,99),RangeError);
});

test('the four kinetic graphics are independent presets with portable authoring and appearance',()=>{
 assert.deepEqual(variants.slice(8).map(v=>v.name),['Co-presence','Shared coordinates','Mutual response','Co-creation']);
 let state=createScreen(sanitize({variant:8}));
 for(const variant of [8,9,10,11]){
  state=sanitize({...state,variant});state=addElement(state,'sphere');state=patchElement(state,'preset-main',{motionSpeed:.7,x:83});state=patchAppearance(state,{lighting:.8});
 }
 const restored=decodeLook(encodeLook(state));
 assert.equal(restored.variant,11);assert.equal(restored.screens.length,3);
 for(const variant of [8,9,10,11]){
  assert.equal(restored.authored[variant].objects[0].type,'sphere');
  assert.equal(restored.authored[variant].edits['preset-main'].motionSpeed,.7);
  assert.equal(restored.appearance[variant].lighting,.8);
 }
 assert.equal(sanitize({variant:12}).variant,0);
});
