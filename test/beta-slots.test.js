import test from 'node:test';
import assert from 'node:assert/strict';
import {operation,prepareArguments,checkOwnership,allowed} from '../src/permissions.js';
const actions=['get_slot_default','add_to_slot_default','remove_from_slot_default','reset_slot_to_default','clear_slot'];
const envelope=(action,result)=>({content:[{type:'text',text:JSON.stringify({action,result})}]});
function fixture() {
 const calls=[];
 const data={components:[{id:'component',props:[{id:'slot',type:'slot'}]},{id:'child',props:[]}],elements:[{id:{component:'component',element:'instance'}}],defaults:[{id:{component:'child',element:'default'}}]};
 const client={call:async(tool,args)=>{
  const action=Object.keys(args.actions[0]).find(k=>k!=='label');calls.push({tool,args,action});
  if(action==='list_pages')return envelope(action,{pages:[{id:'page'}]});
  assert.equal(args.siteId,'site');assert.equal(args.pageId,'page');
  if(action==='get_all_components')return envelope(action,{components:data.components,...(data.pagination?{pagination:data.pagination}:{})});
  if(action==='get_slot_default')return envelope(action,{elements:data.defaults});
  if(action==='get_all_elements')return envelope(action,{elements:data.elements});
  throw Error('Unexpected lookup');
 }};
 return {data,calls,client};
}
const input=action=>action==='clear_slot'||action==='reset_slot_to_default'?{element_id:{component:'component',element:'instance'},slot_name:'Content',scope_component_id:'component'}:{component_id:'component',slot_prop_id:'slot',...(action==='add_to_slot_default'?{child_component_id:'child'}:{}),...(action==='remove_from_slot_default'?{element_id:'default'}:{})};
test('slot operations remain Beta-only with explicit destructive and custom-code permissions',()=>{
 for(const action of actions){
  const op=operation('data_component_props_tool.'+action,'beta');assert.deepEqual(op.channels,['beta']);
  const {args}=prepareArguments(op,input(action),'site','page');assert.equal(args.siteId,'site');assert.equal(args.pageId,'page');
  assert.equal(allowed({permissions:{}},op),false);
  const permissions=Object.fromEntries([op.permission,...op.extraPermissions].map(k=>[k,true]));assert.equal(allowed({permissions},op),true);
  if(action!=='get_slot_default'){permissions['scripts:write']=false;assert.equal(allowed({permissions},op),false);}
 }
 assert.equal(operation('data_component_props_tool.clear_slot').mode,'delete');
 assert.equal(operation('data_component_props_tool.remove_from_slot_default').mode,'delete');
 assert(operation('data_component_props_tool.reset_slot_to_default').extraPermissions.includes('component_props:delete'));
});
test('slot ownership accepts verified targets and rejects foreign component, prop, child, root and instance IDs',async()=>{
 for(const action of actions){const f=fixture();await checkOwnership(f.client,operation('data_component_props_tool.'+action,'beta'),input(action),'site','page');}
 const cases=[['get_slot_default',{component_id:'foreign'}],['get_slot_default',{slot_prop_id:'foreign'}],['add_to_slot_default',{child_component_id:'foreign'}],['remove_from_slot_default',{element_id:'foreign'}],['clear_slot',{scope_component_id:'foreign'}],['reset_slot_to_default',{element_id:{component:'foreign',element:'instance'}}],['clear_slot',{element_id:{component:'component',element:'foreign'}}]];
 for(const [action,overrides] of cases){const f=fixture();await assert.rejects(checkOwnership(f.client,operation('data_component_props_tool.'+action,'beta'),{...input(action),...overrides},'site','page'));}
});
test('malformed, incomplete and wrong-type slot ownership responses fail closed',async()=>{
 for(const mutate of [d=>d.components=null,d=>d.pagination={hasMore:true},d=>d.pagination={total:100},d=>d.components[0].props=null,d=>d.components[0].props[0].type='textContent']){
  const f=fixture();mutate(f.data);await assert.rejects(checkOwnership(f.client,operation('data_component_props_tool.get_slot_default','beta'),input('get_slot_default'),'site','page'));
 }
 const f=fixture();f.data.defaults=[{id:{component:'child',element:'other'}}];await assert.rejects(checkOwnership(f.client,operation('data_component_props_tool.remove_from_slot_default','beta'),input('remove_from_slot_default'),'site','page'));
});
