import test from 'node:test';
import assert from 'node:assert/strict';
import { fixture, snippet, itemsOperation } from './fixtures/code-mode.js';
const setup=(t,options)=>{const f=fixture(options);t.after(f.cleanup);return f;};
const run=(router,code=snippet)=>router.call('read_webflow_code',{projectId:'p',code});

test('code mode paginates through real router ownership checks and prints only matches',async t=>{
  const {router,metrics}=setup(t,{count:220});
  const result=await run(router);
  assert.equal(JSON.parse(result.output).length,22);
  assert.equal(result.stats.calls,3);assert.equal(metrics.opens,3);assert.equal(metrics.calls,6);
  assert(result.stats.responseBytes>result.stats.outputBytes*100);
});
test('no host globals, filesystem, imports or network are exposed',async t=>{
  const {router}=setup(t);
  const result=await run(router,`print([typeof process,typeof require,typeof fetch,typeof Buffer,typeof console,typeof setTimeout]);`);
  assert.deepEqual(JSON.parse(result.output),Array(6).fill('undefined'));
  await assert.rejects(run(router,`import fs from 'node:fs';`));
  await assert.rejects(run(router,`Promise.resolve(1);`));
  await assert.rejects(run(router,`new Promise(() => {});`));
});
test('writes and unknown operations never reach upstream',async t=>{
  const {router,metrics}=setup(t);
  for(const op of ['data_cms_tool.create_collection_item','not_a_tool']) await assert.rejects(run(router,`read('${op}', {});`));
  assert.equal(metrics.calls,0);
});
test('read permission, project state, Direct mode and ownership are enforced',async t=>{
  const {router,store,connectionId,metrics}=setup(t);
  await assert.rejects(run(router,`read('${itemsOperation}',{collection_id:'foreign-collection'});`));
  assert.equal(metrics.calls,1); // ownership listing only, no item read
  router.edit('projects','p',{permissions:{'cms:read':false}});
  await assert.rejects(run(router));assert.equal(metrics.calls,1);
  router.edit('projects','p',{enabled:false});await assert.rejects(run(router,'print(1)'));
  router.edit('projects','p',{enabled:true});store.connection(connectionId).accessMode='direct';
  await assert.rejects(run(router,'print(1)'));
});
test('schema validation rejects site overrides and invalid parameters before dispatch',async t=>{
  const {router,metrics}=setup(t);
  await assert.rejects(run(router,`read('data_cms_tool.get_collection_list',{siteId:'bbbbbbbbbbbbbbbbbbbbbbbb'});`));
  await assert.rejects(run(router,`read('${itemsOperation}',{collection_id:'owned-collection',unexpected:true});`));
  assert.equal(metrics.calls,0);
});
test('policy changes during a read discard all output and prevent subsequent calls',async t=>{
  const {router}=setup(t,{intercept:async({action,router})=>{
    if(action==='list_collection_items')router.edit('projects','p',{permissions:{'cms:read':false}});
  }});
  await assert.rejects(run(router,`print('partial'); ${snippet}`));
});
test('selected Beta grant is used with no Stable fallback',async t=>{
  const seen=[];
  const {router,store,connectionId}=setup(t,{count:1,intercept:async({provider})=>{seen.push(provider.channel);}});
  store.connection(connectionId).beta={tokens:{access_token:'synthetic-beta'},sites:[{id:'aaaaaaaaaaaaaaaaaaaaaaaa'}]};
  router.edit('projects','p',{channel:'beta'});
  await run(router);assert.deepEqual([...new Set(seen)],['beta']);
});
test('output, source, memory and call limits fail closed',async t=>{
  const {router}=setup(t,{count:1});
  await assert.rejects(run(router,`try { print('x'.repeat(21000)); } catch {} print('hidden failure');`));
  await assert.rejects(run(router,' '.repeat(32769)));
  await assert.rejects(run(router,`const a = new Array(20000000).fill(1);`));
  await assert.rejects(run(router,`for(let i=0;i<101;i++) read('data_cms_tool.get_collection_list',{});`),e=>e.feedback?.code==='code_mode_limit');
});
test('provider errors remain sanitized and cannot be swallowed to return partial output',async t=>{
  const {router}=setup(t,{intercept:async()=>{throw new Error('SECRET PROVIDER BODY');}});
  await assert.rejects(run(router,`try { read('${itemsOperation}',{collection_id:'owned-collection'}); } catch {} print('partial');`),e=>!JSON.stringify(e).includes('SECRET'));
});
test('only one sandbox per router may run concurrently',async t=>{
  const {router}=setup(t,{count:1,delayMs:20});
  const first=run(router);
  await assert.rejects(run(router),e=>e.feedback?.code==='code_mode_busy');await first;
});
test('workspace scopes and oversized responses are rejected',async t=>{
  const {router}=setup(t,{intercept:async({action})=>{
    if(action==='list_collection_items')return {content:[{type:'text',text:'x'.repeat(4*1024*1024)}]};
  }});
  await assert.rejects(run(router,`read('data_members_tool.list_workspace_members',{});`));
  await assert.rejects(run(router),e=>e.feedback?.code==='code_mode_limit');
});
test('timeouts stop CPU loops and retain the run slot until in-flight reads drain', {timeout:40000}, async t=>{
  let entered;
  const ready=new Promise(resolve=>{entered=resolve;});
  let release;
  const blocked=new Promise(resolve=>{release=resolve;});
  const a=setup(t), b=setup(t,{intercept:async()=>{entered();await blocked;}});
  let eventLoopRan=false;
  setTimeout(()=>{eventLoopRan=true;},20);
  const cpu=assert.rejects(run(a.router,`while(true){}`));
  const waiting=assert.rejects(run(b.router),e=>e.feedback?.code==='code_mode_timeout');
  await ready;
  await Promise.all([cpu,waiting]);
  assert.equal(eventLoopRan,true);
  await assert.rejects(run(b.router),e=>e.feedback?.code==='code_mode_busy');
  release();
  // Let the already-dispatched read finish and release the admission slot.
  await new Promise(resolve=>setTimeout(resolve,100));
  assert.equal(JSON.parse((await run(b.router,'print(1)')).output),1);
});

test('owner toggle persists and disabled code mode cannot be enabled through MCP',async t=>{
 const {router,store}=setup(t);
 assert.equal(JSON.parse((await run(router,'print(1)')).output),1);
 assert.throws(()=>router.setReadCodeEnabled('false'));
 router.setReadCodeEnabled(false);
 assert.equal(store.summary().settings.readCodeEnabled,false);
 const {Store}=await import('../src/store.js');
 assert.equal(new Store(store.dir).data.settings.readCodeEnabled,false);
 await assert.rejects(run(router,'print(1)'),e=>e.feedback?.code==='code_mode_disabled');
 await assert.rejects(router.call('setReadCodeEnabled',{enabled:true}));
 assert.equal(store.data.settings.readCodeEnabled,false);
 router.setReadCodeEnabled(true);
 assert.equal(JSON.parse((await run(router,'print(2)')).output),2);
});
test('disable and re-enable during an active read still withholds its output',async t=>{
 const {router}=setup(t,{intercept:async({action,router})=>{
  if(action==='list_collection_items'){router.setReadCodeEnabled(false);router.setReadCodeEnabled(true);}
 }});
 await assert.rejects(run(router),e=>e.feedback?.code==='project_policy_changed');
});
