// Explicit resource chains for reviewed Webflow families. All discovery stays on
// the selected grant; only filtered, reconstructed results may cross site scope.
const denied = () => { throw new Error('Resource does not belong to this project'); };
const invalid = () => { throw new Error('Cannot verify resource ownership'); };
const object = value => value && typeof value === 'object' && !Array.isArray(value);
const id = value => typeof value === 'string' && value.length > 0;
const envelope = (action, result) => ({content:[{type:'text',text:JSON.stringify({action,result})}]});

export async function checkProjectResources(client, op, value, siteId, owns, resultOf) {
  if (op.area === 'libraries') {
    const list = async action => {
      const result = resultOf(await client.call(op.tool,{actions:[{label:'Verify library membership',[action]:{site_id:siteId}}]}),action);
      const rows = Array.isArray(result) ? result : result?.libraries;
      if (!Array.isArray(rows) || rows.some(row => !id(row?.id))) invalid();
      return rows;
    };
    if (['install_library','start_library_install_changelog','uninstall_library'].includes(op.action)) {
      const installed = op.action === 'uninstall_library';
      const rows = await list(installed ? 'list_installed_libraries' : 'list_libraries');
      if (!rows.some(row => row.id === value.library_id)) denied();
    }
    if (op.action === 'share_library') {
      for (const folder of value.excluded_asset_folder_ids || []) if (folder !== 'NO_FOLDER') await owns('folder',folder);
    }
    if (op.action === 'import_library_resources') {
      const resources = [...(value.component_ids || []), ...(value.asset_ids || [])];
      if (!resources.length) invalid();
      const installed = new Set((await list('list_installed_libraries')).map(row => row.id));
      for (const resource of resources) {
        const match = /^library:([^:]+):([^:]+)$/.exec(resource);
        if (!match || !installed.has(match[1])) denied();
      }
    }
    return;
  }
  if(!['data_apps_tool','data_campaigns_tool','data_members_tool','data_optimize_tool','data_aeo_brand_presences_tool'].includes(op.tool))return;
  const read = async (tool,action,params) => resultOf(await client.call(tool,{actions:[{label:'Verify project resource ownership',[action]:params}]}),action);
  const cache=new Map();
  async function workspace() {
    if(!cache.has('workspace')) {
      const result=await read('data_sites_tool','get_site',{site_id:siteId});
      if(result?.id!==siteId || !id(result.workspaceId))invalid();
      cache.set('workspace',result.workspaceId);
    }
    return cache.get('workspace');
  }
  // Cursor endpoints have explicit next-cursor contracts. Never assume an
  // incomplete response proves ownership or allows an account-wide result out.
  async function cursorRows(tool,action,params,field,{nested=false,required=false}={}) {
    const rows=[],seen=new Set();let cursor;
    for(let page=0;page<100;page++) {
      const result=await read(tool,action,{...params,...(cursor?{cursor}:{})});
      if(!Array.isArray(result?.[field]))invalid();
      rows.push(...result[field]);
      const container=nested?result.pagination:result;
      if(required && (!object(container)||!Object.hasOwn(container,'nextCursor')))invalid();
      const next=container?.nextCursor;
      if(next==null)return rows;
      if(!id(next)||seen.has(next))invalid();
      seen.add(next);cursor=next;
    }
    invalid();
  }
  async function offsetRows(action,params,field) {
    const rows=[];let offset=0;
    for(let page=0;page<100;page++) {
      const result=await read('data_campaigns_tool',action,{...params,limit:100,offset});
      if(!Array.isArray(result?.[field]))invalid();
      rows.push(...result[field]);
      if(result.hasMore===false)return {rows,fields:result.fields};
      if(result.hasMore!==true || !Number.isInteger(result.nextOffset)||result.nextOffset<=offset||!result[field].length)invalid();
      offset=result.nextOffset;
    }
    invalid();
  }
  if(op.tool==='data_aeo_brand_presences_tool') {
    // Brand records belong to the whole workspace, never to a single site.
    if(value.workspace_id!==await workspace())denied();
    if(value.brand_presence_id) {
      const brand=await read(op.tool,'get_brand_presence',{workspace_id:value.workspace_id,brand_presence_id:value.brand_presence_id});
      if(brand?.id!==value.brand_presence_id || brand.workspaceId!==value.workspace_id)denied();
    }
    const topics=[value.topic_id,value.topicId,...(value.prompts||[]).map(p=>p.topicId)].filter(Boolean);
    for(const topic of new Set(topics)) {
      const result=await read(op.tool,'get_topic',{workspace_id:value.workspace_id,brand_presence_id:value.brand_presence_id,topic_id:topic});
      if(result?.id!==topic)denied(); // Upstream verifies brand membership with this scoped endpoint.
    }
    if(value.prompt_id) {
      const result=await read(op.tool,'get_prompt',{workspace_id:value.workspace_id,brand_presence_id:value.brand_presence_id,prompt_id:value.prompt_id});
      if(result?.id!==value.prompt_id)denied();
    }
  }
  if(op.tool==='data_apps_tool') {
    if(op.area==='standalone_apps') {
      if(value.site_id!==undefined)denied();
      return; // Webflow resolves the workspace and folder for this explicit connection grant.
    }
    if(op.action==='create_app' && (value.folder_id!==undefined||value.site_specific_access!==undefined))throw new Error('Use create_standalone_app with the standalone app grant in Connection permissions');
    if(value.app_id) {
      const apps=await cursorRows(op.tool,'list_apps',{site_id:siteId,limit:100},'apps');
      const app=apps.find(a=>a.id===value.app_id);
      if(!app||app.siteId!==siteId)denied();
      // Standalone apps are still scoped to their approved backing site. A
      // delete can unpublish that site, hence its separate Publish prerequisite.
      if(value.env_id) {
        const environments=await cursorRows(op.tool,'list_environments',{app_id:value.app_id,limit:100},'environments');
        if(!environments.some(e=>e.id===value.env_id))denied();
      }
      if(value.deployment_id) {
        const deployments=await cursorRows(op.tool,'list_deployments',{app_id:value.app_id,env_id:value.env_id,limit:100},'deployments');
        if(!deployments.some(d=>d.id===value.deployment_id))denied();
      }
    }
    // Site injection in prepareArguments forces app creation to attach to the
    // approved existing site rather than create a new standalone site.
    if(op.action==='list_apps')return response=>{
      const result=resultOf(response,op.action);
      if(!Array.isArray(result?.apps)||result.apps.some(a=>a.siteId!==siteId))invalid();
      return response;
    };
  }
  if(op.tool==='data_campaigns_tool') {
    if(op.action==='list_campaign_hub_sites') {
      if(value.workspace_id!==await workspace())denied();
      return response=>{
        const result=resultOf(response,op.action);
        if(!Array.isArray(result?.campaignSites)||result.campaignSites.some(s=>!id(s?.id)))invalid();
        return envelope(op.action,{campaignSites:result.campaignSites.filter(s=>s.id===siteId)});
      };
    }
    if(value.campaign_id) {
      const campaign=await read(op.tool,'get_campaign',{site_id:siteId,campaign_id:value.campaign_id});
      if(campaign?.id!==value.campaign_id||campaign.siteId!==siteId)denied();
      if(value.element_id) {
        if(value.element_id.component!==campaign.landingPage?.pageId)denied();
        await owns('page',value.element_id.component);
      }
      if(value.page_variation_id || value.variations || value.page_variation_ids || value.field_slug) {
        const listing=await offsetRows('get_page_variations',{site_id:siteId,campaign_id:value.campaign_id},'variations');
        const ids=[...(value.page_variation_id?[value.page_variation_id]:[]),...(value.variations||[]).map(v=>v.page_variation_id),...(value.page_variation_ids||[])];
        if(ids.some(target=>!listing.rows.some(v=>v.pageVariationId===target)))denied();
        if(value.field_slug && (!Array.isArray(listing.fields)||!listing.fields.some(f=>f.fieldSlug===value.field_slug)))denied();
      }
      if(value.page_variation_suggestion_id) {
        const result=await read(op.tool,'get_page_variation_suggestions',{site_id:siteId,campaign_id:value.campaign_id});
        if(!Array.isArray(result?.suggestions)||!result.suggestions.some(s=>s.pageVariationSuggestionId===value.page_variation_suggestion_id))denied();
      }
    }
    // Campaign publishing targets one of the selected site's own custom domains.
    if(value.custom_domain!==undefined) {
      const site=await read('data_sites_tool','get_site',{site_id:siteId});
      if(site?.id!==siteId || !Array.isArray(site.customDomains))invalid();
      if(!site.customDomains.some(domain=>id(domain?.id)&&domain.id===value.custom_domain))denied();
    }
    // Task status is explicitly site-bound upstream; no unscoped task lookup.
  }
  if(op.tool==='data_members_tool') {
    const workspaceId=await workspace();
    if(value.workspace_id && value.workspace_id!==workspaceId)denied();
    if(value.member_id || value.member_ids?.length || value.invite_ids?.length) {
      const action=op.scope==='workspace'||op.action==='grant_site_access'?'list_workspace_members':'list_site_members';
      const params=action==='list_workspace_members'?{workspace_id:workspaceId,limit:100}:{site_id:siteId,limit:100};
      const members=await cursorRows(op.tool,action,params,'members',{nested:true,required:true});
      for(const target of [...(value.member_id?[value.member_id]:[]),...(value.member_ids||[])])if(!members.some(m=>m.id===target))denied();
      if(value.invite_ids?.length) {
        const invites=await cursorRows(op.tool,'list_workspace_members',params,'invites',{nested:true,required:true});
        if(value.invite_ids.some(target=>!invites.some(i=>i.id===target)))denied();
      }
    }
    // Explicit Workspace Members permission may intentionally affect additional
    // sites in that workspace. Verify each named site against the live workspace.
    if(op.scope==='workspace' && value.site_access)for(const access of value.site_access) {
      const site=await read('data_sites_tool','get_site',{site_id:access.site_id});
      if(site?.id!==access.site_id||site.workspaceId!==workspaceId)denied();
    }
    // Site role IDs are resolved by the workspace-bound upstream endpoints;
    // they cannot expand the explicit site/workspace target of these actions.
  }
  if(op.tool==='data_optimize_tool') {
    const references=await read(op.tool,'list_optimize_resources',{});
    if(!Array.isArray(references?.references) || references.references.some(r=>!id(r?.optimizeId)||!object(r.resource)))invalid();
    const all=references.references;
    const scoped=all.filter(r=>r.resource.type==='webflow-site' && r.resource.siteId===siteId && all.filter(other=>other.optimizeId===r.optimizeId).length===1);
    if(op.action==='list_optimize_resources') {
      // Filter the execution response as well, so discovery cannot leak another
      // site's identifiers through content, structuredContent or extra blocks.
      return response=>{
        const result=resultOf(response,op.action);
        if(!Array.isArray(result?.references)||result.references.some(r=>!id(r?.optimizeId)||!object(r.resource)))invalid();
        return envelope(op.action,{references:result.references.filter(r=>r.resource.type==='webflow-site'&&r.resource.siteId===siteId&&result.references.filter(x=>x.optimizeId===r.optimizeId).length===1)});
      };
    }
    if(!scoped.some(r=>r.optimizeId===value.optimizeId))denied();
    if(value.optimizationId) {
      const rows=await cursorRows(op.tool,'list_optimizations',{optimizeId:value.optimizeId,pageSize:200,status:['live','draft','ready','archived','off']},'optimizations');
      if(!rows.some(o=>(o.optimizationId||o.id)===value.optimizationId))denied();
    }
  }
}
