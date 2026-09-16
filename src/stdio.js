import http from 'node:http';
import paths from './paths.cjs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { z } from 'zod';

const socketPath = paths.currentSocket(process.env.ROUTER_SOCKET || path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../.local/router.sock'));
function call(name, args) {
  return new Promise((resolve, reject) => {
    const req = http.request({ socketPath, path: '/call', method: 'POST', headers: { 'Content-Type': 'application/json' } }, res => {
      let text = ''; res.on('data', chunk => { text += chunk; });
      res.on('end', () => { try { const data = JSON.parse(text); if (data.error) reject(new Error(data.error)); else resolve(data.result); } catch (e) { reject(e); } });
    });
    req.setTimeout(120000, () => req.destroy(new Error('Router timed out')));
    req.on('error', reject); req.end(JSON.stringify({ name, arguments: args }));
  });
}
const server = new McpServer({ name: 'mcp-router', version: '0.7.4' });
const handler = name => async args => {
  try { return { content: [{ type: 'text', text: JSON.stringify(await call(name, args)) }] }; }
  catch { return { isError: true, content: [{ type: 'text', text: 'Access denied or router unavailable. Open the local router dashboard to check project access and OAuth status.' }] }; }
};
server.registerTool('list_projects', {
  description: 'List enabled Webflow projects approved for this local router. Does not list other authorized sites.',
  inputSchema: {}, annotations: { readOnlyHint: true, destructiveHint: false }
}, handler('list_projects'));
server.registerTool('read_project_site', {
  description: 'Read live site metadata for one approved project ID. The router selects the Webflow connection and site. Other operations use get_project_operations and read_webflow/write_webflow.',
  inputSchema: { projectId: z.string() }, annotations: { readOnlyHint: true, destructiveHint: false }
}, handler('read_project_site'));
server.registerTool('get_project_operations', {
  description: 'Discover permitted Webflow actions for a project. Pass operationId to obtain its exact parameter JSON schema. Unlisted actions are denied.',
  inputSchema: {projectId:z.string(),operationId:z.string().optional()}, annotations:{readOnlyHint:true,destructiveHint:false}
},handler('get_project_operations'));
server.registerTool('prepare_project', {
  description: 'Read Webflow guidance and all enabled project instructions. Follow the returned rules and relevant skills. Returns a preparationId required for writes, valid for 10 minutes and invalidated by permission changes.',
  inputSchema:{projectId:z.string()},annotations:{readOnlyHint:true,destructiveHint:false}
},handler('prepare_project'));
for(const mode of ['read','write']) server.registerTool(mode+'_webflow',{
  description: mode==='read'?'Execute a permitted read action discovered through get_project_operations. The router fixes the project and verifies resource ownership.':'Execute a permitted write/delete/publish action. Discover its schema first. Read prepare_project instructions, then provide preparationId. Do not retry ambiguous write failures automatically; inspect the site first.',
  inputSchema:{projectId:z.string(),operationId:z.string(),params:z.record(z.unknown()),pageId:z.string().optional(),...(mode==='write'?{preparationId:z.string()}: {})},
  annotations:{readOnlyHint:mode==='read',destructiveHint:mode==='write',idempotentHint:false}
},handler(mode+'_webflow'));
await server.connect(new StdioServerTransport());
