// Read-only live worker/bridge validation. Never persists identifiers or content.
// Prepare project guidance and discover the exact schema through MCP first.
// The installed daemon retains OAuth, project permissions and ownership checks.
import assert from 'node:assert/strict';
import {Worker} from 'node:worker_threads';
import {Client} from '@modelcontextprotocol/sdk/client/index.js';
import {StdioClientTransport} from '@modelcontextprotocol/sdk/client/stdio.js';
import {fileURLToPath} from 'node:url';
const projectId=process.env.BENCH_PROJECT_ID, collection=process.env.BENCH_COLLECTION_ID;
if(!projectId||!collection||!process.env.ROUTER_SOCKET)throw new Error('Set BENCH_PROJECT_ID, BENCH_COLLECTION_ID and ROUTER_SOCKET after preparation.');
const operationId='data_cms_tool.list_collection_items';
const client=new Client({name:'read-only-code-validation',version:'1.0.0'});
const bytes=value=>Buffer.byteLength(JSON.stringify(value));
const median=values=>[...values].sort((a,b)=>a-b)[Math.floor(values.length/2)];
const request=offset=>({projectId,operationId,params:{collection_id:collection,request:{limit:2,offset,sortBy:'name',sortOrder:'asc'}}});
let callCount=0;
async function read(args){
  callCount++;
  const result=await client.callTool({name:'read_webflow',arguments:args});
  if(result.isError)throw new Error('Live router read failed; inspect via MCP before retrying.');
  return JSON.parse(result.content[0].text);
}
const snippet=`
const rows=[];
for(let offset=0;offset<6;offset+=2){
 const response=read('${operationId}',{collection_id:${JSON.stringify(collection)},request:{limit:2,offset,sortBy:'name',sortOrder:'asc'}});
 const page=JSON.parse(response.content[0].text).result;
 for(const item of page.items)rows.push({id:item.id,hasName:!!item.fieldData?.name});
 if(offset+page.items.length>=page.pagination.total)break;
}
print(rows);`;
async function codeRun(){
 return new Promise((resolve,reject)=>{
  const worker=new Worker(new URL('../src/read-code-worker.js',import.meta.url),{workerData:{code:snippet,timeoutMs:30000}});
  let done=false;
  const finish=(error,result)=>{if(done)return;done=true;clearTimeout(timer);void worker.terminate().then(()=>error?reject(error):resolve(result));};
  const timer=setTimeout(()=>finish(new Error('Live worker timed out')),30000);
  worker.on('error',()=>finish(new Error('Live worker failed')));
  worker.on('exit',()=>{if(!done)finish(new Error('Live worker exited early'));});
  worker.on('message',async m=>{
   if(done)return;
   try{
    if(m.type==='done')return finish(null,{rows:JSON.parse(m.output),returnedBytes:bytes({output:m.output})});
    assert.equal(m.type,'read');const args=JSON.parse(m.json);
    assert.equal(args.operationId,operationId);
    if(JSON.stringify(args.params)!==JSON.stringify(request(args.params.request.offset).params))throw new Error('Unexpected live request parameters');
    assert([0,2,4].includes(args.params.request.offset));
    const result=await read({...args,projectId});
    if(!done)worker.postMessage({json:JSON.stringify(result)});
   }catch{finish(new Error('Live bridge validation failed; no automatic retry.'));}
  });
 });
}
const samples={baseline:[],worker:[]};
try{
 await client.connect(new StdioClientTransport({command:process.execPath,args:[fileURLToPath(new URL('../src/stdio.js',import.meta.url))],env:{...process.env}}));
 const allowed=await client.callTool({name:'get_project_operations',arguments:{projectId,operationId}});
 assert(!allowed.isError);assert.equal(JSON.parse(allowed.content[0].text).mode,'read');
 for(let trial=0;trial<3;trial++){
  const pair={};
  for(const mode of trial%2?['worker','baseline']:['baseline','worker']){
   const started=performance.now(),before=callCount;
   let result;
   if(mode==='worker')result=await codeRun();
   else{
    result={rows:[],returnedBytes:0};
    for(let offset=0;offset<6;offset+=2){
     const response=await read(request(offset));result.returnedBytes+=bytes(response);
     const page=JSON.parse(response.content[0].text).result;
     for(const item of page.items)result.rows.push({id:item.id,hasName:!!item.fieldData?.name});
     if(offset+page.items.length>=page.pagination.total)break;
    }
   }
   pair[mode]=result.rows;
   samples[mode].push({elapsedMs:Math.round(performance.now()-started),returnedBytes:result.returnedBytes,reads:callCount-before,items:result.rows.length});
  }
  if(JSON.stringify(pair.baseline)!==JSON.stringify(pair.worker))throw new Error('Live results differ; content withheld.');
 }
 console.log(JSON.stringify({kind:'live worker bridge via installed permission-checked router; not an installed code-mode tool',identicalResults:true,pairs:3,totalReads:callCount,samples,medians:Object.fromEntries(Object.entries(samples).map(([mode,rows])=>[mode,Object.fromEntries(Object.keys(rows[0]).map(key=>[key,median(rows.map(row=>row[key]))]))]))},null,2));
}finally{await client.close();}
