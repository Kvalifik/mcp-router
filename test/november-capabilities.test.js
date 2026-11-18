import test from 'node:test';
import assert from 'node:assert/strict';
import {operation,prepareArguments,checkOwnership,allowed,PERMISSIONS,validateWorkspacePermissions} from '../src/permissions.js';
const site='a'.repeat(24),workspace='b'.repeat(24),brand='c'.repeat(24),topic='d'.repeat(24);
const envelope=(action,result)=>({content:[{type:'text',text:JSON.stringify({action,result})}]});
const client=handler=>({call:async(tool,args)=>{const action=Object.keys(args.actions[0]).find(k=>k!=='label');return envelope(action,await handler(tool,action,args.actions[0][action]));}});
test('firewall grants are separate from Enterprise, site-pinned, and check all affected domains',async()=>{
 for(const action of ['get_waf_rules','suggest_waf_changes','validate_waf_rule','test_waf_rules','test_waf_settings','update_waf_rule','update_waf_settings','delete_waf_rule']) {
  const op=operation('data_enterprise_tool.'+action);
  assert.deepEqual(op.channels,['stable','beta']);
  assert.equal(allowed({permissions:{'enterprise:read':true,'enterprise:write':true,'enterprise:delete':true}},op),false);
  assert(op.permission.startsWith('firewall:'));
 }
 const op=operation('data_enterprise_tool.update_waf_rule');
 const params={ruleType:'ipRules',config:{ips:[]},expectedSiteStateHash:'0'.repeat(64),previewToken:'synthetic',domains:['example.test'],previousDomains:['old.example.test']};
 assert.equal(prepareArguments(op,params,site).value.site_id,site);
 assert.throws(()=>prepareArguments(op,{...params,site_id:brand},site),/Cross-project/);
 const c=client((tool,action,p)=>{assert.equal(action,'get_waf_rules');assert.equal(p.site_id,site);return {byDomain:{'example.test':null,'old.example.test':null}};});
 await checkOwnership(c,op,params,site);
 for(const changed of [{domains:['foreign.test']},{previousDomains:['foreign.test']}])await assert.rejects(checkOwnership(c,op,{...params,...changed},site),/Domain does not belong/);
 await assert.rejects(checkOwnership(client(()=>({byDomain:[]})),op,params,site),/Cannot verify/);
});
test('workspace AEO uses explicit default-off workspace grants and validates brand/topic chains',async()=>{
 const op=operation('data_aeo_brand_presences_tool.create_prompt','beta');
 assert.deepEqual(op.channels,['beta']);assert.equal(op.scope,'workspace');assert(!PERMISSIONS.includes(op.permission));
 assert.equal(allowed({permissions:{'analyze:read':true,'workspace_aeo:write':true,'agent_instructions:read':true}},op),false);
 assert.equal(allowed({permissions:{'agent_instructions:read':true}},op,{'workspace_aeo:write':true}),true);
 assert.deepEqual(validateWorkspacePermissions({[workspace]:{'workspace_aeo:write':true}},[{workspaceId:workspace}]),{[workspace]:{'workspace_aeo:write':true}});
 const params={workspace_id:workspace,brand_presence_id:brand,topicId:topic,promptText:'Synthetic question'};
 prepareArguments(op,params,site);
 const c=client((tool,action,p)=>{
  if(action==='get_site')return {id:site,workspaceId:workspace};
  if(action==='get_brand_presence')return {id:brand,workspaceId:workspace};
  if(action==='get_topic'){assert.equal(p.brand_presence_id,brand);return {id:topic};}
  throw Error('Unexpected lookup');
 });
 await checkOwnership(c,op,params,site);
 for(const changed of [{workspace_id:site},{brand_presence_id:site},{topicId:site}])await assert.rejects(checkOwnership(c,op,{...params,...changed},site),/does not belong/);
});
test('bulk workspace removal retains separate Delete grant and verifies members and invites',async()=>{
 const op=operation('data_members_tool.bulk_remove_workspace_members','beta');
 assert.equal(op.permission,'workspace_members:delete');assert.equal(op.scope,'workspace');assert.deepEqual(op.channels,['beta']);
 assert.equal(allowed({permissions:{'site_access:delete':true}},op),false);
 const c=client((tool,action)=>action==='get_site'?{id:site,workspaceId:workspace}:{members:[{id:'member'}],invites:[{id:'invite'}],pagination:{nextCursor:null}});
 const params={workspace_id:workspace,member_ids:['member'],invite_ids:['invite']};
 await checkOwnership(c,op,params,site);
 for(const changed of [{workspace_id:site},{member_ids:['foreign']},{invite_ids:['foreign']}])await assert.rejects(checkOwnership(c,op,{...params,...changed},site),/does not belong/);
});
test('performance diagnostics are Beta-only Analytics reads and verify an optional page',async()=>{
 const op=operation('performance_audits_tool.audit_site_performance','beta');
 assert.deepEqual(op.channels,['beta']);assert.equal(op.permission,'analyze:read');assert.equal(op.mode,'read');assert.deepEqual(op.extraPermissions,['scripts:read']);
 assert.equal(prepareArguments(op,{},site).value.site_id,site);
 const c=client(()=>({pages:[{id:'page'}],pagination:{total:1}}));
 await checkOwnership(c,op,{page_id:'page'},site);
 await assert.rejects(checkOwnership(c,op,{page_id:'foreign'},site),/does not belong/);
});
test('Beta CMS branch IDs must match current site Releases and never merged history',async()=>{
 const op=operation('data_cms_tool.list_collection_items','beta');
 assert(op.schema.properties.cms_branch_id);assert(!operation(op.id).schema.properties.cms_branch_id);
 let calls=0;
 const c=client((tool,action,p)=>{calls++;assert.equal(tool,'data_releases_read_tool');assert.equal(action,'list_site_branches');assert.equal(p.site_id,site);return {branches:[{id:'release',cmsBranchId:brand}]};});
 await checkOwnership(c,op,{cms_branch_id:brand},site);
 await assert.rejects(checkOwnership(c,op,{cms_branch_id:topic},site),/does not belong/);assert.equal(calls,2);
});
test('Release conflict resolutions must come from the owned Release preview',async()=>{
 const op=operation('data_releases_write_tool.update_site_branch_from_main','beta');
 const c=client((tool,action)=>action==='list_site_branches'?{branches:[{id:'release'}]}:{report:{conflicts:[{type:'style',id:'style'}]}});
 const params={site_branch_id:'release',resolutions:[{type:'style',id:'style',resolution:'main'}]};
 await checkOwnership(c,op,params,site);
 await assert.rejects(checkOwnership(c,op,{...params,resolutions:[{type:'style',id:'foreign',resolution:'branch'}]},site),/Conflict does not belong/);
 assert.equal(operation('data_releases_write_tool.merge_site_branch').permission,'release_merge:publish');
 assert.equal(allowed({permissions:{'pages:publish':true,'agent_instructions:read':true}},operation('data_releases_write_tool.merge_site_branch')),false);
});
test('component CMS selections and new page/asset links reject foreign references',async()=>{
 const op=operation('data_component_props_tool.set_component_instance_prop_values');
 const c=client((tool,action)=>({get_collection_list:{collections:[{id:'collection'}]},list_collection_items:{items:[{id:'item'}]},list_pages:{pages:[{id:'page'}]},list_assets:{assets:[{id:'asset'}]}}[action]));
 await checkOwnership(c,op,{values:[{selected_item_ids:['item'],link_to_page_id:'page',link_to_asset_id:'asset'}]},site,'page');
 for(const value of [{selected_item_ids:['foreign']},{link_to_page_id:'foreign'},{link_to_asset_id:'foreign'}])await assert.rejects(checkOwnership(c,op,{values:[value]},site,'page'),/does not belong/);
});
