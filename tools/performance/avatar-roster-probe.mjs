// Public Socket.IO snapshot probe; no private server/test API and no DB writes.
import {appendFileSync} from 'node:fs';
import {producers} from './avatar-workloads.mjs';
for(let attempt=0;attempt<30;attempt++) {
  const at=Date.now()/1000,probe=await producers({n:1,size:10,profile:'desktop',models:'hidden',roomId:'29be153ffa8219a8bbe3c898'});
  const users=probe.clients[0].initialUsers,closed=await probe.close();
  const row={at,attempt,users,closed};appendFileSync('output/playwright/avatar-evaluation/roster-drain.jsonl',JSON.stringify(row)+'\n');
  console.log(JSON.stringify({at,attempt,remaining:users.length,allClosed:closed.allClosed}));
  if(!users.length)break;
  await new Promise(resolve=>setTimeout(resolve,2000));
}
