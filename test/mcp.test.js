import test from 'node:test';
import paths from '../src/paths.cjs';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { once } from 'node:events';
import { fileURLToPath } from 'node:url';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import { Store } from '../src/store.js';
import { Router } from '../src/router.js';
import { OAuthManager } from '../src/oauth.js';
import { createIPC } from '../src/server.js';

test('real MCP stdio client enforces live policy through the daemon', async t => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'wfr-ipc-')), socket = path.join(dir, 'ipc.sock');
  const store = new Store(dir), oauth = new OAuthManager(store, 'http://127.0.0.1:43127');
  let revision = 1;
  const router = new Router(store, oauth, { open: async p => ({
    instructions:`Webflow server guidance revision ${revision}`,
    guide:{content:[{type:'text',text:`Webflow guide revision ${revision}`}]},
    listTools:async()=>[
      {name:'data_sites_tool',title:'Webflow sites',description:`Site guidance revision ${revision}`},
      {name:'data_cms_tool',description:'CMS access is not granted'},
      {name:'new_unreviewed_tool',description:'Unreviewed capability'}
    ],
    call:async(tool,args)=>{
      const action=args.actions[0].read_instruction?'read_instruction':'search_instructions';
      if(action==='read_instruction')assert.equal(args.actions[0].read_instruction.path,'rules/site.md');
      return {content:[{type:'text',text:JSON.stringify({action,result:action==='read_instruction' ? {markdown:`Site rule revision ${revision}`} : {
        instructions:[{path:'rules/site.md',enabled:true},{path:'rules/disabled.md',enabled:false},{path:'rules/draft.md',isDraft:true}],pagination:{total:3}
      }})}]};
    },
    listSites: async () => [{ id: p.id, name: p.c.name }], close: async () => {}
  }) });
  const id = router.createConnection('Workspace A');
  store.connection(id).tokens = { access_token: 'test-only', token_type: 'Bearer' };
  store.connection(id).sites = [{ id, name: 'A' }];
  router.saveProject({ id: 'a', name: 'Project A', connectionId: id, siteId: id, enabled: true });
  router.edit('projects','a',{permissions:{'site:read':true,'agent_instructions:read':true}});
  const token = process.platform === 'win32' ? 'test-ipc-token' : null;
  if(token) fs.writeFileSync(path.join(dir,'ipc-token'),token);
  const ipc = createIPC(router,token); ipc.listen(paths.ipcEndpoint(socket)); await once(ipc, 'listening');
  const client = new Client({ name: 'test-codex', version: '1.0.0' });
  t.after(async () => { await client.close(); await new Promise(resolve => ipc.close(resolve)); fs.rmSync(dir, { recursive: true, force: true }); });
  await client.connect(new StdioClientTransport({ command: process.execPath, args: [fileURLToPath(new URL('../src/stdio.js', import.meta.url))], env: { ...process.env, ROUTER_SOCKET: socket } }));
  const instructions = client.getInstructions();
  assert.match(instructions, /Webflow websites and projects/);
  assert.match(instructions, /list_projects.*prepare_project.*get_project_operations/s);
  assert.match(instructions, /without bypassing it or switching grants/);
  assert.match(instructions, /Webflow server guidance revision 1/);
  const { tools } = await client.listTools();
  assert.deepEqual(tools.map(t => t.name).sort(), ['get_project_guidance', 'get_project_operations', 'list_projects', 'prepare_project', 'read_project_site', 'read_webflow', 'write_webflow']);
  assert.match(tools.find(t => t.name === 'list_projects').description, /Start here for Webflow/);
  assert.match(tools.find(t => t.name === 'get_project_operations').description, /CMS.*SEO.*Designer/);
  assert.match(tools.find(t => t.name === 'prepare_project').description, /including read-only/);
  const discovery = tools.find(t=>t.name==='get_project_operations').description;
  assert.match(discovery,/Site guidance revision 1/);
  assert.doesNotMatch(discovery,/CMS access is not granted|Unreviewed capability/);
  revision = 2;
  const updated = (await client.listTools()).tools.find(t=>t.name==='get_project_operations').description;
  assert.match(updated,/Site guidance revision 2/);
  assert.doesNotMatch(updated,/Site guidance revision 1/);
  const resource = (await client.listResources()).resources[0];
  assert.equal(resource.uri,'webflow-router://projects/a/guidance');
  const guidance = JSON.parse((await client.readResource({uri:resource.uri})).contents[0].text);
  assert.equal(guidance.upstream.instructions,'Webflow server guidance revision 2');
  assert.equal(guidance.guide.content[0].text,'Webflow guide revision 2');
  assert.equal(guidance.instructions.length,1);
  assert.match(JSON.stringify(guidance.instructions[0]),/Site rule revision 2/);
  assert.ok(guidance.preparationId);
  assert.equal((await client.listResourceTemplates()).resourceTemplates.length,1);
  const projects = await client.callTool({ name: 'list_projects', arguments: {} });
  assert.equal(JSON.parse(projects.content[0].text)[0].id, 'a');
  const read = await client.callTool({ name: 'read_project_site', arguments: { projectId: 'a' } });
  assert.equal(JSON.parse(read.content[0].text).id, id);
  router.setConnection(id, false);
  assert.equal((await client.listResources()).resources.length,0);
  assert.doesNotMatch((await client.listTools()).tools.find(t=>t.name==='get_project_operations').description,/Site guidance revision/);
  await assert.rejects(client.readResource({uri:resource.uri}));
  assert.equal((await client.callTool({name:'get_project_guidance',arguments:{projectId:'a'}})).isError,true);
  assert.equal((await client.callTool({ name: 'read_project_site', arguments: { projectId: 'a' } })).isError, true);
  assert.equal((await client.callTool({ name: 'publish_site', arguments: { projectId: 'a' } })).isError, true);
});
