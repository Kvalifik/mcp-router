import test from 'node:test';
import assert from 'node:assert/strict';
import {operation,prepareArguments,checkOwnership,allowed} from '../src/permissions.js';
const op=operation('data_pages_tool.list_site_branch_changes','beta');
const envelope=result=>({content:[{type:'text',text:JSON.stringify({action:'list_site_branches',result})}]});
function fixture(current,history=[]) {
 const calls=[];
 const client={call:async(tool,args)=>{
  assert.equal(tool,'data_pages_tool');
  const params=args.actions[0].list_site_branches;
  assert.equal(params.site_id,'site');calls.push(params);
  if(!params.statusGroup)return envelope(current);
  assert.equal(params.statusGroup,'merged');assert.equal(params.limit,100);
  const index=params.cursor?Number(params.cursor.replace('page-','')):0;
  return envelope(typeof history==='function'?history(params):history[index]);
 }};
 return {client,calls};
}
test('Release history is Beta-only, read-only, site-pinned and schema constrained',()=>{
 assert.deepEqual(op.channels,['beta']);assert.equal(op.mode,'read');assert.equal(op.permission,'pages:read');assert.deepEqual(op.extraPermissions,[]);
 assert.equal(allowed({permissions:{}},op),false);
 assert.equal(allowed({permissions:{'pages:read':true}},op),true);
 const {args}=prepareArguments(op,{site_branch_id:'owned',limit:25,cursor:'change-page'},'site');
 assert.deepEqual(args.actions[0].list_site_branch_changes,{site_branch_id:'owned',limit:25,cursor:'change-page',site_id:'site'});
 assert.throws(()=>prepareArguments(op,{site_branch_id:'owned',site_id:'foreign'},'site'),/Cross-project/);
 for(const params of [{},{site_branch_id:''},{site_branch_id:'owned',limit:101},{site_branch_id:'owned',limit:1.5},{site_branch_id:'owned',cursor:''}])assert.throws(()=>prepareArguments(op,params,'site'),/schema/);
 const list=operation('data_pages_tool.list_site_branches','beta');
 assert.doesNotThrow(()=>prepareArguments(list,{statusGroup:'merged',limit:100,cursor:'page-1'},'site'));
 for(const params of [{limit:25},{cursor:'page-1'},{statusGroup:'inProgress',limit:25}])assert.throws(()=>prepareArguments(list,params,'site'),/requires statusGroup=merged/);
});
test('Release ownership finds current and later merged branches with site-scoped cursors',async()=>{
 const active=fixture({branches:[{id:'active'}]});
 await checkOwnership(active.client,op,{site_branch_id:'active'},'site');assert.equal(active.calls.length,1);
 const merged=fixture({siteBranches:[]},[
  {branches:[{id:'other'}],pagination:{hasMore:true,nextCursor:'page-1'}},
  {branches:[],pagination:{hasMore:true,nextCursor:'page-2'}},
  {branches:[{id:'merged'}],pagination:{hasMore:false}}
 ]);
 await checkOwnership(merged.client,op,{site_branch_id:'merged'},'site');
 assert.deepEqual(merged.calls.map(p=>p.cursor),[undefined,undefined,'page-1','page-2']);
 const foreign=fixture({branches:[]},[{branches:[],pagination:{hasMore:false}}]);
 await assert.rejects(checkOwnership(foreign.client,op,{site_branch_id:'foreign'},'site'),/does not belong/);
});
test('merged history does not authorize working-page reads or lifecycle mutations',async()=>{
 for(const action of ['create_page','list_pages','stage_site_branch','discard_site_branch','update_site_branch_details','get_site_branch_freshness']) {
  const f=fixture({branches:[]},[{branches:[{id:'merged'}]}]);
  await assert.rejects(checkOwnership(f.client,operation('data_pages_tool.'+action,'beta'),{site_branch_id:'merged'},'site'),/does not belong/);
  assert.equal(f.calls.length,1);
 }
});
test('malformed history, repeated cursors and pagination exhaustion fail closed',async()=>{
 for(const result of [null,{unexpected:[]},{branches:[null]},{branches:[{}]},{branches:[],pagination:{hasMore:true}},{branches:[],pagination:{hasMore:true,nextCursor:''}},{branches:[],pagination:{hasMore:false,nextCursor:'page-1'}}]) {
  const f=fixture({branches:[]},[result]);
  await assert.rejects(checkOwnership(f.client,op,{site_branch_id:'foreign'},'site'));
 }
 const repeated=fixture({branches:[]},()=>({branches:[],pagination:{hasMore:true,nextCursor:'page-1'}}));
 await assert.rejects(checkOwnership(repeated.client,op,{site_branch_id:'foreign'},'site'),/incomplete/);
 assert.equal(repeated.calls.length,3);
 const endless=fixture({branches:[]},params=>({branches:[],pagination:{hasMore:true,nextCursor:`page-${params.cursor?Number(params.cursor.slice(5))+1:1}`}}));
 await assert.rejects(checkOwnership(endless.client,op,{site_branch_id:'foreign'},'site'),/incomplete/);
 assert.equal(endless.calls.length,101);
 const incomplete=fixture({branches:[{id:'active'}],pagination:{hasMore:true,nextCursor:'unexpected'}});
 await assert.rejects(checkOwnership(incomplete.client,op,{site_branch_id:'active'},'site'),/Cannot verify/);
});
