import test from 'node:test';
import assert from 'node:assert/strict';
import {parseYoutube} from '../../../../src/wall-engine/reference/youtube-source.js';
const id='M7lc1UVf-VE';
test('YouTube watch, share, Shorts, live and embed links use canonical video IDs',()=>{
 for(const value of [id,'https://youtube.com/watch?v='+id,'https://youtu.be/'+id,'https://www.youtube.com/embed/'+id,'https://www.youtube-nocookie.com/embed/'+id,'https://m.youtube.com/live/'+id])assert.equal(parseYoutube(value).id,id);
 assert.equal(parseYoutube('https://youtube.com/shorts/'+id).sourceAspect,9/16);
 assert.equal(parseYoutube('https://youtu.be/'+id+'?t=1h2m3s').start,3723);
 assert.equal(parseYoutube('https://youtube.com/watch?v='+id+'#t=45').start,45);
});
test('untrusted hosts and links without a video are rejected',()=>{
 for(const value of ['','javascript:alert(1)','https://evil.example/watch?v='+id,'https://youtube.com.evil.example/watch?v='+id,'https://youtube.com/playlist?list=ABC','https://youtube.com/watch?v=bad','https://evil@youtube.com/watch?v='+id,'https://youtu.be/'+id+'/extra'])assert.equal(parseYoutube(value),null,value);
});
