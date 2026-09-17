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
   calls.push({tool,args});await intercept(tool,args);
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
 await assert.rejects(router.call('read_webflow',request('data_pages_tool.create_page',{title:'x',slug:'x'})),/permission/);
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
 const {router}=fixture(t);grant(router,{'element:write':true});
 await assert.rejects(router.call('write_webflow',request('data_element_tool.set_text',{}, {pageId:'owned-page'})),/permission/);
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

test('instruction preparation cannot bypass an absent instruction-read grant',async t=>{const {router,calls}=fixture(t);await assert.rejects(router.call('prepare_project',{projectId:'p'}),/Instruction read permission/);assert.equal(calls.length,0);});

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
 await assert.rejects(router.call('get_project_guidance',{projectId:'p'}),/Instruction read permission/);
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
