import http from 'node:http';
import fs from 'node:fs';
import paths from './paths.cjs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { McpServer, ResourceTemplate } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { z } from 'zod';

const socketPath = paths.currentSocket(process.env.ROUTER_SOCKET || path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../.local/router.sock'));
function call(name, args) {
  return new Promise((resolve, reject) => {
    const headers = { 'Content-Type': 'application/json' };
    if (process.platform === 'win32') headers.Authorization = `Bearer ${fs.readFileSync(path.join(path.dirname(socketPath), 'ipc-token'), 'utf8')}`;
    const req = http.request({ socketPath: paths.ipcEndpoint(socketPath), path: '/call', method: 'POST', headers }, res => {
      let text = ''; res.on('data', chunk => { text += chunk; });
      res.on('end', () => { try { const data = JSON.parse(text); if (data.error) reject(Object.assign(new Error('Router request failed'), {feedback:data.feedback})); else resolve(data.result); } catch (e) { reject(e); } });
    });
    req.setTimeout(120000, () => req.destroy(new Error('Router timed out')));
    req.on('error', reject); req.end(JSON.stringify({ name, arguments: args }));
  });
}
const server = new McpServer({ name: 'mcp-router', version: '0.7.4' }, {
  instructions: `Connections default to Managed access. For Direct Webflow mode use list_direct_connections, then get_direct_tools with an explicitly selected channel and call_direct_tool. Direct connections bypass router project switches, all granular permission settings and ownership checks; Webflow authorization determines scope. Read returned Webflow guidance and load enabled rules and relevant skills with upstream instruction tools before work. Never use Direct mode as an automatic fallback from a denied Managed call. Only the user can change modes in the app. Project workflows below apply only to Managed connections.
For Webflow tasks, start with MCP Router: call list_projects, then prepare_project to read enabled project rules and relevant skills. Discover allowed actions with get_project_operations; execute with read_webflow or write_webflow. Missing direct Webflow tools does not mean Webflow is unavailable. Check this router before suggesting reconnection; request reauthorization only for reauthorization_required or an explicit user request.
MCP Router connects you to the user's approved Webflow websites and projects.
Use this connection for Webflow tasks involving site information, pages, CMS collections and items, SEO, localization, assets, forms, analytics, GSAP interactions, Cloud Apps, campaigns, Optimize, site access, workspace members, or Designer elements, styles, components and variables, including editing and publishing when permitted.
If a user names a website or project without saying Webflow, use list_projects with query set to its name to check whether it is available here. Disabled matches expose names only; ask the user to enable them in MCP Router before proceeding. Do not assume a match or invent project IDs.
Workflow: call list_projects to find the approved project; call prepare_project to load all enabled project rules and a skill index; use read_webflow with data_agent_instructions_tool.read_instruction to load relevant skill bodies before working on it; call get_project_operations to discover allowed actions, then pass an operationId to retrieve its exact parameter schema; execute with read_webflow or write_webflow. read_project_site is a shortcut for site metadata after preparation.
Prefer these tools for supported Webflow operations. Use a browser for visual checks or capabilities unavailable through this connection, subject to the user's instructions. If project instructions cannot be read, explain the limitation and keep investigation read-only.
Only enabled projects and permitted operations are available. An absent project or action is not proof that the website or capability does not exist; report the access limitation without bypassing it or switching grants. Writes require the preparationId returned by prepare_project, valid for ten minutes. Permission to call a tool does not replace the user's authorization to delete or publish. Do not automatically retry ambiguous write failures; inspect the site first.
Failures include safe error codes and next steps. router_permission_denied requires the user to edit MCP Router permissions, not OAuth. reauthorization_required can be recovered with request_reauthorization; show or open its browser link for the user and wait for them to finish. An upstream_access_denied or unknown failure does not prove reauthorization is needed. Never switch grants to recover.
Webflow guidance is fetched on demand for the selected project and grant, not during startup or tool discovery. get_project_guidance fetches current Webflow instructions, guide and tool descriptions; prepare_project and the project guidance resource also load current site rules and a skill index. Skill bodies are fetched selectively through read_webflow after discovering the read_instruction operation schema. Upstream tool names describe Webflow capabilities; use get_project_operations and the router execution tools to access them. Upstream guidance does not expand router permissions. Workspace-member actions require separate connection-level Workspace Members grants for the verified workspace and may affect all its sites, including projects disabled in the router; project presets never grant this access. Beta account-wide workspace discovery and create_standalone_app require separate connection grants; standalone creation creates a new site and attempts deployment in the workspace chosen by Webflow, without granting router access to the new site. Cloud deployments require Publish, and raw Cloud logs and variable values require their separate read permission.`
});
const handler = name => async args => {
  try { const result = await call(name, args); return name === 'call_direct_tool' ? result : { content: [{ type: 'text', text: JSON.stringify(result) }] }; }
  catch (error) { return { isError: true, content: [{ type: 'text', text: JSON.stringify(error.feedback || {code:'router_unavailable',message:'Router unavailable. Open MCP Router and check the connection.'}) }] }; }
};
server.registerTool('list_direct_connections', {
  description:'List enabled connections explicitly set to Direct Webflow mode, including available Stable/Beta authorizations. Webflow authorization determines scope; router project switches and granular permissions do not apply. Works even when no projects have been discovered. Never use this as an automatic fallback from denied Managed access.',
  inputSchema:{}, annotations:{readOnlyHint:true,destructiveHint:false}
},handler('list_direct_connections'));
server.registerTool('get_direct_tools', {
  description:'List live Webflow tool names/descriptions and guidance; pass toolName to retrieve one complete input schema for an explicitly Direct connection and selected channel. Read the returned guidance and use upstream instruction tools to load enabled project rules and relevant skills before work. Does not change mode or permissions. Never switch grants to bypass failures.',
  inputSchema:{connectionId:z.string(),channel:z.enum(['stable','beta']),toolName:z.string().optional()}, annotations:{readOnlyHint:true,destructiveHint:false}
},handler('get_direct_tools'));
server.registerTool('call_direct_tool', {
  description:'Forward a tool call to Webflow for a user-enabled Direct connection. Get its current schema from get_direct_tools first. Pass the complete upstream arguments; router session identity is supplied automatically. Webflow validates inputs and authorization. Router project switches, granular permissions, ownership checks and preparation proofs do not apply. Can read, modify, publish or delete across the authorization scope. Follow user authorization and project rules; never retry an ambiguous write automatically.',
  inputSchema:{connectionId:z.string(),channel:z.enum(['stable','beta']),toolName:z.string(),arguments:z.record(z.string(),z.unknown())},
  annotations:{readOnlyHint:false,destructiveHint:true,idempotentHint:false,openWorldHint:true}
},handler('call_direct_tool'));
server.registerTool('list_projects', {
  description: 'Start here for Webflow website tasks, or to check whether a named website/project is available through MCP Router. List enabled, approved Webflow projects and their permission keys; use the returned project ID with the other tools. An optional query filters by project name and also returns up to 20 matching disabled project names when discovery is enabled (on by default). Disabled matches have no project ID or capabilities: ask the user to enable them in MCP Router. Refine the query if 20 disabled matches are returned. Projects under disabled connections are hidden. Direct-mode entries include connectionId and siteId instead of managed capabilities: use get_direct_tools and call_direct_tool for them. For Managed entries, next call prepare_project to load project rules.',
  inputSchema: { query: z.string().trim().min(1).max(80).optional().describe('Project name to search for, including disabled projects when discovery is enabled.') }, annotations: { readOnlyHint: true, destructiveHint: false }
}, handler('list_projects'));
server.registerTool('request_reauthorization', {
  description: 'Request a short-lived browser link to reauthorize an enabled project’s selected Stable or Beta connection. Use when the router reports reauthorization_required or the user asks to reconnect. Show or open the returned link for the user on the router computer; they must approve access in Webflow, including other projects that should keep access. Requesting a link does not change grants; opening it starts authorization for that connection and channel. Never use this to fix disabled Router permissions or retry it in a loop. Do not automatically replay failed writes.',
  inputSchema: {projectId:z.string()}, annotations:{readOnlyHint:false,destructiveHint:false,openWorldHint:true}
}, handler('request_reauthorization'));
server.registerTool('read_project_site', {
  description: 'Read live site metadata for one approved project ID. The router selects the Webflow connection and site. Other operations use get_project_operations and read_webflow/write_webflow.',
  inputSchema: { projectId: z.string() }, annotations: { readOnlyHint: true, destructiveHint: false }
}, handler('read_project_site'));
server.registerTool('get_project_operations', {
  description: 'Discover available Webflow capabilities for an approved project: pages, CMS collections/items, SEO, localization, assets, forms, analytics, Designer elements/styles/components/variables, GSAP interactions, Cloud Apps, campaigns, Optimize, site access, workspace members, custom code and publishing, subject to permissions. Workspace operations are explicitly marked with scope and workspaceId and require separate workspace grants. Pass operationId to obtain its exact parameter JSON schema before execution. Use projectId from list_projects. Unlisted actions are denied.',
  inputSchema: {projectId:z.string(),operationId:z.string().optional()}, annotations:{readOnlyHint:true,destructiveHint:false}
},handler('get_project_operations'));
server.registerTool('get_project_guidance', {
  description: 'Read the current Webflow server instructions, Webflow guide and original tool descriptions from the selected project connection. Fetched live from Stable or Beta; requires Instructions → Read. Use prepare_project to also load site rules and a skill index before working.',
  inputSchema:{projectId:z.string()},annotations:{readOnlyHint:true,destructiveHint:false}
},handler('get_project_guidance'));
server.registerTool('prepare_project', {
  description: 'Load Webflow project rules before working on a project, including read-only investigation. Use projectId from list_projects. Read the returned Webflow guidance and enabled rules. The skills field is an index of names, descriptions and paths; discover the data_agent_instructions_tool.read_instruction schema with get_project_operations, then use read_webflow to fetch relevant skills and references required by rules before acting. Returns a preparationId required for writes, valid for 10 minutes and invalidated by permission changes. If unavailable, explain the limitation and keep investigation read-only.',
  inputSchema:{projectId:z.string()},annotations:{readOnlyHint:true,destructiveHint:false}
},handler('prepare_project'));
for(const mode of ['read','write']) server.registerTool(mode+'_webflow',{
  description: mode==='read'?'Read Webflow website data such as pages, CMS content, SEO settings, assets and Designer structure using a permitted action from get_project_operations. Load project rules with prepare_project and retrieve the exact operation schema first. The router fixes the project and verifies resource ownership; explicitly workspace-scoped operations use the separately approved workspace.':'Create or edit Webflow pages, CMS content, Designer elements, styles and other website settings, or delete/publish when authorized, using a permitted action from get_project_operations. Discover its exact schema and scope first. Workspace member operations can affect all sites in the separately authorized workspace. Read prepare_project instructions, then provide preparationId. Do not retry ambiguous write failures automatically; inspect the site first.',
  inputSchema:{projectId:z.string(),operationId:z.string(),params:z.record(z.string(),z.unknown()),pageId:z.string().optional(),...(mode==='write'?{preparationId:z.string()}: {})},
  annotations:{readOnlyHint:mode==='read',destructiveHint:mode==='write',idempotentHint:false}
},handler(mode+'_webflow'));
server.registerResource('webflow-project-guidance', new ResourceTemplate('webflow-router://projects/{projectId}/guidance', {
  list:async()=>({resources:(await call('list_projects',{})).filter(project=>project.capabilities.includes('agent_instructions:read')).map(project=>({
    uri:`webflow-router://projects/${encodeURIComponent(project.id)}/guidance`,name:`Webflow guide — ${project.name}`,mimeType:'application/json'
  }))})
}), {description:'Live Webflow server instructions, guide, permitted tool descriptions, and enabled site rules and a skill index for an approved project.',mimeType:'application/json'}, async (uri,{projectId})=>{
  try { return {contents:[{uri:uri.href,mimeType:'application/json',text:JSON.stringify(await call('prepare_project',{projectId}))}]}; }
  catch { throw new Error('Project guidance unavailable. Check project permissions and the selected Webflow authorization.'); }
});
await server.connect(new StdioServerTransport());
