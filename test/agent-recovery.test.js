import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {once} from 'node:events';
import {Store} from '../src/store.js';
import {Router} from '../src/router.js';
import {createDashboard, createIPC} from '../src/server.js';
import {agentFeedback, upstreamError, checkUpstreamResponse} from '../src/agent-errors.js';

async function fixture(t) {
  const dir=fs.mkdtempSync(path.join(os.tmpdir(),'router-recovery-'));
  const store=new Store(dir), calls=[];
  const oauth={begin:async(id,channel)=>{calls.push({id,channel});return {url:'https://mcp.webflow.com/synthetic-authorization',browserNonce:'synthetic-browser-nonce'};}};
  const router=new Router(store,oauth);
  const id=router.createConnection('Synthetic workspace');
  const connection=store.connection(id);
  connection.sites=[{id:'synthetic-site',name:'Synthetic site'}];
  connection.tokens={access_token:'synthetic-stable'};
  connection.beta={tokens:{access_token:'synthetic-beta'},sites:connection.sites};
  router.saveProject({id:'project',name:'Synthetic site',connectionId:id,siteId:'synthetic-site',enabled:true});
  router.edit('projects','project',{channel:'beta'});
  // Reserve an ephemeral port before configuring the strict Host check.
  const probe=createIPC(router);probe.listen(0,'127.0.0.1');await once(probe,'listening');
  const port=probe.address().port;await new Promise(resolve=>probe.close(resolve));
  const origin=`http://127.0.0.1:${port}`;
  const server=createDashboard(router,oauth,origin);server.listen(port,'127.0.0.1');await once(server,'listening');
  t.after(async()=>{server.closeAllConnections();await new Promise(resolve=>server.close(resolve));fs.rmSync(dir,{recursive:true,force:true});});
  return {router,store,id,connection,calls,origin,link:()=>router.call('request_reauthorization',{projectId:'project'})};
}

test('agent feedback distinguishes structured authorization failures without exposing provider text',()=>{
  const secret='synthetic-private-payload';
  for(const code of [401,'missing_scopes','insufficient_scope']) {
    assert.throws(()=>checkUpstreamResponse({isError:true,content:[{type:'text',text:JSON.stringify({error:{code,message:secret}})}]}),error=>{
      assert.equal(agentFeedback(error).code,'reauthorization_required');
      assert(!JSON.stringify(agentFeedback(error)).includes(secret));return true;
    });
  }
  assert.equal(upstreamError({status:403,message:secret}).feedback.code,'upstream_access_denied');
  assert.equal(upstreamError(new Error(secret)).feedback.code,'upstream_failure');
  assert.equal(agentFeedback(new Error(secret)).code,'request_failed');
  assert.throws(()=>checkUpstreamResponse({content:[{type:'text',text:JSON.stringify({action:'write',error:{code:403,message:secret}})}]}),error=>error.feedback.code==='upstream_access_denied');
  assert.throws(()=>checkUpstreamResponse({isError:true,content:[{type:'text',text:secret}]}),error=>error.feedback.code==='upstream_failure');
  const data={content:[{type:'text',text:JSON.stringify({result:{code:401,message:secret}})}]};
  assert.equal(checkUpstreamResponse(data),data);
});

test('reauthorization link is lazy, deduplicated, one-use and scoped to selected Beta grant',async t=>{
  const f=await fixture(t), before=structuredClone(f.connection);
  const first=await f.link(), second=await f.link();
  assert.equal(first.url,second.url);assert.equal(first.channel,'beta');assert.equal(f.calls.length,0);
  assert.deepEqual(f.connection,before);
  const response=await fetch(first.url,{redirect:'manual'});
  assert.equal(response.status,303);assert.match(response.headers.get('set-cookie'),/HttpOnly; SameSite=Lax/);
  assert.deepEqual(f.calls,[{id:f.id,channel:'beta'}]);
  assert.equal((await fetch(first.url,{redirect:'manual'})).status,400);
  assert.deepEqual(f.connection.tokens,before.tokens);
});

test('reauthorization rechecks project policy and does not cancel another pending grant',async t=>{
  const f=await fixture(t);
  const changed=await f.link();f.router.edit('projects','project',{channel:'stable'});
  assert.equal((await fetch(changed.url,{redirect:'manual'})).status,400);
  const disabled=await f.link();f.router.edit('projects','project',{enabled:false});
  assert.equal((await fetch(disabled.url,{redirect:'manual'})).status,400);
  await assert.rejects(f.link(),error=>error.feedback.code==='project_access_denied');
  f.router.edit('projects','project',{enabled:true});
  const pending=await f.link();f.connection.beta.pending={createdAt:Date.now(),state:'synthetic-state'};
  assert.equal((await fetch(pending.url,{redirect:'manual'})).status,400);
  assert.equal(f.calls.length,0);
  await assert.rejects(f.router.call('request_reauthorization',{projectId:'project',channel:'beta'}),/Invalid arguments/);
  assert.equal((await fetch(f.origin+'/api/state')).status,403);
});

test('expired links fail closed and enabled unavailable projects can request recovery',async t=>{
  const f=await fixture(t);
  f.store.data.projects.project.available=false;
  assert.equal((await f.router.call('list_projects'))[0].id,'project');
  await assert.rejects(f.router.call('read_project_site',{projectId:'project'}),error=>error.feedback.code==='reauthorization_required');
  const now=Date.now;
  let link;
  try {Date.now=()=>now()-61000;link=await f.link();} finally {Date.now=now;}
  assert.equal((await fetch(link.url,{redirect:'manual'})).status,400);
  assert.equal(f.calls.length,0);
});
