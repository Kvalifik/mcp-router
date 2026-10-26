import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { Store } from '../src/store.js';
import { OAuthManager } from '../src/oauth.js';
import { Router } from '../src/router.js';
import access from '../src/access-status.cjs';

function fixture(t) {
  const dir=fs.mkdtempSync(path.join(os.tmpdir(),'router-direct-'));
  t.after(()=>fs.rmSync(dir,{recursive:true,force:true}));
  const store=new Store(dir), oauth=new OAuthManager(store,'http://127.0.0.1:43127');
  const opened=[],calls=[];
  let closed=0;
  const tools=[{name:'future_tool',inputSchema:{type:'object',properties:{new_field:{type:'string'}},required:['new_field']}}];
  const response={content:[{type:'text',text:'Synthetic result'},{type:'image',data:'c3ludGhldGlj',mimeType:'image/png'}],structuredContent:{ok:true}};
  const upstream={listTools:async()=>tools,instructions:'Synthetic instructions',guide:{content:[]},call:async(name,args)=>{calls.push({name,args});return response;},close:async()=>{closed++;}};
  const router=new Router(store,oauth,{open:async provider=>{opened.push(provider.channel);return upstream;}});
  const id=router.createConnection('Synthetic connection');
  const c=store.connection(id);c.tokens={access_token:'synthetic-stable'};c.beta={tokens:{access_token:'synthetic-beta'}};
  c.sites=[{id:'site-a',name:'Synthetic A'}];
  router.saveProject({id:'project-a',name:'Synthetic A',connectionId:id,siteId:'site-a',enabled:false,read:false});
  const args={connectionId:id,channel:'stable'};
  return {dir,store,router,id,c,args,upstream,tools,response,opened,calls,closed:()=>closed};
}

test('new and legacy connections default to managed; only owner edits enable direct mode',async t=>{
  const f=fixture(t);
  assert.equal(f.c.accessMode,'managed');
  delete f.c.accessMode;
  assert.equal(f.store.summary().connections[0].accessMode,'managed');
  assert.deepEqual(await f.router.call('list_direct_connections'),[]);
  await assert.rejects(f.router.call('get_direct_tools',f.args),/not enabled/);
  await assert.rejects(f.router.call('call_direct_tool',{...f.args,toolName:'future_tool',arguments:{}}),/not enabled/);
  await assert.rejects(f.router.call('edit',{connectionId:f.id,accessMode:'direct'}));
  assert.throws(()=>f.router.edit('connections',f.id,{accessMode:'automatic'}));
  assert.throws(()=>f.router.edit('projects','project-a',{accessMode:'direct'}));
  assert.equal(f.opened.length,0);
  f.router.edit('connections',f.id,{accessMode:'direct'});
  assert.equal(new Store(f.dir).connection(f.id).accessMode,'direct');
  assert.equal((await f.router.call('list_direct_connections'))[0].connectionId,f.id);
});

test('direct mode discovers live schemas and forwards unknown operations without project grants',async t=>{
  const f=fixture(t); f.router.edit('connections',f.id,{accessMode:'direct'});
  const discovered=await f.router.call('get_direct_tools',f.args);
  assert.deepEqual(discovered.tools,[{name:'future_tool'}]);
  assert.deepEqual((await f.router.call('get_direct_tools',{...f.args,toolName:'future_tool'})).tool,f.tools[0]);
  assert.equal(discovered.instructions,'Synthetic instructions');
  const input={new_field:'synthetic',collection_id:'outside-managed-project'};
  const result=await f.router.call('call_direct_tool',{...f.args,toolName:'future_tool',arguments:input});
  assert.deepEqual(result,f.response);
  assert.deepEqual(f.calls,[{name:'future_tool',args:input}]);
  f.tools.push({name:'newly_added_tool',inputSchema:{type:'object'}});
  assert.equal((await f.router.call('get_direct_tools',f.args)).tools.length,2);
  await f.router.call('call_direct_tool',{...f.args,toolName:'newly_added_tool',arguments:{}});
  await assert.rejects(f.router.call('call_direct_tool',{...f.args,toolName:'removed_tool',arguments:{}}),/current Webflow tool list/);
  assert.equal(f.calls.length,2);
  assert.equal(f.closed(),6);
  assert.equal(JSON.stringify(f.store.data.audit).includes('outside-managed-project'),false);
  assert.equal(JSON.stringify(f.store.data.audit).includes('newly_added_tool'),false);
  const project=(await f.router.call('list_projects',{query:'Synthetic A'}))[0];
  assert.equal(project.accessMode,'direct');assert.equal(project.siteId,'site-a');assert.deepEqual(project.capabilities,[]);
  await assert.rejects(f.router.call('prepare_project',{projectId:'project-a'}));
});

test('direct mode works without inventory and keeps channel grants separate',async t=>{
  const f=fixture(t);f.router.edit('connections',f.id,{accessMode:'direct'});
  f.store.data.projects={};f.c.sites=[];
  assert.equal((await f.router.call('list_direct_connections')).length,1);
  await f.router.call('get_direct_tools',{...f.args,channel:'beta'});
  assert.deepEqual(f.opened,['beta']);
  delete f.c.beta.tokens;
  await assert.rejects(f.router.call('get_direct_tools',{...f.args,channel:'beta'}),e=>e.feedback.code==='reauthorization_required'&&!e.feedback.nextStep.includes('projectId'));
  await assert.rejects(f.router.call('get_direct_tools',{connectionId:f.id}));
  await assert.rejects(f.router.call('get_direct_tools',{...f.args,channel:'other'}));
  assert.deepEqual(f.opened,['beta']);
  await f.router.call('get_direct_tools',f.args);
  assert.deepEqual(f.opened,['beta','stable']);
});

test('disabled or deleted connections hide direct discovery and deny calls',async t=>{
  const f=fixture(t);f.router.edit('connections',f.id,{accessMode:'direct'});
  f.router.setConnection(f.id,false);
  assert.deepEqual(await f.router.call('list_direct_connections'),[]);
  assert.deepEqual(await f.router.call('list_projects'),[]);
  await assert.rejects(f.router.call('get_direct_tools',f.args));
  f.router.setConnection(f.id,true);f.router.remove('connections',f.id);
  await assert.rejects(f.router.call('get_direct_tools',f.args));
  assert.deepEqual(await f.router.call('list_direct_connections'),[]);
  assert.equal(f.opened.length,0);
});

test('mode changes preserve managed settings and invalidate preparation proofs',async t=>{
  const f=fixture(t);const before=structuredClone(f.store.data.projects);
  f.router.preparations.set('proof',{projectId:'project-a'});
  f.router.edit('connections',f.id,{accessMode:'direct'});
  assert.equal(f.router.preparations.size,0);
  assert.deepEqual(f.store.data.projects,before);
  f.router.edit('connections',f.id,{accessMode:'managed'});
  assert.deepEqual(f.store.data.projects,before);
  await assert.rejects(f.router.call('call_direct_tool',{...f.args,toolName:'future_tool',arguments:{}}));
});

test('access changes during discovery prevent dispatch, even after an off/on cycle',async t=>{
  for (const change of ['off','mode','cycle','delete','grant']) {
    const f=fixture(t);f.router.edit('connections',f.id,{accessMode:'direct'});
    f.upstream.listTools=async()=>{
      if(change==='off')f.router.setConnection(f.id,false);
      if(change==='mode')f.router.edit('connections',f.id,{accessMode:'managed'});
      if(change==='cycle'){f.router.setConnection(f.id,false);f.router.setConnection(f.id,true);}
      if(change==='delete')f.router.remove('connections',f.id);
      if(change==='grant')delete f.c.tokens;
      return f.tools;
    };
    await assert.rejects(f.router.call('call_direct_tool',{...f.args,toolName:'future_tool',arguments:{}}));
    assert.equal(f.calls.length,0);assert.equal(f.closed(),1);
  }
});

test('results are withheld after mode revocation or mode round-trip in flight',async t=>{
  for (const restore of [false,true]) {
    const f=fixture(t);f.router.edit('connections',f.id,{accessMode:'direct'});
    let calls=0;
    f.upstream.call=async()=>{calls++;f.router.edit('connections',f.id,{accessMode:'managed'});if(restore)f.router.edit('connections',f.id,{accessMode:'direct'});return f.response;};
    await assert.rejects(f.router.call('call_direct_tool',{...f.args,toolName:'future_tool',arguments:{}}));
    assert.equal(calls,1);assert.equal(f.closed(),1);
  }
});

test('upstream failures are sanitized, never retried, and close the selected session',async t=>{
  const f=fixture(t);f.router.edit('connections',f.id,{accessMode:'direct'});let calls=0;
  f.upstream.call=async()=>{calls++;throw Object.assign(new Error('synthetic-private-provider-data'),{status:401});};
  await assert.rejects(f.router.call('call_direct_tool',{...f.args,toolName:'future_tool',arguments:{}}),e=>e.feedback.code==='reauthorization_required'&&!JSON.stringify(e.feedback).includes('synthetic-private'));
  assert.equal(calls,1);assert.equal(f.closed(),1);assert.deepEqual(f.opened,['stable']);
  assert.equal(JSON.stringify(f.store.data.audit).includes('synthetic-private'),false);
});

test('direct readiness does not report inactive project permission or channel problems',async t=>{
  const f=fixture(t);f.router.edit('connections',f.id,{accessMode:'direct'});
  f.store.data.projects['project-a'].enabled=true;
  f.store.data.projects['project-a'].channel='beta';
  f.c.status='connected';delete f.c.beta.tokens;
  const status=access.accessStatus(f.store.summary());
  assert.deepEqual(status.issues,[]);assert.equal(status.enabledProjects,0);
});
