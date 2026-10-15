import { AgentError, checkUpstreamResponse } from './agent-errors.js';
import fs from 'node:fs';
import Ajv from 'ajv';
import { checkProjectResources } from './project-resources.js';
export const CATALOG = JSON.parse(fs.readFileSync(new URL('./catalog.json', import.meta.url)));
export const PERMISSIONS = [...new Set(['site:read', ...CATALOG.filter(o=>!o.scope).flatMap(o => [o.permission, ...o.extraPermissions])])];
export const CONNECTION_PERMISSIONS = ['workspace_discovery:read','standalone_apps:write'];
export function validateConnectionPermissions(value) {
  if(!value||typeof value!=='object'||Array.isArray(value)||Object.entries(value).some(([k,v])=>!CONNECTION_PERMISSIONS.includes(k)||typeof v!=='boolean'))throw new Error('Invalid connection permissions');
  return {...value};
}
export const WORKSPACE_PERMISSIONS = ['workspace_members:read','workspace_members:write','workspace_members:delete'];
export const GROUPS = [...new Map(CATALOG.filter(o=>!o.scope).map(o => [o.area, { area: o.area, title: o.title, modes: [...new Set(CATALOG.filter(x => x.area === o.area).map(x => x.mode))] }])).values()];
export function permissions(p) { return p.permissions || { 'site:read': !!p.read }; }
export function validatePermissions(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value) || Object.entries(value).some(([k,v]) => !PERMISSIONS.includes(k) || typeof v !== 'boolean')) throw new Error('Invalid project permissions');
  return { ...value };
}
const ajv = new Ajv({ strict: false, validateFormats: false, allErrors: false });
const validators = new WeakMap();
export function operation(id, channel='stable') { const op=CATALOG.find(o=>o.id===id); if(!op)throw new Error('Unknown operation');const {channelSchemas,...selected}=op;return {...selected,schema:channelSchemas?.[channel]||op.schema}; }
export function allowed(p,op,workspace={},connection={}) { const grants=permissions(p);return (op.scope==='connection'?connection[op.permission]===true:op.scope==='workspace'?workspace[op.permission]===true:grants[op.permission]===true)&&op.extraPermissions.every(key=>grants[key]===true); }
export function validateWorkspacePermissions(value, sites) {
  if(!value || typeof value!=='object'||Array.isArray(value))throw new Error('Invalid workspace permissions');
  const known=new Set(sites.map(s=>s.workspaceId).filter(Boolean));
  for(const [workspace,grants] of Object.entries(value)) {
    if(!known.has(workspace)||['__proto__','constructor','prototype'].includes(workspace)||!grants||typeof grants!=='object'||Array.isArray(grants)||Object.entries(grants).some(([key,v])=>!WORKSPACE_PERMISSIONS.includes(key)||typeof v!=='boolean'))throw new Error('Invalid workspace permissions');
  }
  return structuredClone(value);
}
export function requirePermissions(p, keys) {
  const grants=permissions(p);
  const missing=[...new Set(keys)].filter(key=>grants[key]!==true);
  if(!missing.length)return;
  const labels=missing.map(key=>{
    const [area,mode]=key.split(':');
    return `${GROUPS.find(group=>group.area===area)?.title || area} → ${mode[0].toUpperCase()+mode.slice(1)}`;
  });
  throw new AgentError('router_permission_denied', `Missing project permissions: ${labels.join(', ')}. Ask the user to enable these in MCP Router using the sliders button next to the project, then save changes.`);
}
export function prepareArguments(op, params, siteId, pageId) {
  if (!params || typeof params!=='object' || Array.isArray(params)) throw new Error('Invalid operation parameters');
  const value=structuredClone(params);
  if(op.tool==='data_apps_tool'&&op.action==='create_app'&&op.scope!=='connection'&&(value.folder_id!==undefined||value.site_specific_access!==undefined))throw new Error('Use create_standalone_app with account-wide permission for standalone controls');
  function inject(schema) {
    if(schema.properties) for(const key of ['site_id','siteId']) if(key in schema.properties) {
      if(value[key]!==undefined && value[key]!==siteId)throw new Error('Cross-project site denied');value[key]=siteId;
    }
    for(const variant of schema.anyOf||schema.oneOf||[])inject(variant);
  }
  inject(op.schema);
  let validate=validators.get(op.schema);if(!validate){validate=ajv.compile(op.schema);validators.set(op.schema,validate);}
  if(!validate(value)) throw new Error('Parameters do not match the operation schema');
  const args = op.direct ? value : {actions:[op.builder ? value : {label:'Project operation', [op.action]:value}]};
  if(op.topSite)args[op.topSite]=siteId;
  if(op.page){if(typeof pageId!=='string'||!pageId)throw new Error('pageId is required');args.pageId=pageId;}
  return {args,value};
}
// A structured envelope is required for ownership checks; unfamiliar responses fail closed.
export function resultOf(response, action) {
  checkUpstreamResponse(response);
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
  if(op.area==='interactions') {
    // IX3 is site-scoped even though its envelope also requires a page. Never
    // treat that page alone as proof that IDs in the payload belong to the site.
    async function interactionOwns(kind,id) {
      if(typeof id!=='string'||!id)throw new Error('Invalid resource ID');
      if(!cache.has(kind)) {
        const ids=new Set();let offset=0;
        for(let page=0;page<100;page++) {
          const action=kind==='interaction'?'list_interactions':'get_all_components';
          const params=kind==='interaction'?{limit:200,offset}:{};
          const result=resultOf(await client.call(kind==='interaction'?'data_interactions_tool':'data_component_tool',{
            siteId,pageId,actions:[{label:'Verify project resource ownership',[action]:params}]
          }),action);
          const rows=Array.isArray(result)?result:result[kind==='interaction'?'interactions':'components'];
          if(!Array.isArray(rows)||rows.some(row=>typeof row?.id!=='string'))throw new Error('Cannot verify resource ownership');
          rows.forEach(row=>ids.add(row.id));offset+=rows.length;
          const pg=result.pagination;
          if(pg?.nextCursor || (kind==='component'&&(pg?.hasMore || pg?.total>rows.length)))throw new Error('Ownership listing incomplete');
          if(kind==='component' || pg?.hasMore===false || (Number.isFinite(pg?.total)&&offset>=pg.total) || (!pg?.hasMore&&rows.length<200))break;
          if(!rows.length||page===99)throw new Error('Ownership listing incomplete');
        }
        cache.set(kind,ids);
      }
      if(!cache.get(kind).has(id))throw new Error('Resource does not belong to this project');
    }
    if(value.id)await interactionOwns('interaction',value.id);
    if(value.visibleOnPageId)await owns('page',value.visibleOnPageId);
    async function targets(node) {
      if(!node||typeof node!=='object')return;
      if(Object.hasOwn(node,'libraryProfileId'))throw new Error('Library interaction targets are unsupported');
      if(node.type==='pages') {
        if(!Array.isArray(node.value)||!node.value.length)throw new Error('Invalid interaction page scope');
        for(const id of node.value)await owns('page',id);
      }
      if(Object.hasOwn(node,'componentId'))await interactionOwns('component',node.componentId);
      if(node.extensionKey==='wf:inst') {
        if(!Array.isArray(node.value)||node.value.length!==2||node.value.some(id=>typeof id!=='string'||!id))throw new Error('Invalid interaction instance target');
        // A component scope uses component IDs; otherwise the first tuple item
        // is a page ID. Updates can retain their existing component scope.
        if(cache.get('page')?.has(node.value[0]))await owns('page',node.value[0]);
        else await interactionOwns('component',node.value[0]);
      }
      for(const child of Object.values(node))await targets(child);
    }
    await targets(value);
  }
  if(value.site_branch_id) {
    const result=resultOf(await client.call('data_pages_tool',{actions:[{label:'Verify project Release ownership',list_site_branches:{site_id:siteId}}]}),'list_site_branches');
    const branches=Array.isArray(result)?result:result.branches || result.siteBranches;
    if(!Array.isArray(branches) || result.pagination?.hasMore || result.pagination?.nextCursor)throw new Error('Cannot verify resource ownership');
    if(!branches.some(branch=>branch.id===value.site_branch_id))throw new Error('Resource does not belong to this project');
  }
  const filterResponse=await checkProjectResources(client,op,value,siteId,owns,resultOf);
  async function walk(node,parent='') {
    if(!node||typeof node!=='object')return;
    for(const [key,v] of Object.entries(node)) {
      if(op.scope==='workspace'&&key==='site_access')continue; // Verified against the live workspace above.
      if(['siteId','site_id'].includes(key)&&v!==siteId)throw new Error('Cross-project site denied');
      if(['page_id','pageId','duplicateOf','origin_page_id'].includes(key)&&v)await owns('page',v);
      if(['collection_id','collectionId'].includes(key)&&v && !['variable'].includes(op.area))await owns('collection',v);
      if(['asset_id','image_asset_id'].includes(key)&&v)await owns('asset',v);
      if(key==='asset_ids'&&Array.isArray(v))for(const id of v)await owns('asset',id);
      if(['folder_id','parent_folder'].includes(key)&&v && !(op.scope==='connection'&&op.area==='standalone_apps'))await owns('folder',v);
      if(key==='form_id'&&v)await owns('form',v);
      if(key==='webhook_id'&&v)await owns('webhook',v);
      if(parent==='pages' && ['id','pageId','page_id'].includes(key))await owns('page',v);
      await walk(v,Array.isArray(node)?parent:key);
    }
  }
  await walk(value);
  return filterResponse;
}
