// Run between measurement phases; records actual negotiated compression without payloads/cookies.
import {writeFileSync} from 'node:fs';
import {resolve} from 'node:path';
import {producers,browserCode,provenance,waitForQuiescence} from './avatar-workloads.mjs';
const roomId='29be153ffa8219a8bbe3c898';
const bots=await producers({n:1,size:10,profile:'desktop',models:'shared',roomId});
const result={source:await provenance(),at:Date.now()/1000,nodeExtensions:bots.clients[0].socket.io.engine.transport.ws.extensions};
try {
  result.chromium=await browserCode(`async page => {
    const cdp=await page.context().newCDPSession(page),handshakes=[];
    await cdp.send('Network.enable');
    cdp.on('Network.webSocketHandshakeResponseReceived',e=>{
      const headers=Object.fromEntries(Object.entries(e.response.headers).filter(([k])=>['sec-websocket-extensions','upgrade'].includes(k.toLowerCase())));
      handshakes.push({status:e.response.status,headers});
    });
    await page.goto('http://127.0.0.1:8013/room?room_id=${roomId}');
    await page.waitForFunction(()=>document.querySelectorAll('[id^="camera-"]').length===1);
    await page.goto('about:blank');await cdp.detach();return handshakes;
  }`);
} finally {
  result.close=await bots.close();
  result.quiescence=await waitForQuiescence(roomId,'transport-negotiation');
  writeFileSync(resolve(import.meta.dirname,'../../output/playwright/avatar-evaluation/transport-negotiation.json'),JSON.stringify(result,null,2));
}
console.log(JSON.stringify({nodeExtensions:result.nodeExtensions,chromium:result.chromium,allClosed:result.close.allClosed}));
