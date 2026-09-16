import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import http from 'node:http';
import {once} from 'node:events';
import paths from '../src/paths.cjs';
import integrations from '../src/integrations.cjs';
import {createIPC} from '../src/server.js';
import {Store} from '../src/store.js';
import {execFileSync} from 'node:child_process';

test('Windows pipe names are stable, user-specific, and independent of path case',()=>{
 const a=paths.ipcEndpoint('C:\\Users\\Alice\\router.sock','win32');
 assert.ok(a.startsWith('\\\\.\\pipe\\mcp-router-'));
 assert.equal(a,paths.ipcEndpoint('c:\\users\\alice\\router.sock','win32'));
 assert.notEqual(a,paths.ipcEndpoint('C:\\Users\\Bob\\router.sock','win32'));
 assert.equal(paths.ipcEndpoint('/tmp/router.sock','darwin'),'/tmp/router.sock');
});

test('IPC rejects missing or incorrect credentials before executing operations',async t=>{
 let calls=0;
 const server=createIPC({call:async()=>{calls++;return 'ok';}},'private-token');
 server.listen(0,'127.0.0.1');await once(server,'listening');
 t.after(()=>new Promise(resolve=>{server.closeAllConnections();server.close(resolve);}));
 const request=authorization=>new Promise((resolve,reject)=>{
  const req=http.request({hostname:'127.0.0.1',port:server.address().port,path:'/call',method:'POST',headers:authorization?{authorization}:{}},res=>{res.resume();res.on('end',()=>resolve(res.statusCode));});req.on('error',reject);req.end('{"name":"list_projects","arguments":{}}');
 });
 assert.equal(await request(),403);assert.equal(await request('Bearer wrong'),403);assert.equal(calls,0);
 assert.equal(await request('Bearer private-token'),200);assert.equal(calls,1);
});

test('Windows discovery handles desktop executables and npm CLI registrations without a shell',async t=>{
 const home=fs.mkdtempSync(path.join(os.tmpdir(),'router-windows-'));t.after(()=>fs.rmSync(home,{recursive:true,force:true}));
 const appData=path.join(home,'Roaming'),localAppData=path.join(home,'Local'),bin=path.join(appData,'npm');
 for(const file of [path.join(localAppData,'AnthropicClaude/claude.exe'),path.join(localAppData,'Programs/cursor/Cursor.exe'),path.join(localAppData,'Programs/Microsoft VS Code/Code.exe'),path.join(bin,'codex.cmd'),path.join(bin,'node_modules/@openai/codex/bin/codex.js'),path.join(bin,'claude.cmd'),path.join(bin,'gemini.cmd')]){fs.mkdirSync(path.dirname(file),{recursive:true});fs.writeFileSync(file,'');}
 const executable=path.join(home,'MCP Router.exe'),script=path.join(home,'stdio.js'),socket=path.join(home,'router.sock');
 const expected={command:executable,args:[script],env:{ELECTRON_RUN_AS_NODE:'1',ROUTER_SOCKET:socket}};
 const calls=[];let connected=false;
 const client=integrations.createIntegrations({home,appData,localAppData,getWindowsPackageRoots:async()=>{throw new Error("Package service unavailable");},programFiles:path.join(home,'Program Files'),platform:'win32',binaryDirs:[bin],executable,script,socket,run:async(command,args,options)=>{calls.push({command,args,options});if(args.includes('add')){connected=true;return {stdout:''};}if(!connected)throw Object.assign(new Error(),{stderr:'not found'});return {stdout:JSON.stringify({transport:expected})};}});
 assert.deepEqual((await client.status()).map(x=>x.installed),Array(6).fill(true));
 for(const id of ['codex','claude-desktop','claude-code','cursor','vscode','gemini'])assert.equal((await client.connect(id)).ok,true,id);
 assert.deepEqual((await client.status()).map(x=>x.state),Array(6).fill('configured'));
 assert.ok(calls.every(c=>c.command===executable && c.args[0].endsWith('codex.js') && !c.options.shell));
 const config=integrations.readConfig(path.join(appData,'Claude/claude_desktop_config.json')).data;
 assert.deepEqual(config.mcpServers[integrations.NAME],expected);
});

test('Windows vault directory has a protected ACL restricted to the current user',{skip:process.platform!=='win32'},t=>{
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'router-acl-'));t.after(()=>fs.rmSync(dir,{recursive:true,force:true}));
 const store=new Store(dir);store.save();
 const output=execFileSync('powershell.exe',['-NoProfile','-NonInteractive','-Command',"Import-Module (Join-Path $PSHOME 'Modules/Microsoft.PowerShell.Security/Microsoft.PowerShell.Security.psd1') -ErrorAction Stop; $acl=Get-Acl -LiteralPath $env:ROUTER_TEST_DIRECTORY; $sid=[System.Security.Principal.WindowsIdentity]::GetCurrent().User.Value; if (!$acl.AreAccessRulesProtected) {throw 'ACL inherits'}; foreach ($rule in $acl.Access) {if ($rule.IdentityReference.Translate([System.Security.Principal.SecurityIdentifier]).Value -ne $sid) {throw 'Unexpected principal'}}; 'ok'"],{env:{...process.env,ROUTER_TEST_DIRECTORY:dir},encoding:'utf8'});
 assert.equal(output.trim(),'ok');assert.deepEqual(new Store(dir).data,store.data);
});


test('Windows Store ChatGPT registers through TOML without launching the protected executable',async t=>{
 const home=fs.mkdtempSync(path.join(os.tmpdir(),'router-store-'));t.after(()=>fs.rmSync(home,{recursive:true,force:true}));
 const root=path.join(home,'WindowsApps/OpenAI.Codex_1.0_arm64__publisher');
 const command=path.join(root,'app/resources/codex.exe');fs.mkdirSync(path.dirname(command),{recursive:true});fs.writeFileSync(command,'');
 let queries=0;const calls=[];
 const executable=path.join(home,'MCP Router.exe'),script=path.join(home,'stdio.js'),socket=path.join(home,'router.sock');
 const expected={command:executable,args:[script],env:{ELECTRON_RUN_AS_NODE:'1',ROUTER_SOCKET:socket}};
 const client=integrations.createIntegrations({home,appData:home,localAppData:home,programFiles:home,codexHome:path.join(home,'.codex'),platform:'win32',binaryDirs:[],executable,script,socket,run:async(cmd,args,options)=>{
  if(cmd.endsWith('powershell.exe')){queries++;assert.ok(!args.join(' ').includes('-AllUsers'));return {stdout:JSON.stringify([path.join(home,'removed-package'),root])};}
  calls.push({cmd,args,options});throw new Error('Store executable must not be launched');
 }});
 assert.equal((await client.status())[0].state,'not-connected');
 assert.equal((await client.connect('codex')).ok,true);
 assert.equal((await client.status())[0].state,'configured');
 assert.equal(queries,1);assert.equal(calls.length,0);
 const file=path.join(home,'.codex/config.toml'),toml=await import('@decimalturn/toml-patch');
 assert.deepEqual(JSON.parse(JSON.stringify(toml.parse(fs.readFileSync(file,'utf8')).mcp_servers.mcp_router_for_webflow)),expected);
 const custom='# Preserve this comment\nmodel = "example"\n[mcp_servers.other]\ncommand = "other" # keep me\n[mcp_servers."mcp_router_for_webflow"]\ncommand = "old"\nenabled = false\ndisabled_tools = ["write_project"]\n[mcp_servers."mcp_router_for_webflow".env]\nCUSTOM = "keep"\n';
 fs.writeFileSync(file,custom);
 assert.equal((await client.status())[0].state,'needs-reconnect');
 await client.connect('codex');
 const updated=fs.readFileSync(file,'utf8'),data=toml.parse(updated);
 assert.ok(updated.includes('# Preserve this comment'));assert.ok(updated.includes('# keep me'));
 assert.equal(data.model,'example');assert.equal(data.mcp_servers.other.command,'other');
 assert.equal(data.mcp_servers.mcp_router_for_webflow.enabled,false);
 assert.deepEqual(data.mcp_servers.mcp_router_for_webflow.disabled_tools,['write_project']);
 assert.equal(data.mcp_servers.mcp_router_for_webflow.env.CUSTOM,'keep');
 assert.equal(data.mcp_servers.mcp_router_for_webflow.command,expected.command);
 assert.ok(fs.readdirSync(path.dirname(file)).some(n=>n.includes('mcp-router-backup-')));
 fs.writeFileSync(file,'[broken');assert.equal((await client.connect('codex')).ok,false);
 assert.equal(fs.readFileSync(file,'utf8'),'[broken');
});
