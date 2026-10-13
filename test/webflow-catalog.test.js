import test from 'node:test';
import assert from 'node:assert/strict';
import { compareCatalog } from '../scripts/check-webflow-catalog.mjs';

const schema = { type: 'object', properties: { site_id: { type: 'string' } }, required: ['site_id'] };
const catalog = [{ id: 'data_example_tool.list_items', tool: 'data_example_tool', schema, topSite: null, page: false, builder: false, direct: false }];
const tool = actions => ({ name: 'data_example_tool', inputSchema: { properties: { actions: { items: { properties: { label: {type:'string'}, ...actions } } } } } });
test('catalog check accepts unchanged schemas regardless of object key order', () => {
  assert.deepEqual(compareCatalog([tool({list_items: {...schema, properties:{site_id:{type:'string'}}}})], catalog), {added:[], changed:[], removed:[], unclassifiedTools:[]});
});
test('new actions and tools require classification without granting permissions', () => {
  const snapshot = [tool({list_items:schema, export_items:schema}), {name:'data_new_tool',inputSchema:{properties:{}}}];
  const before = structuredClone(catalog);
  const report = compareCatalog(snapshot,catalog);
  assert.deepEqual(report.added,['data_example_tool.export_items']);
  assert.deepEqual(report.unclassifiedTools,['data_new_tool']);
  assert.deepEqual(catalog,before);
});
test('optional parameters, scope changes and removed actions are reported', () => {
  const changed = tool({list_items:{...schema,properties:{...schema.properties,target_site:{type:'string'}}}});
  changed.inputSchema.properties.pageId={type:'string'};
  assert.deepEqual(compareCatalog([changed],catalog).changed,[{id:catalog[0].id,fields:['schema','page']}]);
  assert.deepEqual(compareCatalog([tool({get_items:schema})],catalog).removed,[catalog[0].id]);
});
test('incomplete, duplicate and unsupported snapshots fail rather than indicating parity', () => {
  for(const snapshot of [[],{tools:[tool({list_items:schema})],nextCursor:'next'},[tool({}),tool({})],[{name:'bad'}],[{name:'data_example_tool',inputSchema:{properties:{actions:{items:{$ref:'#/missing'}}}}}]]) {
    assert.throws(()=>compareCatalog(snapshot,catalog));
  }
});
test('intentionally excluded guide utilities do not require execution permissions', () => {
  const snapshot=[tool({list_items:schema}),{name:'webflow_guide_tool',inputSchema:{properties:{}}}];
  assert.deepEqual(compareCatalog(snapshot,catalog).unclassifiedTools,[]);
});
