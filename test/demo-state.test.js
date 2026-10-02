import test from 'node:test';
import assert from 'node:assert/strict';
import { createDemoState } from '../scripts/demo-state.mjs';
const seed = {settings:{defaultChannel:'stable',defaultPermissions:{'site:read':true}},connections:[{id:'demo',name:'Example',enabled:true,channel:'stable',channels:{stable:{authorized:true,siteIds:['site']}}}],projects:[{id:'project',siteId:'site',connectionId:'demo',name:'Example',sourceName:'Example',enabled:false,channel:'inherit',permissions:{'site:read':true}}]};
test('demo edits are shared in memory and a fresh session resets them',()=>{
  const demo=createDemoState(seed);
  demo.mutate('/projects/project/edit',{enabled:true,name:'Renamed',favourite:true,permissions:{'site:read':true}});
  assert.equal(demo.state.projects[0].name,'Renamed');
  assert.equal(demo.mutate('/read-project',{projectId:'project'}).simulated,true);
  demo.mutate('/connections/demo/toggle',{enabled:false});
  assert.throws(()=>demo.mutate('/read-project',{projectId:'project'}),/Enable this connection/);
  assert.deepEqual(createDemoState(seed).state,seed);
  demo.mutate('/connections/demo/delete');
  assert.equal(demo.state.projects.length,0);
  assert.equal(demo.state.connections.length,0);
});
test('demo can add and simulate authorization without real OAuth',()=>{
  const demo=createDemoState(seed);
  demo.mutate('/settings/default-channel',{channel:'beta'});
  const {id}=demo.mutate('/connections');
  assert.equal(demo.mutate(`/connections/${id}/authorize`).url,'demo:authorized');
  const project=demo.state.projects.find(p=>p.connectionId===id);
  assert.equal(project.enabled,false);
  assert.deepEqual(project.permissions,seed.settings.defaultPermissions);
  assert.deepEqual(demo.state.connections[1].channels.beta.siteIds,[project.siteId]);
  demo.mutate('/settings/connection-order',{ids:[id,'demo']});
  assert.equal(demo.state.connections[0].id,id);
});
test('demo rejects invalid updates without applying partial edits',()=>{
  const demo=createDemoState(seed);
  assert.throws(()=>demo.mutate('/projects/project/edit',{name:'Changed',permissions:{'unknown:write':true}}));
  assert.equal(demo.state.projects[0].name,'Example');
  assert.throws(()=>demo.mutate('/connections/demo/toggle',{enabled:'yes'}));
  assert.throws(()=>demo.mutate('/settings/connection-order',{ids:['missing']}));
  assert.throws(()=>demo.mutate('/unknown'));
});
