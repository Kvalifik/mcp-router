import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { Store } from '../src/store.js';
import { Router } from '../src/router.js';
import { CATALOG, PERMISSIONS, GROUPS, operation, prepareArguments } from '../src/permissions.js';
const envelope=(action,result)=>({content:[{type:'text',text:JSON.stringify({action,result})}]});
function fixture(t) {
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'router-families-'));t.after(()=>fs.rmSync(dir,{recursive:true,force:true}));
 const store=new Store(dir),calls=[];let intercept=()=>undefined;
 const router=new Router(store,{provider:(id,interactive,channel)=>({id,channel})},{open:async()=>({guide:{content:[]},listSites:async()=>{await intercept('listSites',null,{});return [{id:'site'}];},close:async()=>{},call:async(tool,args)=>{
  const action=Object.keys(args.actions[0]).find(k=>k!=='label');const params=args.actions[0][action];calls.push({tool,action,params,args});
  const custom=await intercept(tool,action,params);if(custom!==undefined)return custom;
  const responses={
   search_instructions:{instructions:[],pagination:{total:0}},
   get_site:{id:params.site_id,workspaceId:params.site_id==='foreign-site'?'other-workspace':'workspace'},
   list_pages:{pages:[{id:'page'}],pagination:{total:1}},
   list_assets:{assets:[{id:'asset'}],pagination:{total:1}},
   list_apps:{apps:[{id:'app',siteId:'site',siteAttached:true}],nextCursor:null},
   list_environments:{environments:[{id:'environment'}],nextCursor:null},
   list_deployments:{deployments:[{id:'deployment'}],nextCursor:null},
   get_campaign:{id:'campaign',siteId:'site',landingPage:{pageId:'page'}},
   get_page_variations:{variations:[{pageVariationId:'variation'}],fields:[{fieldSlug:'headline'}],hasMore:false,nextOffset:null},
   get_page_variation_suggestions:{suggestions:[{pageVariationSuggestionId:'suggestion'}]},
   list_campaign_hub_sites:{campaignSites:[{id:'site',name:'Example'},{id:'foreign-site',name:'Private sibling'}]},
   list_site_members:{members:[{id:'member'}],pagination:{nextCursor:null}},
   list_workspace_members:{members:[{id:'member'}],invites:[{id:'invite'}],pagination:{nextCursor:null}},
   list_site_roles:{roles:[]},
   list_optimize_resources:{references:[{optimizeId:'optimize',resource:{type:'webflow-site',siteId:'site'}},{optimizeId:'other',resource:{type:'webflow-site',siteId:'foreign-site'}}]},
   list_optimizations:{optimizations:[{optimizationId:'optimization'}],nextCursor:null}
  };
  return envelope(action,responses[action]||{ok:true});
 }})});
 const connectionId=router.createConnection('Synthetic');const c=store.connection(connectionId);c.tokens={access_token:'synthetic'};c.sites=[{id:'site',name:'Example',workspaceId:'workspace'}];
 router.saveProject({id:'project',name:'Example',connectionId,siteId:'site',enabled:true});
 const grant=keys=>router.edit('projects','project',{permissions:{'site:read':true,'agent_instructions:read':true,...Object.fromEntries(keys.map(k=>[k,true]))}});
 const workspace=grants=>router.edit('connections',connectionId,{workspacePermissions:{workspace:grants}});
 const read=(action,params={})=>router.call('read_webflow',{projectId:'project',operationId:action,params});
 const write=async(action,params={})=>{const {preparationId}=await router.call('prepare_project',{projectId:'project'});return router.call('write_webflow',{projectId:'project',operationId:action,params,preparationId});};
 return {router,store,c,calls,grant,workspace,read,write,setIntercept:fn=>intercept=fn};
}

test('all 56 reviewed actions are classified on both channels, and workspace grants stay out of project presets',()=>{
 const tools=['data_apps_tool','data_campaigns_tool','data_members_tool','data_optimize_tool'];
 const ops=CATALOG.filter(op=>tools.includes(op.tool)&&!op.upstreamAlias);assert.equal(ops.length,56);
 assert(ops.every(op=>op.channels.includes('stable')&&op.channels.includes('beta')));
 assert(!PERMISSIONS.some(k=>k.startsWith('workspace_members:')));assert(!GROUPS.some(g=>g.area==='workspace_members'));
 assert(ops.filter(op=>op.mode!=='read').every(op=>op.extraPermissions.includes('agent_instructions:read')));
 assert.equal(operation('data_apps_tool.redeploy').mode,'publish');
 assert(operation('data_apps_tool.create_app').extraPermissions.includes('apps:publish'));
 assert(operation('data_apps_tool.delete_app').extraPermissions.includes('apps:publish'));
 assert.equal(operation('data_apps_tool.get_runtime_logs').permission,'app_data:read');
 assert.equal(operation('data_members_tool.revoke_site_access').mode,'delete');
 assert.equal(operation('data_members_tool.remove_workspace_member').scope,'workspace');
});

test('Cloud Apps pin creation/listing to the project and enforce environment/deployment chains',async t=>{
 const f=fixture(t);f.grant(['apps:read','apps:write','apps:publish','scripts:write']);
 await f.write('data_apps_tool.create_app',{name:'Example app',source_url:'https://github.com/example/synthetic',branch:'main'});
 assert.equal(f.calls.at(-1).params.site_id,'site');
 await f.read('data_apps_tool.list_apps');assert.equal(f.calls.at(-1).params.site_id,'site');
 await f.read('data_apps_tool.get_deployment',{app_id:'app',env_id:'environment',deployment_id:'deployment'});
 for(const params of [{app_id:'foreign',env_id:'environment',deployment_id:'deployment'},{app_id:'app',env_id:'foreign',deployment_id:'deployment'},{app_id:'app',env_id:'environment',deployment_id:'foreign'}]) {
  const before=f.calls.filter(c=>c.action==='get_deployment').length;
  await assert.rejects(f.read('data_apps_tool.get_deployment',params));
  assert.equal(f.calls.filter(c=>c.action==='get_deployment').length,before);
 }
 await assert.rejects(f.read('data_apps_tool.list_apps',{site_id:'foreign-site'}));
});

test('Cloud logs, deployment and destructive capabilities cannot be obtained with ordinary app read/write',async t=>{
 const f=fixture(t);f.grant(['apps:read','apps:write','scripts:write']);
 await assert.rejects(f.read('data_apps_tool.get_runtime_logs',{app_id:'app',env_id:'environment'}),/Missing project permissions/);
 await assert.rejects(f.write('data_apps_tool.trigger_deployment',{app_id:'app',env_id:'environment'}),/Missing project permissions/);
 await assert.rejects(f.write('data_apps_tool.delete_app',{app_id:'app'}),/Missing project permissions/);
 f.grant(['app_data:read']);await f.read('data_apps_tool.get_runtime_logs',{app_id:'app',env_id:'environment'});
 f.grant(['apps:publish','scripts:write']);await f.write('data_apps_tool.redeploy',{app_id:'app',env_id:'environment',deployment_id:'deployment',dry_run:true});
});

test('Cloud ownership exhausts cursors, rejects repeated/malformed pages and foreign filtered results',async t=>{
 const f=fixture(t);f.grant(['apps:read']);
 f.setIntercept((tool,action,params)=>action==='list_apps'?envelope(action,params.cursor?{apps:[{id:'app',siteId:'site'}],nextCursor:null}:{apps:[],nextCursor:'next'}):undefined);
 await f.read('data_apps_tool.get_app',{app_id:'app'});
 assert.equal(f.calls.filter(c=>c.action==='list_apps').length,2);
 for(const response of [{apps:[],nextCursor:'repeat'},{apps:[],nextCursor:5},{unexpected:[]}]){
  f.setIntercept((tool,action)=>action==='list_apps'?envelope(action,response):undefined);
  await assert.rejects(f.read('data_apps_tool.get_app',{app_id:'app'}));
 }
 f.setIntercept((tool,action)=>action==='list_apps'?envelope(action,{apps:[{id:'app',siteId:'foreign-site'}]}):undefined);
 await assert.rejects(f.read('data_apps_tool.list_apps'));
});

test('campaign hub discovery verifies workspace and strips sibling data from every response channel',async t=>{
 const f=fixture(t);f.grant(['campaigns:read']);
 const result=await f.read('data_campaigns_tool.list_campaign_hub_sites',{workspace_id:'workspace'});
 assert(!JSON.stringify(result).includes('Private sibling'));assert(!JSON.stringify(result).includes('foreign-site'));
 await assert.rejects(f.read('data_campaigns_tool.list_campaign_hub_sites',{workspace_id:'other-workspace'}));
 f.setIntercept((tool,action)=>action==='list_campaign_hub_sites'?{...envelope(action,{campaignSites:[{id:'site'}]}),structuredContent:{secret:'foreign'},content:[{type:'text',text:'foreign'},...envelope(action,{campaignSites:[{id:'site'}]}).content]}:undefined);
 assert(!JSON.stringify(await f.read('data_campaigns_tool.list_campaign_hub_sites',{workspace_id:'workspace'})).includes('foreign'));
});

test('campaign mutations verify campaign, variation, suggestions, fields and landing page targets',async t=>{
 const f=fixture(t);f.grant(['campaigns:write','campaigns:delete','scripts:write']);
 await f.write('data_campaigns_tool.update_campaign',{campaign_id:'campaign',name:'Example'});
 assert.equal(f.calls.at(-1).params.site_id,'site');
 const update=variation=>f.write('data_campaigns_tool.bulk_update_page_variations',{campaign_id:'campaign',variations:[{page_variation_id:variation,name:'Variant'}]});
 await update('variation');await assert.rejects(update('foreign'));
 await f.write('data_campaigns_tool.update_personalized_field',{campaign_id:'campaign',field_slug:'headline',name:'Headline'});
 await assert.rejects(f.write('data_campaigns_tool.update_personalized_field',{campaign_id:'campaign',field_slug:'foreign',name:'Headline'}));
 const personalize=component=>f.write('data_campaigns_tool.personalize_element',{campaign_id:'campaign',element_id:{component,element:'element'},field:{name:'Headline',type:'PlainText'},key:'textContent'});
 await personalize('page');await assert.rejects(personalize('foreign-page'));
 f.setIntercept((tool,action)=>action==='get_campaign'?envelope(action,{id:'campaign',siteId:'foreign-site'}):undefined);
 await assert.rejects(update('variation'));
});

test('campaign variation ownership follows nextOffset and fails on missing or stalled pagination',async t=>{
 const f=fixture(t);f.grant(['campaigns:delete']);
 f.setIntercept((tool,action,params)=>action==='get_page_variations'?envelope(action,params.offset?{variations:[{pageVariationId:'variation'}],fields:[],hasMore:false}:{variations:[{pageVariationId:'first'}],fields:[],hasMore:true,nextOffset:1}):undefined);
 await f.write('data_campaigns_tool.delete_page_variation',{campaign_id:'campaign',page_variation_id:'variation'});
 for(const result of [{variations:[]},{variations:[],hasMore:true,nextOffset:1},{variations:[{pageVariationId:'variation'}],hasMore:true,nextOffset:0}]) {
  f.setIntercept((tool,action)=>action==='get_page_variations'?envelope(action,result):undefined);
  await assert.rejects(f.write('data_campaigns_tool.delete_page_variation',{campaign_id:'campaign',page_variation_id:'variation'}));
 }
});

test('Optimize discovery is filtered and ambiguous, external and foreign resource IDs fail closed',async t=>{
 const f=fixture(t);f.grant(['optimize:read']);
 const result=await f.read('data_optimize_tool.list_optimize_resources');assert(!JSON.stringify(result).includes('foreign-site'));
 await f.read('data_optimize_tool.list_optimizations',{optimizeId:'optimize'});
 await assert.rejects(f.read('data_optimize_tool.list_optimizations',{optimizeId:'other'}));
 f.setIntercept((tool,action)=>action==='list_optimize_resources'?envelope(action,{references:[{optimizeId:'optimize',resource:{siteId:'site',type:'webflow-site'}},{optimizeId:'optimize',resource:{siteId:'foreign-site',type:'webflow-site'}}]}):undefined);
 await assert.rejects(f.read('data_optimize_tool.list_optimizations',{optimizeId:'optimize'}));
 assert.deepEqual(JSON.parse((await f.read('data_optimize_tool.list_optimize_resources')).content[0].text).result.references,[]);
 f.setIntercept((tool,action)=>action==='list_optimize_resources'?envelope(action,{references:[{optimizeId:'optimize',resource:{siteId:'site',type:'optimize-site'}}]}):undefined);
 await assert.rejects(f.read('data_optimize_tool.list_optimizations',{optimizeId:'optimize'}));
});

test('Optimize reports verify optimization membership, including archived optimizations',async t=>{
 const f=fixture(t);f.grant(['optimize:read']);
 const params={optimizeId:'optimize',optimizationId:'optimization',intervalStart:'2026-10-01T00:00:00Z',intervalEnd:'2026-10-02T00:00:00Z'};
 await f.read('data_optimize_tool.get_optimization_summary',params);
 assert(f.calls.find(c=>c.action==='list_optimizations').params.status.includes('archived'));
 await assert.rejects(f.read('data_optimize_tool.get_optimization_summary',{...params,optimizationId:'foreign'}));
});

test('Optimize membership follows cursors and rejects incomplete or malformed listings before reading reports',async t=>{
 const f=fixture(t);f.grant(['optimize:read']);
 const params={optimizeId:'optimize',optimizationId:'optimization',intervalStart:'2026-10-01T00:00:00Z',intervalEnd:'2026-10-02T00:00:00Z'};
 f.setIntercept((tool,action,p)=>action==='list_optimizations'?envelope(action,p.cursor?{optimizations:[{optimizationId:'optimization'}],nextCursor:null}:{optimizations:[],nextCursor:'next'}):undefined);
 await f.read('data_optimize_tool.get_optimization_summary',params);
 assert.deepEqual(f.calls.filter(c=>c.action==='list_optimizations').map(c=>c.params.cursor),[undefined,'next']);
 for(const result of [{optimizations:[],nextCursor:'repeat'},{optimizations:[],nextCursor:42},{unexpected:[]}]) {
  f.setIntercept((tool,action)=>action==='list_optimizations'?envelope(action,result):undefined);
  const before=f.calls.filter(c=>c.action==='get_optimization_summary').length;
  await assert.rejects(f.read('data_optimize_tool.get_optimization_summary',params));
  assert.equal(f.calls.filter(c=>c.action==='get_optimization_summary').length,before);
 }
});

test('Optimize discovery filters the final response and strips alternative response channels',async t=>{
 const f=fixture(t);f.grant(['optimize:read']);let reads=0;
 f.setIntercept((tool,action)=>{
  if(action!=='list_optimize_resources')return;
  reads++;
  const references=reads===1?[{optimizeId:'optimize',resource:{type:'webflow-site',siteId:'site'}}]:[
   {optimizeId:'optimize',resource:{type:'webflow-site',siteId:'foreign-site'}},
   {optimizeId:'owned',resource:{type:'webflow-site',siteId:'site'}}
  ];
  return {...envelope(action,{references}),structuredContent:{private:'foreign-site'},content:[{type:'text',text:'foreign-site'},...envelope(action,{references}).content]};
 });
 const result=await f.read('data_optimize_tool.list_optimize_resources');
 assert.equal(reads,2);
 assert(!JSON.stringify(result).includes('foreign-site'));
 assert.deepEqual(JSON.parse(result.content[0].text).result.references,[{optimizeId:'owned',resource:{type:'webflow-site',siteId:'site'}}]);
 assert.equal(result.structuredContent,undefined);
});

test('Optimize requires its own read grant on both channels and withholds results after revocation',async t=>{
 for(const channel of ['stable','beta']) {
  const f=fixture(t);f.c.beta={tokens:{access_token:'synthetic-beta'},sites:f.c.sites};f.store.data.projects.project.channel=channel;
  f.grant(['analyze:read']);
  await assert.rejects(f.read('data_optimize_tool.list_optimize_resources'),/Optimize/);
  assert.equal(f.calls.length,0);
  f.grant(['optimize:read']);
  await f.read('data_optimize_tool.list_optimizations',{optimizeId:'optimize'});
  f.setIntercept((tool,action)=>{
   if(action==='list_optimizations') {f.grant([]);return envelope(action,{optimizations:[],nextCursor:null});}
  });
  await assert.rejects(f.read('data_optimize_tool.list_optimizations',{optimizeId:'optimize'}),/policy changed/);
 }
});

test('workspace grants are owner-managed, separate from projects, and bound to a verified workspace',async t=>{
 const f=fixture(t);f.grant(PERMISSIONS);
 const op='data_members_tool.list_workspace_members';
 assert(!(await f.router.call('get_project_operations',{projectId:'project'})).some(o=>o.id===op));
 await assert.rejects(f.read(op,{workspace_id:'workspace'}),/Workspace Members/);
 assert.throws(()=>f.router.edit('projects','project',{permissions:{'workspace_members:read':true}}));
 assert.throws(()=>f.workspace({'site:read':true}));
 assert.throws(()=>f.router.edit('connections',f.c.id,{workspacePermissions:{foreign:{'workspace_members:read':true}}}));
 f.workspace({'workspace_members:read':true});
 await f.read(op,{workspace_id:'workspace'});
 await assert.rejects(f.read(op,{workspace_id:'other-workspace'}));
 const listed=(await f.router.call('get_project_operations',{projectId:'project'})).find(o=>o.id===op);
 assert.equal(listed.scope,'workspace');assert.equal(listed.workspaceId,'workspace');
 f.setIntercept((tool,action)=>action==='get_site'?envelope(action,{id:'site',workspaceId:'other-workspace'}):undefined);
 await assert.rejects(f.read(op,{workspace_id:'workspace'}));
});

test('workspace membership writes verify IDs, scope and preparation; project grants cannot grant deletion',async t=>{
 const f=fixture(t);f.grant([]);f.workspace({'workspace_members:write':true});
 const update=id=>f.write('data_members_tool.update_workspace_role',{workspace_id:'workspace',member_id:id,role:'member',default_site_role:'reviewer'});
 await update('member');await assert.rejects(update('foreign'));
 await assert.rejects(f.write('data_members_tool.remove_workspace_member',{workspace_id:'workspace',member_id:'member'}),/Workspace Members/);
 await f.write('data_members_tool.bulk_update_workspace_roles',{workspace_id:'workspace',member_ids:['member'],invite_ids:['invite'],role:'member',default_site_role:'reviewer'});
 await assert.rejects(f.write('data_members_tool.bulk_update_workspace_roles',{workspace_id:'workspace',invite_ids:['foreign'],role:'member',default_site_role:'reviewer'}));
 const invite=site=>f.write('data_members_tool.invite_workspace_member',{workspace_id:'workspace',email:'person@example.invalid',workspace_role:'client',site_access:[{site_id:site,site_role:'reviewer'}]});
 await invite('sibling-site');await assert.rejects(invite('foreign-site'));
 const {preparationId}=await f.router.call('prepare_project',{projectId:'project'});f.workspace({'workspace_members:write':true,'workspace_members:read':true});
 await assert.rejects(f.router.call('write_webflow',{projectId:'project',operationId:'data_members_tool.update_workspace_role',params:{workspace_id:'workspace',member_id:'member',role:'member',default_site_role:'reviewer'},preparationId}),/prepare_project/);
});

test('site member access stays site-scoped and workspace revocation during preflight prevents dispatch',async t=>{
 const f=fixture(t);f.grant(['site_access:read','site_access:write','site_access:delete']);
 await f.write('data_members_tool.grant_site_access',{member_id:'member',site_role:'reviewer'});assert.equal(f.calls.at(-1).params.site_id,'site');
 await assert.rejects(f.write('data_members_tool.update_site_role',{member_id:'foreign',site_role:'reviewer'}));
 await assert.rejects(f.write('data_members_tool.grant_site_access',{site_id:'foreign-site',email:'person@example.invalid',site_role:'reviewer'}));
 f.workspace({'workspace_members:delete':true});
 f.setIntercept((tool,action)=>{if(action==='list_workspace_members')f.workspace({});});
 await assert.rejects(f.write('data_members_tool.remove_workspace_member',{workspace_id:'workspace',member_id:'member'}),/policy changed/);
 assert(!f.calls.some(c=>c.action==='remove_workspace_member'));
});

test('new families are discoverable on Beta using its own grant',async t=>{
 const f=fixture(t);f.grant(PERMISSIONS);f.workspace({'workspace_members:read':true});f.c.beta={tokens:{access_token:'synthetic-beta'},sites:f.c.sites};f.store.data.projects.project.channel='beta';
 for(const operationId of ['data_apps_tool.list_apps','data_campaigns_tool.list_campaigns','data_members_tool.list_workspace_members','data_optimize_tool.list_optimize_resources'])assert.equal((await f.router.call('get_project_operations',{projectId:'project',operationId})).id,operationId);
 await f.read('data_apps_tool.list_apps');
});

test('refreshed Modal schemas apply on Stable and Beta and retain existing canvas code grants',()=>{
 const stable=operation('data_element_builder.build','stable'),beta=operation('data_element_builder.build','beta');
 assert(stable.schema.properties.element_schema.properties.type.enum.includes('Modal'));
 assert(beta.schema.properties.element_schema.properties.type.enum.includes('Modal'));
 for(const action of ['create_prop','update_prop']) {
  const op=operation('data_component_props_tool.'+action);
  assert(op.schema.properties.props.items.properties.default_link.properties.mode.enum.includes('modal'));
  assert.deepEqual(op.schema.properties.props.items.properties.default_link.properties.modal_action.enum,['show','hide']);
  assert(op.extraPermissions.includes('scripts:write'));
 }
 const op=operation('data_component_props_tool.set_component_instance_prop_values');
 assert(op.schema.properties.values.items.properties.link_mode.enum.includes('modal'));
 assert.throws(()=>prepareArguments(op,{values:[]},'site','page'));
});


test('account-wide Beta grants are explicit, revoked in flight, and never supplied by project permissions',async t=>{
 const f=fixture(t);f.grant(PERMISSIONS);f.c.beta={tokens:{access_token:'synthetic-beta'},sites:f.c.sites};f.store.data.projects.project.channel='beta';
 const op='data_apps_tool.create_standalone_app',params={name:'Example app',source_url:'https://github.com/example/synthetic',branch:'main',folder_id:'workspace-folder',site_specific_access:'restricted',dry_run:true};
 await assert.rejects(f.write(op,params),/account-wide/);
 assert.throws(()=>f.router.edit('projects','project',{permissions:{'standalone_apps:write':true}}));
 const enable=grants=>f.router.edit('connections',f.c.id,{connectionPermissions:grants});
 assert.throws(()=>enable({'site:read':true}));
 enable({'standalone_apps:write':true,'workspace_discovery:read':true});
 await f.write(op,params);assert.equal(f.calls.at(-1).action,'create_app');assert.equal(f.calls.at(-1).params.site_id,undefined);
 assert.equal(f.calls.at(-1).params.folder_id,'workspace-folder');
 await assert.rejects(f.write(op,{...params,site_id:'site'}));
 await assert.rejects(f.write('data_apps_tool.create_app',params),/standalone/);
 await f.read('data_workspaces_tool.list_workspaces');
 f.grant(['apps:publish']);await assert.rejects(f.write(op,params),/Custom code/);
 f.grant(PERMISSIONS);
 const {preparationId}=await f.router.call('prepare_project',{projectId:'project'});enable({});
 await assert.rejects(f.router.call('write_webflow',{projectId:'project',operationId:op,params,preparationId}));
 enable({'standalone_apps:write':true,'workspace_discovery:read':true});
 const before=f.calls.length;f.setIntercept(tool=>{if(tool==='listSites')enable({});});
 await assert.rejects(f.read('data_workspaces_tool.list_workspaces'),/policy changed/);assert.equal(f.calls.length,before);
 f.setIntercept(()=>undefined);enable({'standalone_apps:write':true});f.store.data.projects.project.channel='stable';
 await assert.rejects(f.write(op,params),/unavailable/);
});

test('AEO settings writes require their own grant and remain site-pinned and Beta-only',async t=>{
 const f=fixture(t);f.grant(['analyze:read']);f.c.beta={tokens:{access_token:'synthetic-beta'},sites:f.c.sites};f.store.data.projects.project.channel='beta';
 const op='data_recommendations_tool.update_recommendation_settings';
 await assert.rejects(f.write(op,{recurringAuditsEnabled:false}),/Missing project permissions/);
 f.grant(['recommendations:write']);await f.write(op,{recurringAuditsEnabled:false});assert.equal(f.calls.at(-1).params.site_id,'site');
 await assert.rejects(f.write(op,{site_id:'foreign-site',recurringAuditsEnabled:true}));
 f.store.data.projects.project.channel='stable';await assert.rejects(f.write(op,{recurringAuditsEnabled:true}),/unavailable/);
});
