import test from 'node:test';
import assert from 'node:assert/strict';
import { sanitize } from '../../../src/wall-engine/reference/state.js';
import { assignVideoSource } from '../../../src/wall-engine/reference/video-layers.js';

test('replacing uploaded video sources updates assetId and clears it for other providers', () => {
  const state=sanitize({showVideo:false,videoLayers:[{id:'video-1',assetId:'asset-a',enabled:false,x:24,width:30}]});
  const replaced=assignVideoSource(state,'video-1',{assetId:'asset-b',sourceAspect:4/3});
  assert.equal(replaced.videoLayers[0].assetId,'asset-b');
  assert.equal(replaced.videoLayers[0].enabled,false);
  assert.equal(replaced.showVideo,false);
  assert.equal(replaced.videoLayers[0].x,24);
  const youtube=assignVideoSource(replaced,'video-1',{youtube:{id:'M7lc1UVf-VE',start:0,title:'YouTube'}});
  assert.equal(youtube.videoLayers[0].assetId,undefined);
  assert.equal(youtube.videoLayers[0].youtube.id,'M7lc1UVf-VE');
  const direct=assignVideoSource(replaced,'video-1',{customClip:{url:'/media/replacement.mp4',name:'Replacement'}});
  assert.equal(direct.videoLayers[0].assetId,undefined);
  assert.equal(direct.videoLayers[0].customClip.url,'/media/replacement.mp4');
});
