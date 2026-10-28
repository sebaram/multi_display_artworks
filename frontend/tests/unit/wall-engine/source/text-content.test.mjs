import test from 'node:test';
import assert from 'node:assert/strict';
import {sanitizeTextHtml,cleanTextProperties,textDefaults} from '../../../../src/wall-engine/reference/text-content.js';
import {sanitize} from '../../../../src/wall-engine/reference/state.js';
import {addElement,patchElement,copyElement,pasteElement,resetTextElement} from '../../../../src/wall-engine/reference/authoring.js';
import {encodeLook,decodeLook} from '../../../../src/wall-engine/reference/look-url.js';

test('simple HTML retains text emphasis and safe inline typography without active content',()=>{
 const html='<p onclick="evil()">Hello <strong>KAIST</strong><br><span style="color:#f00;font-weight:700;font-size:1.2em;background:url(https://evil)">world</span></p><script>alert(1)</script><img src=x onerror=evil()><svg><script>bad</script></svg>';
 const safe=sanitizeTextHtml(html);
 assert.match(safe,/<strong>KAIST<\/strong>/);assert.match(safe,/<br>/);assert.match(safe,/color:#f00/);assert.match(safe,/font-size:1.2em/);
 assert.doesNotMatch(safe,/onclick|script|alert|onerror|img|svg|https|background|url\(/);
 assert.equal(sanitizeTextHtml(safe),safe);
 assert.match(sanitizeTextHtml('<span style="font-family:Georgia;font-size:48px;font-weight:350">Type</span>'),/font-family:georgia;font-size:48px;font-weight:350/);
 for(const raw of ['&lt;script&gt;hello&lt;/script&gt;','<p title="x>y">&amp;안녕</p>','<strong>'.repeat(100)+'&'.repeat(40000)]){
  const value=sanitizeTextHtml(raw);assert.ok(value.length<=16000);assert.equal(sanitizeTextHtml(value),value);
 }
});
test('text properties are bounded and unknown CSS or font names never survive',()=>{
 const clean=cleanTextProperties({textHtml:'<em>hello</em>',textSize:900,textWeight:-5,textItalic:true,textColor:'#f00',textFont:'url(evil)',textAlign:'right',textWidth:200,textLineHeight:.01,textSpacing:20,textOpacity:2});
 assert.equal(clean.textSize,400);assert.equal(clean.textWeight,100);assert.equal(clean.textColor,'#ff0000');assert.equal(clean.textFont,undefined);assert.equal(clean.textWidth,100);assert.equal(clean.textOpacity,1);
 assert.equal(textDefaults('footer').textColor,'auto');
});
test('per-screen text and newly added text retain typography through URLs and independent duplication',()=>{
 let state=sanitize({variant:8});state=patchElement(state,'wall-caption-front',{textHtml:'<p>Real <em>and virtual</em></p>',textFont:'serif',textSize:72,textWeight:700,textColor:'#ff0000',visible:true});
 state=patchElement(state,'wall-caption-left',{textHtml:'<p>함께 만드는 공간</p>',textSize:48});
 state=addElement(state,'text',{screen:'front',x:20,y:35,textHtml:'<strong>My title</strong>',textSize:80});
 const object=state.authored[8].objects[0];state=pasteElement(state,copyElement(state,{...object,dom:true,text:true}));
 assert.equal(state.authored[8].objects[1].type,'text');assert.equal(state.authored[8].objects[1].textSize,80);
 state=patchElement(state,'object-2',{textHtml:'<p>Other title</p>',screen:'left'});
 const restored=decodeLook(encodeLook(state));assert.deepEqual(restored.authored,sanitize(state).authored);
 assert.equal(restored.authored[8].objects[0].textHtml,'<strong>My title</strong>');
 assert.equal(restored.authored[8].objects[1].screen,'left');
 const reset=resetTextElement(state,'wall-caption-front');assert.equal(reset.authored[8].edits['wall-caption-front'].textHtml,undefined);assert.equal(reset.authored[8].edits['wall-caption-front'].visible,true);
});
