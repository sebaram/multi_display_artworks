import assert from 'node:assert/strict';
import {EventEmitter} from 'node:events';
import {closeClients} from './avatar-workloads.mjs';

function client(mode) {
  const webSocket=new EventEmitter();webSocket.readyState=mode==='already'?3:1;
  const c={visitorId:mode,engine:{readyState:mode==='already'?'closed':'open'},transport:{readyState:mode==='already'?'closed':'open',ws:webSocket},webSocket,closeObserved:mode==='already'};
  const finish=()=>{webSocket.readyState=3;c.engine.readyState=c.transport.readyState='closed';c.transport.ws=null;webSocket.emit('close');};
  webSocket.on('close',()=>{c.closeObserved=true;});webSocket.terminate=finish;
  c.socket={disconnect(){if(mode==='graceful')finish();else c.engine.readyState='closed';}};
  if(mode==='already')c.transport.ws=null; // Native Engine.IO doClose destroys this property.
  return c;
}
const already=await closeClients([client('already')]);assert.equal(already.allClosed,true);assert.equal(already.states[0].forced,false);
const graceful=await closeClients([client('graceful')]);assert.equal(graceful.allClosed,true);assert.equal(graceful.states[0].closeEvent,true);
const forced=await closeClients([client('forced')]);assert.equal(forced.allClosed,true);assert.equal(forced.states[0].forced,true);assert.ok(forced.elapsedMs>=4900);
const missing=client('already');missing.webSocket=undefined;missing.closeObserved=false;
assert.equal((await closeClients([missing])).allClosed,false);
console.log('PASS4 close cases: retained already-closed handle; graceful event; forced5s event; absent handle fails closed.');
