import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { Store } from '../src/store.js';
import { Router } from '../src/router.js';
import { syncProjects } from '../src/discovery.js';
import { PERMISSIONS, permissions } from '../src/permissions.js';
function fixture(t) {
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'wfr-discovery-')); t.after(()=>fs.rmSync(dir,{recursive:true,force:true}));
 const store=new Store(dir),router=new Router(store,{}),id=router.createConnection();
 store.connection(id).sites=[{id:'site-1',name:'One',workspaceName:'Real workspace'},{id:'site-2',name:'Two',workspaceName:'Real workspace'}];
 return {store,router,id,dir};
}
test('discovered projects are complete, disabled, default-permissioned and invisible to MCP',async t=>{
 const {store,router,id}=fixture(t);syncProjects(store,id);
 const projects=Object.values(store.data.projects);assert.equal(projects.length,2);
 for(const p of projects){assert.equal(p.enabled,false);assert.equal(Object.values(permissions(p)).filter(Boolean).length,PERMISSIONS.length);}
 assert.deepEqual(await router.call('list_projects'),[]);assert.equal(store.connection(id).name,'Real workspace');
 syncProjects(store,id);assert.equal(Object.keys(store.data.projects).length,2);
});
test('startup migration preserves existing IDs, overrides and effective grants',t=>{
 const {store,router,id,dir}=fixture(t);router.saveProject({id:'existing',name:'Custom label',siteId:'site-1',connectionId:id,enabled:true,read:true});
 store.save();const restored=new Store(dir);new Router(restored,{});
 assert.equal(restored.data.projects.existing.name,'Custom label');assert.equal(restored.data.projects.existing.enabled,true);
 assert.deepEqual(permissions(restored.data.projects.existing),{'site:read':true});assert.equal(Object.keys(restored.data.projects).length,2);
});
test('default changes affect only never-enabled projects still using defaults',t=>{
 const {store,router,id}=fixture(t);syncProjects(store,id);const [a,b]=Object.values(store.data.projects);
 router.edit('projects',a.id,{enabled:true});router.setDefaultPermissions({'site:read':true});
 assert.equal(Object.keys(permissions(a)).length,PERMISSIONS.length);assert.deepEqual(permissions(b),{'site:read':true});
 router.edit('projects',a.id,{enabled:false});router.edit('projects',b.id,{permissions:{'cms:read':true}});
 router.setDefaultPermissions({});assert.equal(Object.keys(permissions(a)).length,PERMISSIONS.length);assert.deepEqual(permissions(b),{'cms:read':true});
});
test('provider names refresh, overrides survive, and default names can be restored',t=>{
 const {store,router,id}=fixture(t);syncProjects(store,id);const [p]=Object.values(store.data.projects);
 store.connection(id).sites[0].name='Renamed upstream';syncProjects(store,id);assert.equal(p.name,'Renamed upstream');
 router.edit('projects',p.id,{name:'My label'});store.connection(id).sites[0].name='Latest upstream';syncProjects(store,id);assert.equal(p.name,'My label');
 router.edit('projects',p.id,{useDefaultName:true});assert.equal(p.name,'Latest upstream');
 router.edit('connections',id,{name:'My workspace'});syncProjects(store,id);assert.equal(store.connection(id).name,'My workspace');
 router.edit('connections',id,{useDefaultName:true});assert.equal(store.connection(id).name,'Real workspace');
});
test('legacy trashed projects return disabled and revoked sites disappear until rediscovered',async t=>{
 const {store,router,id}=fixture(t);syncProjects(store,id);const [a,b]=Object.values(store.data.projects);
 a.deletedAt=new Date().toISOString();a.enabled=true;const originalPermissions=structuredClone(a.permissions);router.edit('projects',b.id,{enabled:true});store.connection(id).sites=[store.connection(id).sites[0]];syncProjects(store,id);
 assert.equal(Object.keys(store.data.projects).length,2);assert.equal(b.available,false);assert.equal(b.enabled,false);assert.deepEqual(store.summary().projects.map(p=>p.id),[a.id]);
 assert.deepEqual(await router.call('list_projects'),[]);
 store.connection(id).sites.push({id:'site-2',name:'Two again'});syncProjects(store,id);assert.equal(b.available,true);assert.equal(b.enabled,false);
 assert.equal(a.deletedAt,undefined);assert.equal(a.enabled,false);assert.deepEqual(a.permissions,originalPermissions);assert.equal(store.summary().trash,undefined);
});

test('local and single-site labels are never presented as provider workspace names',t=>{
 const {store,router,id}=fixture(t);const c=store.connection(id);c.name='Workspace A';c.nameOverride='Workspace A';c.sourceName='Workspace A';c.sites=[{id:'site-1',name:'A site'}];syncProjects(store,id);
 assert.equal(c.sourceName,null);assert.equal(c.name,'Workspace A');assert.equal(store.summary().connections[0].sourceName,null);assert.throws(()=>router.edit('connections',id,{useDefaultName:true}),/not provided/);
 router.edit('connections',id,{name:'My workspace'});assert.equal(c.sourceName,null);
 c.sites[0].workspaceName='Actual workspace';syncProjects(store,id);assert.equal(c.sourceName,'Actual workspace');router.edit('connections',id,{useDefaultName:true});assert.equal(c.name,'Actual workspace');
});

test('startup permanently purges legacy trashed connections and their projects',t=>{
 const {store,router,id,dir}=fixture(t);syncProjects(store,id);store.connection(id).deletedAt='2026-09-15';store.save();const reloaded=new Store(dir);new Router(reloaded,{});assert.equal(reloaded.data.connections[id],undefined);assert.equal(Object.values(reloaded.data.projects).length,0);assert.equal(new Store(dir).data.connections[id],undefined);
});
test('connection ordering persists, validates the whole inventory, and appends new connections',t=>{
 const {store,router,id,dir}=fixture(t);const b=router.createConnection('B');router.reorderConnections([b,id]);
 assert.deepEqual(new Store(dir).summary().connections.map(c=>c.id),[b,id]);
 assert.throws(()=>router.reorderConnections([b,b]));assert.throws(()=>router.reorderConnections([id]));
 const c=router.createConnection('C');assert.deepEqual(store.summary().connections.map(c=>c.id),[b,id,c]);
 router.remove('connections',b);assert.deepEqual(store.summary().connections.map(c=>c.id),[id,c]);
});
test('favourites survive sync and restart without changing project grants or enabled state',t=>{
 const {store,router,id,dir}=fixture(t);syncProjects(store,id);const p=Object.values(store.data.projects)[0];const before=JSON.stringify(p.permissions);
 router.edit('projects',p.id,{favourite:true});syncProjects(store,id);
 const restored=new Store(dir).data.projects[p.id];assert.equal(restored.favourite,true);assert.equal(restored.enabled,false);assert.equal(JSON.stringify(restored.permissions),before);assert.equal(restored.usesDefaultPermissions,true);
 assert.throws(()=>router.edit('projects',p.id,{favourite:'yes'}));router.edit('projects',p.id,{favourite:false});assert.equal(p.favourite,false);
});
