import { createServer } from 'node:http';
import { readFileSync, existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { resolve, extname, join, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';
import assert from 'node:assert/strict';

const root=resolve(fileURLToPath(new URL('../../../../',import.meta.url)));
const {chromium}=createRequire(join(root,'frontend/package.json'))('playwright');
const output=join(root,'frontend/test-results/wall-engine-italic');mkdirSync(output,{recursive:true});
const mime={'.js':'text/javascript','.json':'application/json','.png':'image/png','.ttf':'font/ttf'};
const server=createServer((req,res)=>{
  if(req.url==='/'){res.setHeader('Content-Type','text/html');res.end('<!doctype html><html><head><link rel="icon" href="data:,"></head><body><canvas width="640" height="360"></canvas></body></html>');return;}
  let url=decodeURIComponent(req.url.split('?')[0]);if(url.startsWith('/wall-reference/'))url='/frontend/public'+url;
  const file=resolve(root,'.'+url);
  if(!file.startsWith(root+sep)||!existsSync(file)){res.statusCode=404;res.end();return;}
  res.setHeader('Content-Type',mime[extname(file)]||'application/octet-stream');res.end(readFileSync(file));
});
await new Promise(r=>server.listen(0,'127.0.0.1',r));
const browser=await chromium.launch({headless:true,args:['--use-angle=swiftshader','--enable-webgl']});
try {
  const page=await browser.newPage(),pageErrors=[];page.on('pageerror',e=>pageErrors.push(e.message));
  await page.goto(`http://127.0.0.1:${server.address().port}`);
  const result=await page.evaluate(async()=>{
    const {createWallRenderer,normalizeWallLook}=await import('/frontend/src/wall-engine/index.js');
    const canvas=document.querySelector('canvas'),errors=[];
    const look=normalizeWallLook({variant:0,brightness:100,branding:false,screens:[{id:'front',width:1920,height:1080}],appearance:{0:{mode:'solid',backgroundColor:'#000000'}},authored:{0:{objects:[{id:'object-1',type:'text',screen:'front',x:20,y:20,textSize:240,textHtml:'<p><i>Hello</i></p>'}],edits:{}}}});
    const renderer=createWallRenderer({canvas,config:look,onError:e=>errors.push(e)});
    await document.fonts.ready;await new Promise(r=>setTimeout(r,100));
    renderer.render(12);const italic=canvas.getContext('2d').getImageData(0,0,640,360).data;
    look.state.authored[0].objects[0].textHtml='<p><em>Hello</em></p>';renderer.setConfig(look);renderer.render(12);
    const emphasis=canvas.getContext('2d').getImageData(0,0,640,360).data;
    let differentChannels=0;for(let i=0;i<italic.length;i++)if(italic[i]!==emphasis[i])differentChannels++;
    renderer.dispose();return {differentChannels,errors};
  });
  writeFileSync(join(output,'result.json'),JSON.stringify(result,null,2));
  console.log(JSON.stringify(result));assert.deepEqual(pageErrors,[]);assert.deepEqual(result.errors,[]);
  assert.equal(result.differentChannels,0,'<i>Hello</i> must render the same italic glyphs as <em>Hello</em>, without a filled rectangle');
  console.log('PASS focused italic <i> composition');
} finally {await browser.close();server.close();}
