import http from 'node:http';
import fs from 'node:fs';
import paths from './paths.cjs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { McpServer, ResourceTemplate } from '@modelcontextprotocol/sdk/server/mcp.js';
import { ListToolsRequestSchema } from '@modelcontextprotocol/sdk/types.js';
import { toJsonSchemaCompat } from '@modelcontextprotocol/sdk/server/zod-json-schema-compat.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { z } from 'zod';

const socketPath = paths.currentSocket(process.env.ROUTER_SOCKET || path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../.local/router.sock'));
function call(name, args) {
  return new Promise((resolve, reject) => {
    const headers = { 'Content-Type': 'application/json' };
    if (process.platform === 'win32') headers.Authorization = `Bearer ${fs.readFileSync(path.join(path.dirname(socketPath), 'ipc-token'), 'utf8')}`;
    const req = http.request({ socketPath: paths.ipcEndpoint(socketPath), path: '/call', method: 'POST', headers }, res => {
      let text = ''; res.on('data', chunk => { text += chunk; });
      res.on('end', () => { try { const data = JSON.parse(text); if (data.error) reject(new Error(data.error)); else resolve(data.result); } catch (e) { reject(e); } });
    });
    req.setTimeout(120000, () => req.destroy(new Error('Router timed out')));
    req.on('error', reject); req.end(JSON.stringify({ name, arguments: args }));
  });
}
async function liveContext() {
  try { return (await call('get_agent_context', {})).contexts; }
  catch { return []; }
}
function upstreamInstructions(contexts) {
  return contexts.filter(context=>context.instructions).map(context=>
    `Webflow instructions for project ${context.projectId} (${context.channel}):\n${context.instructions}`).join('\n\n');
}
const initialContext = await liveContext();
const server = new McpServer({ name: 'mcp-router', version: '0.7.4' }, {
  instructions: `MCP Router connects you to the user's approved Webflow websites and projects.
Use this connection for Webflow tasks involving site information, pages, CMS collections and items, SEO, localization, assets, forms, analytics, or Designer elements, styles, components and variables, including editing and publishing when permitted.
If a user names a website or project without saying Webflow, use list_projects to check whether it is available here. Do not assume a match or invent project IDs.
Workflow: call list_projects to find the approved project; call prepare_project to read all enabled project rules and relevant skills before working on it; call get_project_operations to discover allowed actions, then pass an operationId to retrieve its exact parameter schema; execute with read_webflow or write_webflow. read_project_site is a shortcut for site metadata after preparation.
Prefer these tools for supported Webflow operations. Use a browser for visual checks or capabilities unavailable through this connection, subject to the user's instructions. If project instructions cannot be read, explain the limitation and keep investigation read-only.
Only enabled projects and permitted operations are available. An absent project or action is not proof that the website or capability does not exist; report the access limitation without bypassing it or switching grants. Writes require the preparationId returned by prepare_project, valid for ten minutes. Permission to call a tool does not replace the user's authorization to delete or publish. Do not automatically retry ambiguous write failures; inspect the site first.
Webflow's own instructions follow, scoped to each project and its selected grant. Upstream tool names describe Webflow capabilities; use get_project_operations and the router execution tools to access them. get_project_guidance and the project guidance resource fetch current Webflow instructions, guide and tool descriptions; prepare_project also loads current site rules and skills. Upstream guidance does not expand router permissions.
${upstreamInstructions(initialContext)}`
});
const definitions = [];
function registerTool(name, config, callback) {
  definitions.push({name,...config,inputSchema:toJsonSchemaCompat(z.object(config.inputSchema))});
  server.registerTool(name,config,callback);
}
const handler = name => async args => {
  try { return { content: [{ type: 'text', text: JSON.stringify(await call(name, args)) }] }; }
  catch { return { isError: true, content: [{ type: 'text', text: 'Access denied or router unavailable. Open the local router dashboard to check project access and OAuth status.' }] }; }
};
registerTool('list_projects', {
  description: 'Start here for Webflow website tasks, or to check whether a named website/project is available through MCP Router. List enabled, approved Webflow projects and their permission keys; use the returned project ID with the other tools. Does not list disabled or other authorized sites. Next call prepare_project to load project rules.',
  inputSchema: {}, annotations: { readOnlyHint: true, destructiveHint: false }
}, handler('list_projects'));
registerTool('read_project_site', {
  description: 'Read live site metadata for one approved project ID. The router selects the Webflow connection and site. Other operations use get_project_operations and read_webflow/write_webflow.',
  inputSchema: { projectId: z.string() }, annotations: { readOnlyHint: true, destructiveHint: false }
}, handler('read_project_site'));
registerTool('get_project_operations', {
  description: 'Discover available Webflow capabilities for an approved project: pages, CMS collections/items, SEO, localization, assets, forms, analytics, Designer elements/styles/components/variables, custom code and publishing, subject to permissions. Pass operationId to obtain its exact parameter JSON schema before execution. Use projectId from list_projects. Unlisted actions are denied.',
  inputSchema: {projectId:z.string(),operationId:z.string().optional()}, annotations:{readOnlyHint:true,destructiveHint:false}
},handler('get_project_operations'));
registerTool('get_project_guidance', {
  description: 'Read the current Webflow server instructions, Webflow guide and original tool descriptions from the selected project connection. Fetched live from Stable or Beta; requires Instructions → Read. Use prepare_project to also load site rules and skills before working.',
  inputSchema:{projectId:z.string()},annotations:{readOnlyHint:true,destructiveHint:false}
},handler('get_project_guidance'));
registerTool('prepare_project', {
  description: 'Load Webflow project rules before working on a project, including read-only investigation. Use projectId from list_projects. Read Webflow guidance and all enabled project instructions; follow the returned rules and relevant skills. Returns a preparationId required for writes, valid for 10 minutes and invalidated by permission changes. If unavailable, explain the limitation and keep investigation read-only.',
  inputSchema:{projectId:z.string()},annotations:{readOnlyHint:true,destructiveHint:false}
},handler('prepare_project'));
for(const mode of ['read','write']) registerTool(mode+'_webflow',{
  description: mode==='read'?'Read Webflow website data such as pages, CMS content, SEO settings, assets and Designer structure using a permitted action from get_project_operations. Load project rules with prepare_project and retrieve the exact operation schema first. The router fixes the project and verifies resource ownership.':'Create or edit Webflow pages, CMS content, Designer elements, styles and other website settings, or delete/publish when authorized, using a permitted action from get_project_operations. Discover its exact schema first. Read prepare_project instructions, then provide preparationId. Do not retry ambiguous write failures automatically; inspect the site first.',
  inputSchema:{projectId:z.string(),operationId:z.string(),params:z.record(z.unknown()),pageId:z.string().optional(),...(mode==='write'?{preparationId:z.string()}: {})},
  annotations:{readOnlyHint:mode==='read',destructiveHint:mode==='write',idempotentHint:false}
},handler(mode+'_webflow'));
server.server.setRequestHandler(ListToolsRequestSchema, async () => {
  const contexts = await liveContext();
  const descriptions = contexts.flatMap(context=>context.tools.map(tool=>
    `Project ${context.projectId} (${context.channel}), ${tool.name}${tool.title ? ` — ${tool.title}` : ''}:\n${tool.description || ''}\nPermitted operation IDs: ${tool.operationIds.join(', ')}`));
  return {tools:definitions.map(definition=>definition.name==='get_project_operations' ? {
    ...definition,
    description:definition.description + (descriptions.length ? '\n\nCurrent Webflow tool descriptions (use only permitted router operations):\n' + descriptions.join('\n\n') : '')
  } : definition)};
});
server.registerResource('webflow-project-guidance', new ResourceTemplate('webflow-router://projects/{projectId}/guidance', {
  list:async()=>({resources:(await call('list_projects',{})).filter(project=>project.capabilities.includes('agent_instructions:read')).map(project=>({
    uri:`webflow-router://projects/${encodeURIComponent(project.id)}/guidance`,name:`Webflow guide — ${project.name}`,mimeType:'application/json'
  }))})
}), {description:'Live Webflow server instructions, guide, permitted tool descriptions, and enabled site rules and skills for an approved project.',mimeType:'application/json'}, async (uri,{projectId})=>{
  try { return {contents:[{uri:uri.href,mimeType:'application/json',text:JSON.stringify(await call('prepare_project',{projectId}))}]}; }
  catch { throw new Error('Project guidance unavailable. Check project permissions and the selected Webflow authorization.'); }
});
await server.connect(new StdioServerTransport());
