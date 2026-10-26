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
 const router=new Router(store,{provider:(id,interactive,channel)=>({id,channel})},{open:async()=>({listSites:async()=>[{id:site}],guide:{content:[]},close:async()=>{},call:async(tool,args)=>{
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

for(const channel of ['stable','beta'])test(`${channel} analytics are permission-gated and project-bound`,async t=>{
 const {router,store,calls}=fixture(t);grant(router,{'analyze:read':true});
 const ids=['get_browser_window_height_report','get_goal_performance','get_page_flow_report','get_scroll_depth_report','list_goals'].map(action=>'data_analyze_tool.'+action);
 router.edit('projects','p',{channel});
 const connection=store.connection(router.project('p',null).connectionId);
 connection.beta={tokens:{access_token:'synthetic-beta'},sites:[{id:site}]};
 router.open=async provider=>{assert.equal(provider.channel,channel);return {listSites:async()=>[{id:site}],close:async()=>{},call:async(tool,args)=>{
  calls.push({tool,args});const action=Object.keys(args.actions[0]).find(k=>k!=='label');
  if(action==='list_pages')return envelope(action,{pages:[{id:'owned-page'}],pagination:{total:1}});
  if(action==='get_collection_list')return envelope(action,{collections:[{id:'owned-collection'}]});
  return envelope(action,{ok:true});
 }};};
 for(const id of ids){
  assert((await router.call('get_project_operations',{projectId:'p'})).some(op=>op.id===id));
  const params=id.endsWith('list_goals')?{}:{startTime:'2026-04-01T00:00:00Z',endTime:'2026-04-02T00:00:00Z',...(id.endsWith('get_goal_performance')?{goal_id:'1'}:{}),...(id.endsWith('get_page_flow_report')?{direction:'next',metricScope:'session',pageId:'owned-page',collectionId:'owned-collection',itemSlug:'demo'}:{})};
  await router.call('read_webflow',request(id,params));
  assert.equal(calls.at(-1).args.actions[0][id.split('.')[1]].site_id,site);
  await assert.rejects(router.call('read_webflow',request(id,{...params,site_id:other})),/Cross-project/);
  if(id.endsWith('get_page_flow_report'))await assert.rejects(router.call('read_webflow',request(id,{...params,pageId:'foreign-page'})),/does not belong/);
 }
 grant(router,{'analyze:read':false});
 await assert.rejects(router.call('read_webflow',request(ids[0])),/Missing project permissions/);
});

test('localized CMS creation and publishing preserve separate grants and collection ownership',async t=>{
 const {router,calls}=fixture(t);grant(router,{'cms:write':true});
 const {preparationId}=await router.call('prepare_project',{projectId:'p'});
 const params={collection_id:'owned-collection',request:{items:[{allCmsLocales:true,fieldData:{name:'Demo',slug:'demo'}}]}};
 await router.call('write_webflow',request('data_cms_tool.create_collection_items',params,{preparationId}));
 assert.deepEqual(calls.at(-1).args.actions[0].create_collection_items,params);
 await assert.rejects(router.call('write_webflow',request('data_cms_tool.create_collection_items',{...params,collection_id:'foreign'},{preparationId})),/does not belong/);
 const publish={collection_id:'owned-collection',request:{items:[{id:'demo-item',cmsLocaleIds:['demo-locale']}]}};
 await assert.rejects(router.call('write_webflow',request('data_cms_tool.publish_collection_items',publish,{preparationId})),/Missing project permissions/);
 grant(router,{'cms:publish':true});
 const proof=await router.call('prepare_project',{projectId:'p'});
 await router.call('write_webflow',request('data_cms_tool.publish_collection_items',publish,{preparationId:proof.preparationId}));
 assert.deepEqual(calls.at(-1).args.actions[0].publish_collection_items,publish);
});

test('popover component properties retain canvas code permission requirements',async t=>{
 const {router,calls}=fixture(t);grant(router,{'component_props:write':true});
 const params={component_id:'synthetic-component',props:[{type:'link',name:'Open details',default_link:{mode:'popover',popover_action:'show'}}]};
 const op=operation('data_component_props_tool.create_prop');
 assert.doesNotThrow(()=>prepareArguments(op,params,site,'owned-page'));
 await assert.rejects(router.call('write_webflow',request(op.id,params,{pageId:'owned-page'})),/Custom code/);
 grant(router,{'component_props:write':true,'scripts:write':true});
 const {preparationId}=await router.call('prepare_project',{projectId:'p'});
 await router.call('write_webflow',request(op.id,params,{pageId:'owned-page',preparationId}));
 assert.deepEqual(calls.at(-1).args.actions[0].create_prop,params);
});

test('CMS creation accepts custom fields only inside fieldData for both request formats',async t=>{
 const {router,calls}=fixture(t);grant(router,{'cms:write':true});
 const {preparationId}=await router.call('prepare_project',{projectId:'p'});
 const op=operation('data_cms_tool.create_collection_items');
 const fieldData={name:'Demo',slug:'demo',custom_text:'Retain me',custom_number:2,custom_toggle:false,custom_array:['one','two']};
 for(const body of [{items:[{isDraft:true,fieldData}]},{fieldData:[fieldData],isDraft:true}]){
  const params={collection_id:'owned-collection',request:body};
  await router.call('write_webflow',request(op.id,params,{preparationId}));
  assert.deepEqual(calls.at(-1).args.actions[0].create_collection_items,params);
  assert.throws(()=>prepareArguments(op,{...params,unreviewed_target:'foreign'},site),/schema/);
  assert.throws(()=>prepareArguments(op,{...params,request:{...body,unreviewed_target:'foreign'}},site),/schema/);
 }
 for(const fieldData of [{name:'Missing slug'},{name:12,slug:'invalid'}])assert.throws(()=>prepareArguments(op,{collection_id:'owned-collection',request:{items:[{fieldData}]}},site),/schema/);
 assert.throws(()=>prepareArguments(op,{collection_id:'owned-collection',request:{items:[{fieldData,unreviewed_target:'foreign'}]}},site),/schema/);
 grant(router,{'cms:write':false});
 await assert.rejects(router.call('write_webflow',request(op.id,{collection_id:'owned-collection',request:{items:[{fieldData}]}},{preparationId})),/Missing project permissions/);
});

test('site Releases use distinct permissions, verify ownership and stay unavailable on Stable',async t=>{
 const {router,store,calls}=fixture(t);
 const actions={list_site_branches:'read',create_site_branch:'write',stage_site_branch:'publish',discard_site_branch:'delete',get_site_branch_freshness:'read',update_site_branch_details:'write'};
 grant(router,{'pages:read':true,'pages:write':true,'pages:publish':true,'pages:delete':true});
 for(const [action,mode] of Object.entries(actions)){
  const id='data_pages_tool.'+action;
  assert.equal(operation(id).permission,'pages:'+mode);
  await assert.rejects(router.call('get_project_operations',{projectId:'p',operationId:id}),/selected MCP channel/);
  await assert.rejects(router.call(mode==='read'?'read_webflow':'write_webflow',request(id)),/selected MCP channel/);
 }
 const connection=store.connection(router.project('p',null).connectionId);
 connection.beta={tokens:{access_token:'synthetic-beta'},sites:[{id:site}]};
 router.edit('projects','p',{channel:'beta'});
 let branchResult={branches:[{id:'owned-release'}]}, revoke=false;
 router.open=async provider=>{assert.equal(provider.channel,'beta');return {listSites:async()=>[{id:site}],close:async()=>{},call:async(tool,args)=>{
  calls.push({tool,args});const action=Object.keys(args.actions[0]).find(k=>k!=='label');
  if(action==='search_instructions')return envelope(action,{instructions:[]});
  if(action==='list_site_branches'){
   if(revoke)grant(router,{'pages:write':false});
   return envelope(action,branchResult);
  }
  if(action==='list_pages')return envelope(action,{pages:[{id:'owned-page'}],pagination:{total:1}});
  return envelope(action,{ok:true});
 }};};
 const {preparationId}=await router.call('prepare_project',{projectId:'p'});
 for(const [action,mode] of Object.entries(actions)){
  const id='data_pages_tool.'+action;
  const params=action==='list_site_branches'?{}:action==='create_site_branch'?{name:'Synthetic Release',origin_page_id:'owned-page'}:{site_branch_id:'owned-release'};
  await router.call(mode==='read'?'read_webflow':'write_webflow',request(id,params,mode==='read'?{}:{preparationId}));
  assert.equal(calls.at(-1).args.actions[0][action].site_id,site);
  await assert.rejects(router.call(mode==='read'?'read_webflow':'write_webflow',request(id,{...params,site_id:other},mode==='read'?{}:{preparationId})),/Cross-project/);
 }
 await router.call('read_webflow',request('data_pages_tool.list_pages',{site_branch_id:'owned-release'}));
 assert.equal(calls.at(-1).args.actions[0].list_pages.site_branch_id,'owned-release');
 await assert.rejects(router.call('read_webflow',request('data_pages_tool.list_pages',{site_branch_id:'foreign'})),/does not belong/);
 const pageId='data_pages_tool.create_page', page={title:'Synthetic',slug:'synthetic',draft:true,site_branch_id:'owned-release'};
 const betaSchema=(await router.call('get_project_operations',{projectId:'p',operationId:pageId})).schema;
 assert(betaSchema.properties.site_branch_id);
 await router.call('write_webflow',request(pageId,page,{preparationId}));
 for(const action of ['stage_site_branch','discard_site_branch','create_page']){
  const params=action==='create_page'?{...page,site_branch_id:'foreign'}:{site_branch_id:'foreign'};
  await assert.rejects(router.call('write_webflow',request('data_pages_tool.'+action,params,{preparationId})),/does not belong/);
 }
 await assert.rejects(router.call('write_webflow',request('data_pages_tool.create_site_branch',{name:'Synthetic',origin_page_id:'foreign'},{preparationId})),/does not belong/);
 branchResult={unexpected:[]};
 await assert.rejects(router.call('write_webflow',request(pageId,page,{preparationId})),error=>error.feedback.stage==='resource_ownership');
 branchResult={branches:[{id:'owned-release'}]};revoke=true;
 await assert.rejects(router.call('write_webflow',request(pageId,page,{preparationId})),/policy changed/);
 for(const [action,mode] of Object.entries(actions)){
  grant(router,{['pages:'+mode]:false});
  await assert.rejects(router.call(mode==='read'?'read_webflow':'write_webflow',request('data_pages_tool.'+action,{},mode==='read'?{}:{preparationId})),/Missing project permissions/);
 }
 router.edit('projects','p',{channel:'stable'});grant(router,{'pages:write':true});
 assert(!(await router.call('get_project_operations',{projectId:'p',operationId:pageId})).schema.properties.site_branch_id);
 assert.throws(()=>prepareArguments(operation('data_pages_tool.list_pages'),{site_branch_id:'owned-release'},site),/schema/);
 // Compiling the Beta schema first must not pollute Stable validation.
 assert.throws(()=>prepareArguments(operation(pageId),page,site),/schema/);
 assert.doesNotThrow(()=>prepareArguments(operation(pageId),{title:'Synthetic',slug:'synthetic'},site));
});

for(const channel of ['stable','beta'])test(`${channel} AEO and recommendation reads enforce grants, site scope and channel`,async t=>{
 const {router,store,calls,setIntercept}=fixture(t);
 setIntercept(async(tool,args)=>{if(args.actions?.[0]?.list_pages)return envelope('list_pages',{pages:[{id:'333333333333333333333333'}],pagination:{total:1}});});
 router.edit('projects','p',{channel});
 store.connection(router.project('p',null).connectionId).beta={tokens:{access_token:'synthetic-beta'},sites:[{id:site}]};
 const ops=CATALOG.filter(op=>['data_aeo_tool','data_recommendations_tool'].includes(op.tool)&&op.mode==='read');
 assert.equal(ops.length,19);
 const sample={startTime:'2026-04-01T00:00:00Z',endTime:'2026-04-02T00:00:00Z',breakdown:'prompt',domain:'example.com',pageId:'333333333333333333333333',executionId:'111111111111111111111111',recommendationId:'222222222222222222222222'};
 for(const op of ops){
  grant(router,{'analyze:read':true});
  const params=Object.fromEntries((op.schema.required||[]).filter(k=>k!=='site_id').map(k=>[k,sample[k]]));
  if(channel==='stable'&&op.channels){
   await assert.rejects(router.call('read_webflow',request(op.id,params)),/selected MCP channel/);
   assert(!(await router.call('get_project_operations',{projectId:'p'})).some(x=>x.id===op.id));
   continue;
  }
  grant(router,{'analyze:read':false});
  const before=calls.length;
  await assert.rejects(router.call('read_webflow',request(op.id,params)),/Missing project permissions/);
  assert.equal(calls.length,before);
  grant(router,{'analyze:read':true});
  await router.call('read_webflow',request(op.id,params));
  if(op.schema.properties.site_id){
   assert.equal(calls.at(-1).args.actions[0][op.action].site_id,site);
   await assert.rejects(router.call('read_webflow',request(op.id,{...params,site_id:other})),/Cross-project/);
  }
  if(op.schema.properties.pageId)await assert.rejects(router.call('read_webflow',request(op.id,{...params,pageId:'444444444444444444444444'})),/does not belong/);
  if(op.schema.properties.collectionId)await assert.rejects(router.call('read_webflow',request(op.id,{...params,collectionId:'555555555555555555555555',itemSlug:'demo'})),/does not belong/);
  await assert.rejects(router.call('read_webflow',request(op.id,{...params,actions:[{update_recommendation_settings:{recurringAuditsEnabled:true}}]})),/schema/);
 }
 assert.equal(operation('data_recommendations_tool.update_recommendation_settings').permission,'recommendations:write');
 assert(!(await router.call('get_project_operations',{projectId:'p'})).some(op=>op.id==='data_optimize_tool.list_optimize_resources'));
});

test('GSAP operations require explicit grants, preparation on both reviewed channels',async t=>{
 const {router,store,calls}=fixture(t);
 const id='data_interactions_tool.guide';
 grant(router,{});
 assert(!(await router.call('get_project_operations',{projectId:'p'})).some(op=>op.id===id));
 await assert.rejects(router.call('read_webflow',request(id,{}, {pageId:'owned-page'})),/Missing project permissions/);
 grant(router,{'interactions:read':true,'interactions:write':true});
 await router.call('read_webflow',request(id,{}, {pageId:'owned-page'}));
 assert.equal(calls.at(-1).args.siteId,site);
 assert.equal(calls.at(-1).args.pageId,'owned-page');
 await assert.rejects(router.call('write_webflow',request('data_interactions_tool.update_interaction',{id:'owned-interaction'}, {pageId:'owned-page'})),/Custom code/);
 grant(router,{'interactions:write':true,'scripts:write':true});
 await assert.rejects(router.call('write_webflow',request('data_interactions_tool.update_interaction',{id:'owned-interaction'}, {pageId:'owned-page'})),/prepare_project/);
 await assert.rejects(router.call('write_webflow',request('data_interactions_tool.delete_interaction',{id:'owned-interaction'}, {pageId:'owned-page'})),/Missing project permissions/);
 const p=store.data.projects.p;p.channel='beta';const c=store.connection(p.connectionId);c.beta={tokens:{access_token:'fake-beta'},sites:[{id:site}]};
 grant(router,{'interactions:read':true});
 assert.equal((await router.call('get_project_operations',{projectId:'p',operationId:id})).id,id);
});

test('GSAP validates interaction IDs, scope pages, filters and nested instance/component targets',async t=>{
 const {router,calls,setIntercept}=fixture(t);
 grant(router,{'interactions:read':true,'interactions:write':true,'interactions:delete':true,'scripts:write':true});
 setIntercept(async(tool,args)=>{
  if(args.actions[0].list_interactions)return envelope('list_interactions',{interactions:[{id:'owned-interaction'}],pagination:{total:1}});
  if(args.actions[0].get_all_components)return envelope('get_all_components',{components:[{id:'owned-component'}]});
 });
 const {preparationId}=await router.call('prepare_project',{projectId:'p'});
 const extra={pageId:'owned-page',preparationId};
 const create={name:'Synthetic fade',scope:{type:'pages',value:['owned-page']},triggers:[{extensionKey:'wf:load'}],timelines:[{actions:[{id:'fade',name:'Fade',targets:[{extensionKey:'wf:inst',value:['owned-page','element']}],timing:{duration:0.4},properties:{'wf:transform':{opacity:['0%','100%']}}}]}]};
 await router.call('write_webflow',request('data_interactions_tool.create_interaction',create,extra));
 assert.deepEqual(calls.at(-1).args.actions[0].create_interaction,create);
 const foreign=structuredClone(create);foreign.timelines[0].actions[0].targets[0].value[0]='foreign-page';
 await assert.rejects(router.call('write_webflow',request('data_interactions_tool.create_interaction',foreign,extra)));
 for(const action of ['get_interaction','update_interaction','delete_interaction']) {
  const mode=action==='get_interaction'?'read_webflow':'write_webflow';
  await router.call(mode,request('data_interactions_tool.'+action,{id:'owned-interaction'},action==='get_interaction'?{pageId:'owned-page'}:extra));
  const before=calls.filter(c=>c.args.actions[0][action]).length;
  await assert.rejects(router.call(mode,request('data_interactions_tool.'+action,{id:'foreign-interaction'},action==='get_interaction'?{pageId:'owned-page'}:extra)));
  assert.equal(calls.filter(c=>c.args.actions[0][action]).length,before);
 }
 await assert.rejects(router.call('read_webflow',request('data_interactions_tool.list_interactions',{visibleOnPageId:'foreign-page'},{pageId:'owned-page'})));
 const update=params=>router.call('write_webflow',request('data_interactions_tool.update_interaction',{id:'owned-interaction',...params},extra));
 await update({scope:{type:'pages',value:['owned-page']}});
 await update({scope:{type:'component',componentId:'owned-component'}});
 const trigger=id=>({triggers:[{extensionKey:'wf:click',target:{extensionKey:'wf:inst',value:[id,'element']}}]});
 await update(trigger('owned-page'));await update(trigger('owned-component'));
 for(const params of [{scope:{type:'pages',value:['foreign-page']}},{scope:{type:'component',componentId:'foreign-component'}},{scope:{type:'site',libraryProfileId:'foreign-library'}},trigger('foreign-page')]) {
  const before=calls.filter(c=>c.args.actions[0].update_interaction).length;
  await assert.rejects(update(params));
  assert.equal(calls.filter(c=>c.args.actions[0].update_interaction).length,before);
 }
});

test('GSAP ownership reads every interaction page and rejects incomplete or malformed listings',async t=>{
 const {router,setIntercept,calls}=fixture(t);grant(router,{'interactions:read':true});
 setIntercept(async(tool,args)=>{
  if(args.actions[0].list_interactions){const {offset}=args.actions[0].list_interactions;
   assert.equal(args.siteId,site);assert.equal(args.pageId,'owned-page');
   return envelope('list_interactions',{interactions:offset?[{id:'last-interaction'}]:Array.from({length:200},(_,i)=>({id:`interaction-${i}`})),pagination:{total:201}});
  }
 });
 await router.call('read_webflow',request('data_interactions_tool.get_interaction',{id:'last-interaction'},{pageId:'owned-page'}));
 assert.deepEqual(calls.filter(c=>c.args.actions[0].list_interactions).map(c=>c.args.actions[0].list_interactions.offset),[0,200]);
 for(const result of [{interactions:[],pagination:{hasMore:true}},{interactions:[{id:'last-interaction'}],pagination:{nextCursor:'more'}},{unknown:[]}]) {
  setIntercept(async(tool,args)=>args.actions[0].list_interactions?envelope('list_interactions',result):undefined);
  await assert.rejects(router.call('read_webflow',request('data_interactions_tool.get_interaction',{id:'last-interaction'},{pageId:'owned-page'})));
 }
});


test('Beta slot dispatch rejects Stable and withheld permissions before reaching upstream mutations',async t=>{
 const {router,store,calls,setIntercept}=fixture(t);
 const id='data_component_props_tool.clear_slot';
 grant(router,{'component_props:delete':true,'scripts:write':true});
 await assert.rejects(router.call('get_project_operations',{projectId:'p',operationId:id}),/selected MCP channel/);
 const connection=store.connection(router.project('p',null).connectionId);
 connection.beta={tokens:{access_token:'synthetic-beta'},sites:[{id:site}]};router.edit('projects','p',{channel:'beta'});
 setIntercept(async(tool,args)=>{
  const action=Object.keys(args.actions?.[0]||{}).find(k=>k!=='label');
  if(action==='get_all_components')return envelope(action,{components:[{id:'owned-component',props:[]}]});
  if(action==='get_all_elements')return envelope(action,{elements:[{id:{component:'owned-component',element:'instance'}}]});
 });
 const {preparationId}=await router.call('prepare_project',{projectId:'p'});
 const params={element_id:{component:'owned-component',element:'instance'},slot_name:'Content'};
 const args=request(id,params,{pageId:'owned-page',preparationId});
 await router.call('write_webflow',args);assert(calls.at(-1).args.actions[0].clear_slot);
 const count=()=>calls.filter(c=>c.args.actions?.[0]?.clear_slot).length;
 const before=count();
 await assert.rejects(router.call('write_webflow',{...args,params:{...params,element_id:{component:'foreign',element:'instance'}}}),/does not belong/);
 grant(router,{'component_props:delete':false});await assert.rejects(router.call('write_webflow',args),/Missing project permissions/);
 assert.equal(count(),before);
});
