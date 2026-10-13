import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import Ajv from 'ajv';
import { Store } from '../src/store.js';
import { Router } from '../src/router.js';
import { CATALOG, operation, prepareArguments, permissions } from '../src/permissions.js';
const site='aaaaaaaaaaaaaaaaaaaaaaaa',other='bbbbbbbbbbbbbbbbbbbbbbbb';
const envelope=(action,result)=>({content:[{type:'text',text:JSON.stringify({action,result})}]});
function fixture(t) {
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'wfr-caps-'));t.after(()=>fs.rmSync(dir,{recursive:true,force:true}));
 const store=new Store(dir), calls=[];
 let intercept=async()=>{};
 const router=new Router(store,{provider:(id,interactive,channel)=>({id,channel})},{open:async()=>({guide:{content:[]},close:async()=>{},call:async(tool,args)=>{
   calls.push({tool,args});const intercepted=await intercept(tool,args);if(intercepted!==undefined)return intercepted;
   const action=Object.keys(args.actions?.[0]||{}).find(k=>k!=='label');
   if(action==='search_instructions')return envelope(action,{instructions:[],pagination:{total:0}});
   if(action==='get_collection_list')return envelope(action,{collections:[{id:'owned-collection'}]});
   if(action==='list_pages')return envelope(action,{pages:[{id:'owned-page'}],pagination:{total:1}});
   if(action==='list_assets')return envelope(action,{assets:[{id:'owned-asset'}],pagination:{total:1}});
   return envelope(action,{ok:true});
 }})});
 const id=router.createConnection('A');store.connection(id).sites=[{id:site,name:'A'}];store.connection(id).tokens={access_token:'fake'};
 router.saveProject({id:'p',name:'P',connectionId:id,siteId:site,enabled:true});
 return {router,store,calls,setIntercept:fn=>intercept=fn};
}
const grant=(router,values)=>router.edit('projects','p',{permissions:{'site:read':true,'agent_instructions:read':true,...values}});
const request=(operationId,params={},extra={})=>({projectId:'p',operationId,params,...extra});
test('preparation loads every enabled rule and indexes skills across pages without fetching their bodies',async t=>{
 const {router,setIntercept,calls}=fixture(t);grant(router,{});
 setIntercept(async(tool,args)=>{
   const action=args.actions[0];
   if(action.search_instructions) {
     const rows=action.search_instructions.offset===0 ? [
       {path:'rules/site.md',kind:'rule'},
       {path:'charts/SKILL.md',kind:'skill',name:'Charts',description:'Chart editing'},
       {path:'hidden/SKILL.md',kind:'skill',enabled:false},
       {path:'rules/draft.md',kind:'rule',isDraft:true}
     ] : [
       {path:'rules/conservative.md',kind:'skill'},
       {path:'legacy.md'},
       {path:'unknown.md',kind:'future'},
       {path:'tables/SKILL.md',kind:'skill'}
     ];
     return envelope('search_instructions',{instructions:rows,pagination:{total:8}});
   }
   if(action.read_instruction) {
     assert.equal(action.read_instruction.resolve_references,false);
     return envelope('read_instruction',{markdown:'Synthetic rule'});
   }
 });
 const result=await router.call('prepare_project',{projectId:'p'});
 assert.deepEqual(result.instructions.map(x=>x.path),['rules/site.md','rules/conservative.md','legacy.md','unknown.md']);
 assert.deepEqual(result.skills,[{path:'charts/SKILL.md',name:'Charts',description:'Chart editing'},{path:'tables/SKILL.md',name:'tables/SKILL.md',description:''}]);
 assert.equal(calls.filter(x=>x.args.actions[0].read_instruction).length,4);
 assert(result.preparationId);
 // Deferred bodies remain available through the same scoped operation, on demand.
 const skillOperation=await router.call('get_project_operations',{projectId:'p',operationId:'data_agent_instructions_tool.read_instruction'});
 assert.equal(skillOperation.permission,'agent_instructions:read');
 await router.call('read_webflow',request(skillOperation.id,{path:result.skills[0].path,resolve_references:false}));
 assert.equal(calls.at(-1).args.actions[0].read_instruction.path,'charts/SKILL.md');
 grant(router,{'agent_instructions:read':false});
 await assert.rejects(router.call('read_webflow',request(skillOperation.id,{path:result.skills[0].path})),/Missing project permissions/);
});
test('preparation retries a transient instruction read without skipping rules or exposing payloads',async t=>{
 const {router,store,setIntercept}=fixture(t);grant(router,{});let reads=0;
 setIntercept(async(tool,args)=>{
   if(args.actions[0].search_instructions)return envelope('search_instructions',{instructions:[{path:'rules/example.md'}]});
   if(args.actions[0].read_instruction){
     if(++reads===1)return {content:[{type:'text',text:JSON.stringify({error:{status:503,message:'private provider payload'}})}]};
     return envelope('read_instruction',{markdown:'Synthetic rule'});
   }
 });
 const result=await router.call('prepare_project',{projectId:'p'});
 assert.equal(reads,2);assert.equal(result.instructions.length,1);assert(router.preparations.has(result.preparationId));
 const event=store.data.audit.find(x=>x.event==='preparation_read_retry');
 assert.equal(event.stage,'instruction_read');assert.equal(event.httpStatus,503);
 assert(!JSON.stringify(store.data.audit).includes('private provider payload'));
});
test('preparation retries once and fails closed with safe stage diagnostics',async t=>{
 const {router,store,setIntercept}=fixture(t);grant(router,{});let reads=0;
 setIntercept(async()=>{reads++;throw Object.assign(new Error('secret URL and token'),{code:'ECONNRESET'});});
 await assert.rejects(router.call('prepare_project',{projectId:'p'}),error=>{
   assert.equal(error.feedback.stage,'instruction_search');assert.equal(error.feedback.failureKind,'transport');
   assert(!JSON.stringify(error.feedback).includes('secret'));return true;
 });
 assert.equal(reads,2);assert.equal(router.preparations.size,0);
 const event=store.data.audit.at(-1);assert.equal(event.stage,'instruction_search');assert.equal(event.errorCode,'upstream_failure');
 assert(!JSON.stringify(store.data.audit).includes('secret'));
});
test('authorization, unknown failures and malformed instructions are never retried',async t=>{
 for(const status of [401,403,undefined]){
   const {router,setIntercept,calls}=fixture(t);grant(router,{});
   setIntercept(async()=>{throw Object.assign(new Error('private'),{status});});
   await assert.rejects(router.call('prepare_project',{projectId:'p'}));
   assert.equal(calls.length,1);assert.equal(router.preparations.size,0);
 }
 const {router,setIntercept,calls}=fixture(t);grant(router,{});
 setIntercept(async()=>envelope('search_instructions',{instructions:[{}]}));
 await assert.rejects(router.call('prepare_project',{projectId:'p'}));
 assert.equal(calls.length,1);assert.equal(router.preparations.size,0);
});
test('transient operation failures never retry writes',async t=>{
 const {router,setIntercept,calls}=fixture(t);grant(router,{'cms:write':true});
 const {preparationId}=await router.call('prepare_project',{projectId:'p'});
 setIntercept(async(tool,args)=>{if(args.actions[0].create_collection_items)throw Object.assign(new Error('private'),{status:503});});
 await assert.rejects(router.call('write_webflow',request('data_cms_tool.create_collection_items',{collection_id:'owned-collection',request:{fieldData:[{name:'Synthetic',slug:'synthetic'}]}},{preparationId})),error=>error.feedback.stage==='operation_call');
 assert.equal(calls.filter(x=>x.args.actions[0].create_collection_items).length,1);
});
test('preparation rechecks revoked policy before retrying',async t=>{
 const {router,setIntercept,calls}=fixture(t);grant(router,{});
 setIntercept(async()=>{
   grant(router,{'agent_instructions:read':false});
   throw Object.assign(new Error('private'),{status:503});
 });
 await assert.rejects(router.call('prepare_project',{projectId:'p'}),/Project policy changed/);
 assert.equal(calls.length,1);assert.equal(router.preparations.size,0);
});
test('guidance failures identify tool discovery and retain the selected grant on retry',async t=>{
 const {router,store}=fixture(t);grant(router,{});const channels=[];let lists=0;
 const connection=store.connection(store.data.projects.p.connectionId);
 connection.beta={tokens:{access_token:'synthetic-beta'},sites:connection.sites};
 router.edit('projects','p',{channel:'beta'});
 router.open=async provider=>{
   channels.push(provider.channel);
   return {listSites:async()=>[{id:site}],close:async()=>{},listTools:async()=>{
     lists++;throw Object.assign(new Error('private'),{status:503});
   }};
 };
 await assert.rejects(router.call('get_project_guidance',{projectId:'p'}),error=>error.feedback.stage==='tool_discovery');
 assert.equal(lists,2);assert.deepEqual(channels,['beta']);
 assert.equal(store.data.audit.at(-1).operationId,'get_project_guidance');
});
test('all pinned action schemas compile; expected classifications are explicit',()=>{
 const ajv=new Ajv({strict:false,validateFormats:false});CATALOG.forEach(op=>ajv.compile(op.schema));
 assert.equal(operation('data_agent_instructions_tool.read_instruction').mode,'read');
 assert.equal(operation('data_sites_tool.publish_site').mode,'publish');
 assert.equal(operation('data_cms_tool.delete_collection_items').mode,'delete');
 assert(!CATALOG.some(o=>o.action==='list_sites'));
});
test('legacy projects keep only site metadata; unknown permissions and operations denied',async t=>{
 const {router,store,calls}=fixture(t);
 assert.deepEqual(permissions(store.data.projects.p),{'site:read':true});
 await assert.rejects(router.call('read_webflow',request('data_pages_tool.list_pages')),/permission/);
 assert.throws(()=>grant(router,{'everything:write':true}),/Invalid/);
 await assert.rejects(router.call('write_webflow',request('arbitrary.execute')),/Unknown/);
 assert.equal(calls.length,0);
});
test('scoped read injects site and rejects override, mixed actions and write via read entry',async t=>{
 const {router,calls}=fixture(t);grant(router,{'pages:read':true,'pages:write':true});
 await router.call('read_webflow',request('data_pages_tool.list_pages'));
 assert.equal(calls.at(-1).args.actions[0].list_pages.site_id,site);
 await assert.rejects(router.call('read_webflow',request('data_pages_tool.list_pages',{site_id:other})),/Cross-project/);
 await assert.rejects(router.call('read_webflow',request('data_pages_tool.create_page',{title:'x',slug:'x'})),/Use write_webflow/);
 await assert.rejects(router.call('read_webflow',request('data_pages_tool.list_pages',{actions:[{delete_branch:{}}]})),/schema/);
});
test('CMS write requires preparation, resource ownership, and separate delete/publish grants',async t=>{
 const {router,calls}=fixture(t);grant(router,{'cms:write':true});
 const params={collection_id:'owned-collection',request:{fieldData:[{name:'Draft',slug:'draft'}]}};
 await assert.rejects(router.call('write_webflow',request('data_cms_tool.create_collection_items',params)),/prepare_project/);
 const {preparationId}=await router.call('prepare_project',{projectId:'p'});
 await router.call('write_webflow',request('data_cms_tool.create_collection_items',params,{preparationId}));
 assert.equal(calls.at(-1).tool,'data_cms_tool');
 await assert.rejects(router.call('write_webflow',request('data_cms_tool.create_collection_items',{...params,collection_id:'foreign'},{preparationId})),/does not belong/);
 for(const action of ['publish_collection_items','delete_collection_items'])await assert.rejects(router.call('write_webflow',request('data_cms_tool.'+action,{}, {preparationId})),/permission/);
});
test('page and asset resource overrides are rejected before writes',async t=>{
 const {router}=fixture(t);grant(router,{'pages:write':true,'assets:write':true});
 const {preparationId}=await router.call('prepare_project',{projectId:'p'});
 await assert.rejects(router.call('write_webflow',request('data_pages_tool.update_page_settings',{page_id:'foreign',title:'x'},{preparationId})),/does not belong/);
 await assert.rejects(router.call('write_webflow',request('data_assets_tool.update_asset',{asset_id:'foreign',alt_text:'x'},{preparationId})),/does not belong/);
});
test('permission change invalidates preparation and stops queued work',async t=>{
 const {router}=fixture(t);grant(router,{'pages:write':true});
 const {preparationId}=await router.call('prepare_project',{projectId:'p'});
 grant(router,{'pages:write':true,'pages:read':true});
 await assert.rejects(router.call('write_webflow',request('data_pages_tool.create_page',{title:'x',slug:'x'},{preparationId})),/prepare_project/);
});
test('revocation during ownership preflight prevents dispatch; in-flight reads withhold data',async t=>{
 const {router,calls,setIntercept}=fixture(t);grant(router,{'cms:write':true});
 const {preparationId}=await router.call('prepare_project',{projectId:'p'});
 setIntercept(async(tool,args)=>{if(args.actions?.[0].get_collection_list)grant(router,{});});
 await assert.rejects(router.call('write_webflow',request('data_cms_tool.create_collection_items',{collection_id:'owned-collection',request:{fieldData:[{name:'Draft',slug:'draft'}]}},{preparationId})),/policy changed/);
 assert(!calls.some(c=>c.args.actions?.[0].create_collection_items));
 grant(router,{'pages:read':true});setIntercept(async()=>grant(router,{}));
 await assert.rejects(router.call('read_webflow',request('data_pages_tool.list_pages')),/policy changed/);
});
test('design edits require explicit custom-code permission too',async t=>{
 const {router,calls}=fixture(t);grant(router,{'element:write':true});
 const expected='Missing project permissions: Custom code → Write. Ask the user to enable these in MCP Router using the sliders button next to the project, then save changes.';
 await assert.rejects(router.call('write_webflow',request('data_element_tool.set_text',{}, {pageId:'owned-page'})),{message:expected});
 await assert.rejects(router.call('get_project_operations',{projectId:'p',operationId:'data_element_tool.set_text'}),{message:expected});
 assert.equal(calls.length,0);
});
test('permission errors list only missing grants and discovery remains filtered',async t=>{
 const {router,calls}=fixture(t);
 grant(router,{'element:write':true,'agent_instructions:read':false});
 await assert.rejects(router.call('write_webflow',request('data_element_tool.set_text')),/Missing project permissions: Custom code → Write, Instructions → Read\./);
 grant(router,{});
 for(const [action,mode] of [['publish_collection_items','Publish'],['delete_collection_items','Delete']]) {
   await assert.rejects(router.call('write_webflow',request('data_cms_tool.'+action)),new RegExp(`Missing project permissions: CMS → ${mode}\\.`));
 }
 const operations=await router.call('get_project_operations',{projectId:'p'});
 assert(!operations.some(op=>op.id==='data_element_tool.set_text'));
 await assert.rejects(router.call('get_project_operations',{projectId:'p',operationId:'unknown.operation'}),/Unknown operation/);
 await assert.rejects(router.call('read_webflow',request('data_pages_tool.list_pages')),/Missing project permissions: Pages → Read\./);
 grant(router,{'pages:read':true});
 await assert.rejects(router.call('write_webflow',request('data_pages_tool.list_pages')),/Use read_webflow/);
 assert.equal(calls.length,0);
});
test('publish is independently granted and dispatched only to the project site',async t=>{
 const {router,calls}=fixture(t);grant(router,{'site:publish':true});
 const {preparationId}=await router.call('prepare_project',{projectId:'p'});
 await router.call('write_webflow',request('data_sites_tool.publish_site',{publishToWebflowSubdomain:true},{preparationId}));
 assert.equal(calls.at(-1).args.actions[0].publish_site.site_id,site);
});
test('delete permission does not grant write and preparation expires',async t=>{
 const {router}=fixture(t);grant(router,{'assets:delete':true});
 const {preparationId}=await router.call('prepare_project',{projectId:'p'});
 await router.call('write_webflow',request('data_assets_tool.delete_asset',{asset_id:'owned-asset'},{preparationId}));
 await assert.rejects(router.call('write_webflow',request('data_assets_tool.update_asset',{asset_id:'owned-asset'},{preparationId})),/permission/);
 router.preparations.get(preparationId).expires=0;
 await assert.rejects(router.call('write_webflow',request('data_assets_tool.delete_asset',{asset_id:'owned-asset'},{preparationId})),/prepare_project/);
});

test('instruction preparation cannot bypass an absent instruction-read grant',async t=>{const {router,calls}=fixture(t);await assert.rejects(router.call('prepare_project',{projectId:'p'}),/Missing project permissions: Instructions → Read/);assert.equal(calls.length,0);});

test('live guidance stays scoped to the selected grant and current permissions',async t=>{
 const {router,store}=fixture(t);let fail=false, authorized=true, revoke=false;
 const opened=[];
 router.open=async provider=>{
   opened.push(provider.channel);
   if(fail)throw new Error('Synthetic upstream failure');
   return {
     instructions:`${provider.channel} instructions`,guide:{content:[]},close:async()=>{},
     listSites:async()=>authorized?[{id:site}]:[],
     listTools:async()=>{
       if(revoke)grant(router,{'agent_instructions:read':false});
       return [{name:'data_sites_tool',description:'Live site guidance'},{name:'unknown_tool',description:'Not reviewed'}];
     }
   };
 };
 await assert.rejects(router.call('get_project_guidance',{projectId:'p'}),/Missing project permissions: Instructions → Read/);
 assert.deepEqual(await router.call('get_agent_context'),{contexts:[]});
 assert.equal(opened.length,0);
 grant(router,{});
 const stable=await router.call('get_project_guidance',{projectId:'p'});
 assert.equal(stable.instructions,'stable instructions');
 assert.equal(stable.tools.length,1);
 assert(!stable.tools[0].operationIds.includes('data_sites_tool.list_sites'));
 store.connection(store.data.projects.p.connectionId).beta={tokens:{access_token:'synthetic-beta'}};
 router.edit('projects','p',{channel:'beta'});
 assert.equal((await router.call('get_project_guidance',{projectId:'p'})).instructions,'beta instructions');
 authorized=false;
 await assert.rejects(router.call('get_project_guidance',{projectId:'p'}));
 authorized=true;fail=true;opened.length=0;
 assert.deepEqual(await router.call('get_agent_context'),{contexts:[]});
 assert.deepEqual(opened,['beta']);
 fail=false;revoke=true;
 await assert.rejects(router.call('get_project_guidance',{projectId:'p'}),/policy changed/);
});
