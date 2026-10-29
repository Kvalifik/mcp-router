import test from 'node:test';
import paths from '../src/paths.cjs';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import http from 'node:http';
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
        instructions:[{path:'rules/site.md',enabled:true},{path:'rules/disabled.md',enabled:false},{path:'rules/draft.md',isDraft:true},{path:'example/SKILL.md',kind:'skill',name:'Example',description:'Synthetic skill'}],pagination:{total:4}
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
  assert.match(instructions.slice(0,512), /Managed.*list_direct_connections.*get_direct_tools.*call_direct_tool/s);
  assert.match(instructions, /Missing direct Webflow tools/);
  assert.doesNotMatch(instructions, /Webflow server guidance revision/);
  const { tools } = await client.listTools();
  assert.deepEqual(tools.map(t => t.name).sort(), ['call_direct_tool', 'get_direct_tools', 'get_project_guidance', 'get_project_operations', 'list_direct_connections', 'list_projects', 'prepare_project', 'read_project_site', 'read_webflow', 'read_webflow_code', 'request_reauthorization', 'write_webflow']);
  assert.match(tools.find(t => t.name === 'list_projects').description, /Start here for Webflow/);
  assert.match(tools.find(t => t.name === 'get_project_operations').description, /CMS.*SEO.*Designer/);
  assert.match(tools.find(t => t.name === 'prepare_project').description, /including read-only/);
  const guidanceForProject = async () => JSON.parse((await client.callTool({name:'get_project_guidance',arguments:{projectId:'a'}})).content[0].text);
  const firstGuidance = await guidanceForProject();
  assert.match(JSON.stringify(firstGuidance), /Site guidance revision 1/);
  assert.doesNotMatch(JSON.stringify(firstGuidance), /CMS access is not granted|Unreviewed capability/);
  revision = 2;
  const updated = await guidanceForProject();
  assert.equal(updated.instructions, 'Webflow server guidance revision 2');
  assert.match(JSON.stringify(updated), /Site guidance revision 2/);
  assert.doesNotMatch(JSON.stringify(updated), /Site guidance revision 1/);
  const resource = (await client.listResources()).resources[0];
  assert.equal(resource.uri,'webflow-router://projects/a/guidance');
  const guidance = JSON.parse((await client.readResource({uri:resource.uri})).contents[0].text);
  assert.equal(guidance.upstream.instructions,'Webflow server guidance revision 2');
  assert.equal(guidance.guide.content[0].text,'Webflow guide revision 2');
  assert.equal(guidance.instructions.length,1);
  assert.deepEqual(guidance.skills,[{path:'example/SKILL.md',name:'Example',description:'Synthetic skill'}]);
  assert.match(JSON.stringify(guidance.instructions[0]),/Site rule revision 2/);
  assert.ok(guidance.preparationId);
  assert.equal((await client.listResourceTemplates()).resourceTemplates.length,1);
  const projects = await client.callTool({ name: 'list_projects', arguments: {} });
  assert.equal(JSON.parse(projects.content[0].text)[0].id, 'a');
  router.saveProject({id:'draft', name:'Example draft', connectionId:id, siteId:id});
  const search = async () => JSON.parse((await client.callTool({name:'list_projects', arguments:{query:'example'}})).content[0].text);
  assert.deepEqual(await search(), [{name:'Example draft', status:'disabled', nextStep:'Ask the user to enable this project in MCP Router before accessing it.'}]);
  router.setDisabledProjectDiscovery(false);
  assert.deepEqual(await search(), []);
  router.setDisabledProjectDiscovery(true);
  assert.equal((await client.callTool({name:'read_project_site', arguments:{projectId:'draft'}})).isError, true);
  const read = await client.callTool({ name: 'read_project_site', arguments: { projectId: 'a' } });
  assert.equal(JSON.parse(read.content[0].text).id, id);
  const denied = await client.callTool({name:'read_webflow',arguments:{projectId:'a',operationId:'data_cms_tool.get_collection_list',params:{}}});
  assert.equal(JSON.parse(denied.content[0].text).code,'router_permission_denied');
  delete store.connection(id).tokens;
  const expired = await client.callTool({name:'prepare_project',arguments:{projectId:'a'}});
  assert.equal(JSON.parse(expired.content[0].text).code,'reauthorization_required');
  router.requestAuthorization = (projectId,channel) => ({status:'user_action_required',channel,url:'http://127.0.0.1:43127/oauth/launch/synthetic'});
  const recovery = await client.callTool({name:'request_reauthorization',arguments:{projectId:'a'}});
  assert.equal(JSON.parse(recovery.content[0].text).channel,'stable');
  router.setConnection(id, false);
  assert.equal((await client.listResources()).resources.length,0);
  assert.doesNotMatch((await client.listTools()).tools.find(t=>t.name==='get_project_operations').description,/Site guidance revision/);
  await assert.rejects(client.readResource({uri:resource.uri}));
  assert.equal((await client.callTool({name:'get_project_guidance',arguments:{projectId:'a'}})).isError,true);
  assert.equal((await client.callTool({ name: 'read_project_site', arguments: { projectId: 'a' } })).isError, true);
  assert.equal((await client.callTool({ name: 'publish_site', arguments: { projectId: 'a' } })).isError, true);
  // Direct tools use the same stdio/IPC boundary and preserve MCP content blocks.
  const directArgs={connectionId:id,channel:'stable'};
  assert.equal((await client.callTool({name:'get_direct_tools',arguments:directArgs})).isError,true);
  router.setConnection(id,true);
  store.connection(id).tokens={access_token:'synthetic-direct'};
  router.edit('connections',id,{accessMode:'direct'});
  const direct=JSON.parse((await client.callTool({name:'list_direct_connections',arguments:{}})).content[0].text);
  assert.equal(direct[0].connectionId,id);
  const directTools=JSON.parse((await client.callTool({name:'get_direct_tools',arguments:directArgs})).content[0].text);
  assert.ok(directTools.tools.some(tool=>tool.name==='new_unreviewed_tool'));
  const payload={nested:{values:[1,false,null,'synthetic']}};
  const directResponse={content:[{type:'text',text:'Synthetic response'},{type:'image',data:'c3ludGhldGlj',mimeType:'image/png'}],structuredContent:{ok:true}};
  router.open=async()=>({listTools:async()=>[{name:'new_unreviewed_tool',inputSchema:{type:'object'}}],call:async(name,args)=>{assert.equal(name,'new_unreviewed_tool');assert.deepEqual(args,payload);return directResponse;},close:async()=>{}});
  const forwarded=await client.callTool({name:'call_direct_tool',arguments:{...directArgs,toolName:'new_unreviewed_tool',arguments:payload}});
  assert.deepEqual(forwarded,directResponse);
  const directTool=tools.find(tool=>tool.name==='call_direct_tool');
  assert.equal(directTool.annotations.readOnlyHint,false);
  assert.equal(directTool.annotations.destructiveHint,true);
  assert.equal((await client.listResources()).resources.length,0);
  router.edit('connections',id,{accessMode:'managed'});
  assert.equal((await client.callTool({name:'call_direct_tool',arguments:{...directArgs,toolName:'new_unreviewed_tool',arguments:{}}})).isError,true);

});

// A daemon that accepts requests but never answers simulates stalled upstream
// metadata. Initialization and tools/list must not depend on any daemon request.
for (const daemon of ['stalled', 'absent']) {
  test(`MCP initialization and repeated discovery work with a ${daemon} daemon`, {timeout:10000}, async t => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'wfr-discovery-'));
    const socket = path.join(dir, 'ipc.sock');
    let requests = 0;
    const ipc = http.createServer(() => { requests++; });
    const client = new Client({name:'discovery-test',version:'1.0.0'});
    t.after(async () => {
      await client.close();
      ipc.closeAllConnections();
      if (ipc.listening) await new Promise(resolve => ipc.close(resolve));
      fs.rmSync(dir, {recursive:true,force:true});
    });
    if (process.platform === 'win32') fs.writeFileSync(path.join(dir,'ipc-token'),'synthetic-token');
    if (daemon === 'stalled') {
      ipc.listen(paths.ipcEndpoint(socket));
      await once(ipc, 'listening');
    }
    await client.connect(new StdioClientTransport({command:process.execPath,args:[fileURLToPath(new URL('../src/stdio.js',import.meta.url))],env:{...process.env,ROUTER_SOCKET:socket}}), {timeout:3000});
    const first = await client.listTools({}, {timeout:3000});
    const second = await client.listTools({}, {timeout:3000});
    assert.ok(first.tools.some(tool => tool.name === 'prepare_project'));
    assert.ok(first.tools.some(tool => tool.name === 'list_projects'));
    assert.deepEqual(second,first);
    assert.equal(requests,0);
    if (daemon === 'absent') {
      const result = await client.callTool({name:'list_projects',arguments:{}});
      assert.equal(result.isError,true);
      assert.equal(JSON.parse(result.content[0].text).code,'router_unavailable');
    }
  });
}

// Exercise record validation through the actual SDK schema conversion and stdio
// transport, including nonempty payloads that the old one-argument record broke.
test('MCP operation records preserve JSON values and reject nonobjects before IPC', async t => {
  const dir=fs.mkdtempSync(path.join(os.tmpdir(),'wfr-record-')),socket=path.join(dir,'ipc.sock');
  const received=[];
  const ipc=http.createServer((req,res)=>{
    let body='';req.on('data',chunk=>body+=chunk);req.on('end',()=>{
      const message=JSON.parse(body);received.push(message);
      res.setHeader('Content-Type','application/json');res.end(JSON.stringify({result:message.arguments}));
    });
  });
  if(process.platform==='win32')fs.writeFileSync(path.join(dir,'ipc-token'),'synthetic-token');
  ipc.listen(paths.ipcEndpoint(socket));await once(ipc,'listening');
  const client=new Client({name:'record-validation',version:'1.0.0'});
  t.after(async()=>{await client.close();await new Promise(resolve=>ipc.close(resolve));fs.rmSync(dir,{recursive:true,force:true});});
  await client.connect(new StdioClientTransport({command:process.execPath,args:[fileURLToPath(new URL('../src/stdio.js',import.meta.url))],env:{...process.env,ROUTER_SOCKET:socket}}));
  const {tools}=await client.listTools();
  for(const mode of ['read','write']){
    const name=mode+'_webflow',tool=tools.find(tool=>tool.name===name);
    assert.equal(tool.inputSchema.properties.params.type,'object');
    const base={projectId:'synthetic',operationId:'synthetic.action',...(mode==='write'?{preparationId:'synthetic-preparation'}:{})};
    for(const params of [{},{title:'Demo',count:2,enabled:false,empty:null,nested:{items:[1,'two',null]}}]){
      const result=await client.callTool({name,arguments:{...base,params}});
      assert.notEqual(result.isError,true);
      assert.deepEqual(JSON.parse(result.content[0].text),{...base,params});
      assert.deepEqual(received.at(-1),{name,arguments:{...base,params}});
    }
    for(const params of [null,[], 'invalid',42]){
      const before=received.length;
      assert.equal((await client.callTool({name,arguments:{...base,params}})).isError,true);
      assert.equal(received.length,before);
    }
  }
});
