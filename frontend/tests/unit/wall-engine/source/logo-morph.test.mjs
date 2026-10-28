import test from 'node:test';
import assert from 'node:assert/strict';
import {facets,cycle,facetPose,morphSurface,logoTime} from '../../../../src/wall-engine/reference/logo-morph.js';
import {sanitize,variants} from '../../../../src/wall-engine/reference/state.js';
test('the motion uses six facets from the official MV symbol',()=>{
 assert.equal(facets.length,6);assert.equal(facets.filter(f=>f.color==='#0066b3').length,3);assert.equal(facets.filter(f=>f.color==='#ed1c24').length,3);
 assert.deepEqual(facets[0].points,[[0,63.33],[0,0],[45.45,0]]);
});
test('the assembly holds the original symbol, then changes form and repeats continuously',()=>{
 assert.equal(cycle(15).assembly,1);assert.equal(cycle(15).morph,0);
 assert.ok(cycle(3).morph>.8);assert.ok(cycle(28).morph>.8);
 for(let i=0;i<6;i++){
  assert.deepEqual(facetPose(0,i),facetPose(36,i));
  const pose=facetPose(15,i);assert.equal(pose.x,0);assert.equal(pose.y,0);assert.equal(pose.rotationY,0);
 }
});
test('morphing changes the surface and stays finite at the center and boundary',()=>{
 for(const point of [[0,0],[1,0],[.2,.4]]){
  const a=morphSurface(point[0],point[1],1,.04,0,0),b=morphSurface(point[0],point[1],1,.04,1,3);
  assert.ok([...a,...b].every(Number.isFinite));
 }
 assert.notDeepEqual(morphSurface(.2,.4,1,.04,0,0),morphSurface(.2,.4,1,.04,1,3));
});
test('new style and explicit video selection survive saved state',()=>{
 assert.equal(variants[5].name,'MV Symbiosis');
 const s=sanitize({variant:5,videoId:'P2-S5-01',showVideo:false});assert.equal(s.variant,5);assert.equal(s.videoId,'P2-S5-01');assert.equal(s.showVideo,false);
});

test('seeded facet motion is repeatable, distinct across copies and retains the assembled mark',()=>{
 const a={seed:12,randomness:1},b={seed:13,randomness:1};
 assert.deepEqual(facetPose(3,0,a),facetPose(3,0,a));assert.notDeepEqual(facetPose(3,0,a),facetPose(3,0,b));
 assert.deepEqual(facetPose(3,0,{seed:12,randomness:0}),facetPose(3,0));
 for(let i=0;i<6;i++){assert.deepEqual(facetPose(15,i,a),facetPose(15,i));for(const n of Object.values(facetPose(3,i,a)))assert.ok(Number.isFinite(n));}
});

test('seeded soft forms differ while the original facet geometry stays exact at assembly',()=>{
 const a={seed:12,randomness:1,index:0},b={seed:13,randomness:1,index:0};
 assert.notDeepEqual(morphSurface(.2,.3,.8,.045,1,3,.55,1,a),morphSurface(.2,.3,.8,.045,1,3,.55,1,b));
 assert.deepEqual(morphSurface(.2,.3,.8,.045,0,15,.55,1,a),[.2,.3,.0225]);
});
test('instance timing varies by seed and can be held without drifting',()=>{
 assert.notEqual(logoTime(8,1,{seed:1,randomness:1}),logoTime(8,1,{seed:2,randomness:1}));
 assert.equal(logoTime(8,0,{seed:1,randomness:1}),0);assert.equal(logoTime(8,.5,{seed:2,randomness:0}),4);
});
