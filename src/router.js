import { initializeInventory, syncProjects, setDefaults, purgeConnection } from './discovery.js';
import { CATALOG, permissions, validatePermissions, operation, allowed, prepareArguments, checkOwnership, resultOf } from './permissions.js';
import { randomUUID } from 'node:crypto';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import { WEBFLOW_URL, webflowFetch, session, endpoint } from './oauth.js';

export function parseSiteList(response) {
  if (response.isError) throw new Error('Webflow site listing failed');
  for (const item of response.content || []) {
    if (item.type !== 'text') continue;
    let parsed; try { parsed = JSON.parse(item.text); } catch { continue; }
    for (const block of Array.isArray(parsed) ? parsed : [parsed]) {
      if (block.action !== 'list_sites') continue;
      if (block.error || !Array.isArray(block.result?.sites)) throw new Error('Webflow rejected the site listing');
      return { sites: block.result.sites.map(s => {
        if (typeof s.id !== 'string' || typeof s.displayName !== 'string') throw new Error('Unexpected site response');
        return { id: s.id, name: s.displayName, shortName: s.shortName || '', workspaceId: s.workspaceId || null, ...(s.workspaceName || s.workspace?.displayName || s.workspace?.name ? { workspaceName:s.workspaceName || s.workspace?.displayName || s.workspace?.name } : {}) };
      }), pagination: block.result.pagination || {} };
    }
  }
  throw new Error('Unrecognized Webflow site response; no data released');
}

export async function openUpstream(provider) {
  const client = new Client({ name: 'mcp-router', version: '0.7.4' });
  const transport = new StreamableHTTPClientTransport(new URL(provider.serverUrl || WEBFLOW_URL), {
    authProvider: provider, fetch: webflowFetch,
    reconnectionOptions: { maxRetries: 0, initialReconnectionDelay: 1000, maxReconnectionDelay: 1000, reconnectionDelayGrowFactor: 1 }
  });
  try {
    await client.connect(transport);
    const identity = { agent_id: `router|local-poc|${randomUUID().slice(0, 6)}`, session_id: 'start', context: 'The local router is reading authorized site metadata to validate OAuth isolation and enforce explicit project access permissions.' };
    const guide = await client.callTool({ name: 'webflow_guide_tool', arguments: identity });
    if (guide.isError) throw new Error('Webflow guide failed');
    const session = JSON.stringify(guide).match(/ses_[A-Za-z0-9]+/);
    if (!session) throw new Error('Webflow did not issue a session');
    identity.session_id = session[0];
    return {
      call: (name, args) => client.callTool({ name, arguments: { ...args, ...identity } }),
      guide,
      async listSites() {
        const sites = []; let offset = 0;
        for (let page = 0; page < 100; page++) {
          const result = parseSiteList(await client.callTool({ name: 'data_sites_tool', arguments: {
            ...identity, actions: [{ label: 'Read authorized sites', list_sites: { detail: 'summary', limit: 100, offset } }]
          } }));
          sites.push(...result.sites);
          if (!result.pagination.hasMore) return sites;
          if (!result.sites.length) throw new Error('Invalid pagination');
          offset += result.sites.length;
        }
        throw new Error('Site listing exceeded pagination limit');
      },
      close: () => client.close()
    };
  } catch (error) { await client.close().catch(() => {}); throw error; }
}

export class Router {
  constructor(store, oauth, { open = openUpstream } = {}) {
    this.store = store; this.oauth = oauth; this.open = open;
    this.locks = new Map(); this.preparations = new Map();
    initializeInventory(store);
  }
  reorderConnections(ids) {
    const existing=Object.values(this.store.data.connections).filter(c=>!c.deletedAt).map(c=>c.id);
    if(!Array.isArray(ids)||ids.length!==existing.length||new Set(ids).size!==ids.length||ids.some(id=>!existing.includes(id)))throw new Error('Connections changed. Reopen the order dialog and try again.');
    this.store.data.settings.connectionOrder=[...ids];
    this.store.audit('connection_order_saved');
  }
  setDefaultChannel(channel) { endpoint(channel); this.store.data.settings.defaultChannel=channel; this.store.audit('default_channel_saved',{channel}); }
  setDefaultPermissions(value) { setDefaults(this.store, value); }
  async serial(id, action) {
    const previous = this.locks.get(id) || Promise.resolve();
    const next = previous.catch(() => {}).then(action);
    this.locks.set(id, next);
    try { return await next; } finally { if (this.locks.get(id) === next) this.locks.delete(id); }
  }
  createConnection(name) {
    const autoName = name === undefined || name === '';
    if (autoName) name = `Connection ${Object.keys(this.store.data.connections).length + 1}`;
    if (typeof name !== 'string' || !name.trim() || name.length > 60) throw new Error('Use a connection name of 1–60 characters');
    const id = randomUUID();
    this.store.data.connections[id] = { id, name: name.trim(), sourceName:null, nameOverride:autoName ? null : name.trim(), enabled: true, status: 'needs_authorization', sites: [] };
    this.store.audit('connection_created', { connectionId: id }); return id;
  }
  setConnection(id, enabled) {
    if (typeof enabled !== 'boolean') throw new Error('enabled must be boolean');
    const c = this.store.connection(id); c.enabled = enabled;
    if (!enabled) { delete c.pending; if(c.beta)delete c.beta.pending; }
    this.store.audit('connection_toggled', { connectionId: id, enabled });
  }
  project(id, capability = 'site:read') {
    const p = Object.hasOwn(this.store.data.projects, id) ? this.store.data.projects[id] : null;
    if (!p || p.deletedAt || p.available === false || !p.enabled || (capability && !permissions(p)[capability]) || !this.store.connection(p.connectionId).enabled) throw new Error('Project access denied');
    return p;
  }
  saveProject({ id = randomUUID(), name, connectionId, siteId, enabled = false, read = true, ...unknown }) {
    if (Object.keys(unknown).length || typeof name !== 'string' || !name.trim() || name.length > 80 || typeof enabled !== 'boolean' || typeof read !== 'boolean') throw new Error('Invalid project policy; writes are unsupported');
    const c = this.store.connection(connectionId);
    if (!c.sites.some(s => s.id === siteId)) throw new Error('Site is not in this connection’s verified site list');
    if (!/^[a-zA-Z0-9_-]{1,80}$/.test(id) || ['__proto__', 'constructor', 'prototype'].includes(id)) throw new Error('Invalid project ID');
    if (this.store.data.projects[id]?.deletedAt) throw new Error('Restore the deleted project before editing it');
    this.store.data.projects[id] = { id, name: name.trim(), connectionId, siteId, enabled, read };
    this.store.audit('project_policy_saved', { projectId: id, enabled, read }); return id;
  }
  edit(kind, id, updates) {
    if (!['connections', 'projects'].includes(kind) || !Object.hasOwn(this.store.data[kind], id)) throw new Error('Unknown item');
    const item = this.store.data[kind][id];
    if (item.deletedAt) throw new Error('Item is deleted');
    const allowed = kind === 'projects' ? ['name', 'enabled', 'read', 'permissions', 'useDefaultName', 'favourite', 'channel'] : ['name', 'useDefaultName'];
    if (!updates || Object.keys(updates).some(k => !allowed.includes(k))) throw new Error('Unsupported permission or field');
    if ('channel' in updates && !(kind==='projects'?['inherit','stable','beta']:['stable','beta']).includes(updates.channel)) throw new Error('Invalid MCP channel');
    if ('name' in updates && (typeof updates.name !== 'string' || !updates.name.trim() || updates.name.length > 80)) throw new Error('Invalid name');
    if ('useDefaultName' in updates && typeof updates.useDefaultName !== 'boolean') throw new Error('Invalid name mode');
    if (updates.useDefaultName && 'name' in updates) throw new Error('Choose default name or override');
    for (const key of ['enabled', 'read', 'favourite']) if (key in updates && typeof updates[key] !== 'boolean') throw new Error('Invalid permission');
    if ('permissions' in updates) { updates.permissions = validatePermissions(updates.permissions); updates.read = !!updates.permissions['site:read']; }
    else if ('read' in updates && item.permissions) updates.permissions = { ...item.permissions, 'site:read': updates.read };
    if (kind === 'projects' && ('permissions' in updates || 'read' in updates || updates.enabled === true)) item.usesDefaultPermissions = false;
    if ('name' in updates) { item.nameOverride = updates.name.trim(); if (kind === 'projects') item.sourceName ||= item.name; }
    if (updates.useDefaultName && kind === 'connections' && !item.sourceName) throw new Error('Webflow has not provided a workspace name');
    if (updates.useDefaultName) { item.nameOverride = null; item.name = item.sourceName || item.name; }
    delete updates.useDefaultName;
    Object.assign(item, updates, 'name' in updates ? { name: updates.name.trim() } : {});
    this.store.audit('item_edited', { kind, id });
  }
  remove(kind, id) {
    if (kind === 'projects') throw new Error('Projects are managed by connection discovery and cannot be deleted');
    if (!['connections', 'projects'].includes(kind) || !Object.hasOwn(this.store.data[kind], id)) throw new Error('Unknown item');
    purgeConnection(this.store,id);
    this.store.audit('connection_deleted_permanently', {id});
  }
  restore() { throw new Error('Deleted connections cannot be restored'); }
  async sites(id, { refresh = false, channel = this.store.data.settings.defaultChannel || 'stable' } = {}) {
    return this.serial(id, async () => {
      const c = this.store.connection(id), auth=session(this.store,id,channel);
      if (!c.enabled || !auth.tokens) throw new Error('Connection disabled or authorization required');
      let client;
      try {
        if (refresh) await this.oauth.refresh(id,channel);
        client = await this.open(this.oauth.provider(id,false,channel));
        const sites = await client.listSites();
        if (!c.enabled || c.deletedAt) throw new Error('Connection was disabled during the request');
        if(channel==='stable')c.stableSites=sites; else {c.stableSites ||= c.sites || []; auth.sites=sites;}
        c.sites=[...new Map([...(c.stableSites||[]),...(c.beta?.sites||[])].map(s=>[s.id,s])).values()];
        auth.lastChecked=new Date().toISOString(); auth.inventoryPending=false; auth.status='connected'; auth.lastError=null; c.lastChecked = new Date().toISOString(); auth.status = 'connected'; c.lastError = null;
        syncProjects(this.store, id);
        this.store.audit('connection_read_succeeded', { connectionId: id, siteCount: sites.length });
        return sites;
      } catch (error) {
        auth.status = 'check_failed';
        c.lastError = 'Connection check failed. Retry or reconnect; credentials were not copied to another connection.';
        const category = ['InvalidGrantError', 'InvalidClientError', 'UnauthorizedError', 'StreamableHTTPError', 'InvalidScopeError'].includes(error.constructor?.name) ? error.constructor.name : 'upstream_or_transport_error';
        this.store.audit('connection_read_failed', { connectionId: id, category });
        throw new Error(c.lastError);
      } finally { await client?.close().catch(() => {}); }
    });
  }
  async verify(ids) {
    if (!Array.isArray(ids) || ids.length !== 2 || new Set(ids).size !== 2) throw new Error('Select exactly two different connections');
    const [a, b] = ids.map(id => this.store.connection(id));
    if (!a.client?.client_id || !b.client?.client_id || a.client.client_id === b.client.client_id) throw new Error('Two separate OAuth clients must be authorized first');
    const steps = [];
    for (const id of [a.id, b.id, a.id]) {
      try { await this.sites(id); steps.push({ connectionId: id, action: 'read_sites', passed: true }); }
      catch { steps.push({ connectionId: id, action: 'read_sites', passed: false }); }
    }
    const report = { checkedAt: new Date().toISOString(), independentClients: true, passed: steps.every(s => s.passed), steps,
      limitation: 'This checks current coexistence only. Refresh both connections and restart the daemon to test persistence and token rotation.' };
    this.store.audit('isolation_check', { passed: report.passed });
    return report;
  }
  channel(p) { return p.channel && p.channel!=='inherit' ? p.channel : this.store.data.settings.defaultChannel || 'stable'; }
  async extendedCall(name,args) {
    const fields={get_project_operations:['projectId','operationId'],prepare_project:['projectId'],read_webflow:['projectId','operationId','params','pageId'],write_webflow:['projectId','operationId','params','pageId','preparationId']}[name];
    if(Object.keys(args).some(k=>!fields.includes(k)) || typeof args.projectId!=='string')throw new Error('Invalid arguments');
    const p=structuredClone(this.project(args.projectId,null));
    const signature=()=>JSON.stringify([this.project(p.id,null),this.channel(p)]);
    const initial=signature();
    const recheck=()=>{if(signature()!==initial)throw new Error('Project policy changed during request');};
    if(name==='get_project_operations') {
      const operations=CATALOG.filter(op=>allowed(p,op));
      if(args.operationId){const op=operations.find(o=>o.id===args.operationId);if(!op)throw new Error('Operation not permitted');return {...op,notes:'Site IDs are selected by the router. Supply pageId separately for page tools. Read project instructions with prepare_project before writes.'};}
      return operations.map(({id,title,mode,permission,extraPermissions,page})=>({id,area:title,mode,permission,extraPermissions,requiresPageId:page}));
    }
    if(name==='prepare_project' && !permissions(p)['agent_instructions:read'])throw new Error('Instruction read permission is required to prepare a project');
    const op=name==='prepare_project'?null:operation(args.operationId);
    if(op && (!allowed(p,op) || (name==='read_webflow' && op.mode!=='read') || (name==='write_webflow' && op.mode==='read')))throw new Error('Operation permission denied');
    const prepared=op?prepareArguments(op,args.params||{},p.siteId,args.pageId):null;
    return this.serial(p.connectionId,async()=>{
      recheck();let client;
      try {
        const channel=this.channel(p);
        if(!session(this.store,p.connectionId,channel).tokens)throw new Error('Authorization required for selected MCP channel');
        client=await this.open(this.oauth.provider(p.connectionId,false,channel));
        if(channel==='beta' && !(await client.listSites()).some(s=>s.id===p.siteId))throw new Error('Project is not authorized on Beta');
        if(name==='prepare_project') {
          const instructions=[];let offset=0;
          for(let page=0;page<100;page++) {
            const result=resultOf(await client.call('data_agent_instructions_tool',{actions:[{label:'Read project instructions',search_instructions:{site_id:p.siteId,limit:100,offset}}]}),'search_instructions');
            if(!Array.isArray(result.instructions))throw new Error('Instruction discovery failed');
            for(const rule of result.instructions.filter(x=>!x.isDraft && x.enabled!==false)) {
              if(typeof rule.path!=='string')throw new Error('Instruction path unavailable');
              instructions.push({path:rule.path,content:await client.call('data_agent_instructions_tool',{actions:[{label:'Read enabled instruction',read_instruction:{site_id:p.siteId,path:rule.path,resolve_references:true}}]})});
              resultOf(instructions.at(-1).content,'read_instruction');
            }
            offset+=result.instructions.length;
            if(offset>=(result.pagination?.total??offset) && result.pagination?.hasMore!==true)break;
            if(!result.instructions.length||page===99)throw new Error('Instruction discovery incomplete');
          }
          recheck();const preparationId=randomUUID();
          for(const [id,v] of this.preparations)if(v.expires<Date.now())this.preparations.delete(id);
          this.preparations.set(preparationId,{projectId:p.id,policy:initial,expires:Date.now()+600000});
          return {preparationId,expiresInSeconds:600,guide:client.guide,instructions,notice:'Read and follow all enabled rules and relevant skills before calling write_webflow. This preparation is bound to the current project policy.'};
        }
        if(op.mode!=='read') {
          const proof=this.preparations.get(args.preparationId);
          if(!proof||proof.projectId!==p.id||proof.policy!==initial||proof.expires<Date.now())throw new Error('Run prepare_project and read its instructions before writing');
        }
        await checkOwnership(client,op,prepared.value,p.siteId,args.pageId);
        recheck();
        this.store.audit('operation_started',{projectId:p.id,operationId:op.id,mode:op.mode});
        const response=await client.call(op.tool,prepared.args);
        recheck();
        if(response.isError)throw new Error('Webflow rejected operation');
        this.store.audit('operation_completed',{projectId:p.id,operationId:op.id,mode:op.mode});
        return response;
      } catch(error) {
        this.store.audit('operation_failed',{projectId:p.id,operationId:op?.id||'prepare_project'});
        // Do not log or expose provider error payloads; they can include request content.
        if(['Operation permission denied','Resource does not belong to this project','Project policy changed during request','Run prepare_project and read its instructions before writing'].includes(error.message))throw error;
        throw new Error('Operation failed or resource ownership could not be verified. Check OAuth, permissions and Webflow requirements.');
      } finally {await client?.close().catch(()=>{});}
    });
  }
  async call(name, args = {}) {
    if (!args || typeof args !== 'object' || Array.isArray(args)) throw new Error('Invalid arguments');
    if (name === 'list_projects' && !Object.keys(args).length) {
      return Object.values(this.store.data.projects).filter(p => !p.deletedAt && !this.store.data.connections[p.connectionId]?.deletedAt && p.available !== false && p.enabled && Object.values(permissions(p)).some(Boolean) && this.store.connection(p.connectionId).enabled)
        .map(p => ({ id:p.id, name:p.name, capabilities: Object.entries(permissions(p)).filter(([,v])=>v).map(([k])=>k) }));
    }
    if (['get_project_operations','prepare_project','read_webflow','write_webflow'].includes(name)) return this.extendedCall(name,args);
    if (name !== 'read_project_site' || Object.keys(args).length !== 1 || typeof args.projectId !== 'string') {
      this.store.audit('tool_denied'); throw new Error('Tool or arguments denied; this POC supports project site reads only');
    }
    const p = { ...this.project(args.projectId) };
    const channel=this.channel(p);
    const sites = await this.sites(p.connectionId,{channel});
    const current = this.project(p.id);
    if (this.channel(current)!==channel || current.connectionId !== p.connectionId || current.siteId !== p.siteId) throw new Error('Project mapping changed during request');
    const site = sites.find(s => s.id === p.siteId);
    if (!site) throw new Error('Project site is no longer authorized');
    this.store.audit('project_site_read', { projectId: p.id, connectionId: p.connectionId });
    return site;
  }
}
