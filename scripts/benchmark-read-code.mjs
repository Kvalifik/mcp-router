// Synthetic benchmark: no OAuth, network, customer state or model calls.
import assert from 'node:assert/strict';
import { fixture, snippet, itemsOperation, unwrap } from '../test/fixtures/code-mode.js';
const bytes = value => Buffer.byteLength(JSON.stringify(value));
const median = values => [...values].sort((a,b)=>a-b)[Math.floor(values.length/2)];
const results=[];
for (const count of [1,1200]) {
  const trials={direct:[],code:[]};
  for(let trial=0;trial<6;trial++) {
    for(const mode of trial%2 ? ['code','direct'] : ['direct','code']) {
      const f=fixture({count,delayMs:2});
      try {
        // Same instruction preparation for both paths, excluded from timing/bytes.
        await f.router.call('prepare_project',{projectId:'p'});
        f.metrics.opens=0;f.metrics.calls=0;
        let output,returnedBytes=0,requestBytes=0;
        const started=performance.now();
        if(mode==='direct') {
          output=[];
          for(let offset=0;;offset+=100) {
            const args={projectId:'p',operationId:itemsOperation,params:{collection_id:'owned-collection',request:{limit:100,offset}}};
            requestBytes+=bytes(args);
            const response=await f.router.call('read_webflow',args);
            returnedBytes+=bytes(response);
            const page=unwrap(response);
            for(const item of page.items)if(item.fieldData.category==='selected')output.push({id:item.id,name:item.fieldData.name});
            if(offset+page.items.length>=page.pagination.total)break;
          }
        }else{
          const args={projectId:'p',code:snippet};requestBytes=bytes(args);
          const result=await f.router.call('read_webflow_code',args);
          returnedBytes=bytes(result);output=JSON.parse(result.output);
        }
        const elapsedMs=performance.now()-started;
        const expected=Array.from({length:Math.ceil(count/10)},(_,i)=>({id:`item-${i*10}`,name:`Course ${i*10}`}));
        assert.deepEqual(output,expected);
        if(trial>0)trials[mode].push({elapsedMs,returnedBytes,requestBytes,...f.metrics,matches:output.length});
      }finally{f.cleanup();}
    }
  }
  results.push({items:count,...Object.fromEntries(Object.entries(trials).map(([mode,rows])=>[mode,Object.fromEntries(Object.keys(rows[0]).map(k=>[k,Math.round(median(rows.map(r=>r[k]))*100)/100]))]))});
}
console.log(JSON.stringify({method:'One warmup pair and five measured pairs; alternating order; medians; 2ms synthetic delay per open and upstream call; identical paginated query; preparation excluded; bytes are JSON UTF-8, not tokens; no LLM/IPC/network timing',node:process.version,platform:`${process.platform}/${process.arch}`,results},null,2));
