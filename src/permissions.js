import fs from 'node:fs';
import Ajv from 'ajv';
export const CATALOG = JSON.parse(fs.readFileSync(new URL('./catalog.json', import.meta.url)));
export const PERMISSIONS = [...new Set(['site:read', ...CATALOG.flatMap(o => [o.permission, ...o.extraPermissions])])];
export const GROUPS = [...new Map(CATALOG.map(o => [o.area, { area: o.area, title: o.title, modes: [...new Set(CATALOG.filter(x => x.area === o.area).map(x => x.mode))] }])).values()];
export function permissions(p) { return p.permissions || { 'site:read': !!p.read }; }
export function validatePermissions(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value) || Object.entries(value).some(([k,v]) => !PERMISSIONS.includes(k) || typeof v !== 'boolean')) throw new Error('Invalid project permissions');
  return { ...value };
}
const ajv = new Ajv({ strict: false, validateFormats: false, allErrors: false });
const validators = new Map();
export function operation(id) { const op=CATALOG.find(o=>o.id===id); if(!op)throw new Error('Unknown operation');return op; }
export function allowed(p,op) { const grants=permissions(p);return [op.permission,...op.extraPermissions].every(key=>grants[key]===true); }
export function prepareArguments(op, params, siteId, pageId) {
  if (!params || typeof params!=='object' || Array.isArray(params)) throw new Error('Invalid operation parameters');
  const value=structuredClone(params);
  function inject(schema) {
    if(schema.properties) for(const key of ['site_id','siteId']) if(key in schema.properties) {
      if(value[key]!==undefined && value[key]!==siteId)throw new Error('Cross-project site denied');value[key]=siteId;
    }
    for(const variant of schema.anyOf||schema.oneOf||[])inject(variant);
  }
  inject(op.schema);
  let validate=validators.get(op.id);if(!validate){validate=ajv.compile(op.schema);validators.set(op.id,validate);}
  if(!validate(value)) throw new Error('Parameters do not match the operation schema');
  const args = op.direct ? value : {actions:[op.builder ? value : {label:'Project operation', [op.action]:value}]};
  if(op.topSite)args[op.topSite]=siteId;
  if(op.page){if(typeof pageId!=='string'||!pageId)throw new Error('pageId is required');args.pageId=pageId;}
  return {args,value};
}
// A structured envelope is required for ownership checks; unfamiliar responses fail closed.
export function resultOf(response, action) {
  if(response?.isError)throw new Error('Webflow rejected the request');
  for(const c of response?.content||[]) {if(c.type!=='text')continue;let data;try{data=JSON.parse(c.text);}catch{continue;}
    for(const block of Array.isArray(data)?data:[data]) if(block.action===action) {
      if(block.error || block.result==null)throw new Error('Webflow action failed');return block.result;
    }
  }
  throw new Error('Unrecognized Webflow response');
}
const lists = {
  collection: ['data_cms_tool','get_collection_list','siteId','collections'],
  page: ['data_pages_tool','list_pages','site_id','pages'],
  asset: ['data_assets_tool','list_assets','site_id','assets'],
  folder: ['data_assets_tool','list_asset_folders','site_id','assetFolders'],
  form: ['data_forms_tool','list_forms','site_id','forms'],
  webhook: ['data_webhook_tool','list_webhooks','site_id','webhooks']
};
export async function checkOwnership(client, op, value, siteId, pageId) {
  const cache=new Map();
  async function owns(kind,id) {
    if(typeof id!=='string'||!id)throw new Error('Invalid resource ID');
    if(!cache.has(kind)) {
      const [tool,action,key,field]=lists[kind], ids=new Set();let offset=0;
      for(let page=0;page<100;page++) {
        const params={[key]:siteId};if(!['collection','webhook'].includes(kind))Object.assign(params,{limit:100,offset});
        const result=resultOf(await client.call(tool,{actions:[{label:'Verify project resource ownership',[action]:params}]}),action);
        const rows=Array.isArray(result)?result:result[field] || (kind==='folder'?result.folders:null);
        if(!Array.isArray(rows))throw new Error('Cannot verify resource ownership');
        rows.forEach(row=>{if(typeof row.id==='string')ids.add(row.id);});
        const pg=result.pagination;offset+=rows.length;
        if(!pg || pg.hasMore===false || (Number.isFinite(pg.total)&&offset>=pg.total) || (pg.hasMore!==true&&rows.length<100))break;
        if(!rows.length || page===99)throw new Error('Ownership listing incomplete');
      }
      cache.set(kind,ids);
    }
    if(!cache.get(kind).has(id))throw new Error('Resource does not belong to this project');
  }
  if(op.page)await owns('page',pageId);
  async function walk(node,parent='') {
    if(!node||typeof node!=='object')return;
    for(const [key,v] of Object.entries(node)) {
      if(['siteId','site_id'].includes(key)&&v!==siteId)throw new Error('Cross-project site denied');
      if(['page_id','pageId','duplicateOf'].includes(key)&&v)await owns('page',v);
      if(['collection_id','collectionId'].includes(key)&&v && !['variable'].includes(op.area))await owns('collection',v);
      if(['asset_id','image_asset_id'].includes(key)&&v)await owns('asset',v);
      if(key==='asset_ids'&&Array.isArray(v))for(const id of v)await owns('asset',id);
      if(['folder_id','parent_folder'].includes(key)&&v)await owns('folder',v);
      if(key==='form_id'&&v)await owns('form',v);
      if(key==='webhook_id'&&v)await owns('webhook',v);
      if(parent==='pages' && ['id','pageId','page_id'].includes(key))await owns('page',v);
      await walk(v,Array.isArray(node)?parent:key);
    }
  }
  await walk(value);
}
