// Packaged code-mode/MCP smoke test using an isolated synthetic store.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {spawn} from 'node:child_process';
import {fileURLToPath,pathToFileURL} from 'node:url';
const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
const output=path.join(root,`dist/MCP Router-${process.platform}-${process.arch}`);
const app=path.join(output,process.platform==='darwin'?'MCP Router.app/Contents/Resources/app':'resources/app');
const exe=path.join(output,process.platform==='darwin'?'MCP Router.app/Contents/MacOS/MCP Router':'MCP Router.exe');
const dir=fs.mkdtempSync(path.join(os.tmpdir(),'router-code-package-'));
const url=relative=>pathToFileURL(path.join(app,relative)).href;
try {
  const fixture=fs.readFileSync(path.join(root,'test/fixtures/code-mode.js'),'utf8')
    .replaceAll('../../src/store.js',url('src/store.js')).replaceAll('../../src/router.js',url('src/router.js'));
  fs.writeFileSync(path.join(dir,'fixture.mjs'),fixture);
  fs.writeFileSync(path.join(dir,'smoke.mjs'),`
import assert from 'node:assert/strict';
import {once} from 'node:events';
import fs from 'node:fs';
import path from 'node:path';
import {fixture,snippet} from './fixture.mjs';
import {Client} from ${JSON.stringify(url('node_modules/@modelcontextprotocol/sdk/dist/esm/client/index.js'))};
import {StdioClientTransport} from ${JSON.stringify(url('node_modules/@modelcontextprotocol/sdk/dist/esm/client/stdio.js'))};
import {createIPC} from ${JSON.stringify(url('src/server.js'))};
import paths from ${JSON.stringify(url('src/paths.cjs'))};
const f=fixture({count:220});
const socket=${JSON.stringify(path.join(dir,'ipc.sock'))};
const token=process.platform==='win32'?'synthetic-ipc-token':null;
if(token)fs.writeFileSync(path.join(path.dirname(socket),'ipc-token'),token);
const ipc=createIPC(f.router,token);
ipc.listen(paths.ipcEndpoint(socket));await once(ipc,'listening');
const client=new Client({name:'synthetic-package-check',version:'1.0.0'});
try {
 await client.connect(new StdioClientTransport({command:process.execPath,args:[${JSON.stringify(path.join(app,'src/stdio.js'))}],env:{...process.env,ROUTER_SOCKET:socket,ELECTRON_RUN_AS_NODE:'1'}}));
 const tools=await client.listTools();assert(tools.tools.some(t=>t.name==='read_webflow_code'));
 const call=code=>client.callTool({name:'read_webflow_code',arguments:{projectId:'p',code}});
 const result=await call(snippet);assert(!result.isError);
 assert.equal(JSON.parse(JSON.parse(result.content[0].text).output).length,22);
 assert((await call("read('data_cms_tool.update_collection_items',{});")).isError);
 f.router.setReadCodeEnabled(false);
 assert((await call('print(1)')).isError);
 f.router.setReadCodeEnabled(true);
 f.router.edit('projects','p',{permissions:{'cms:read':false}});
 assert((await call(snippet)).isError);
 console.log(JSON.stringify({packagedCodeMode:'passed',mcpDiscovery:true,pagination:true,writeDenied:true,permissionRevocation:true,node:process.version,platform:process.platform,arch:process.arch}));
} finally {await client.close();await new Promise(r=>ipc.close(r));f.cleanup();}
`);
  await new Promise((resolve,reject)=>{
    const child=spawn(exe,[path.join(dir,'smoke.mjs')],{env:{...process.env,ELECTRON_RUN_AS_NODE:'1'},stdio:'inherit'});
    const timer=setTimeout(()=>{child.kill();reject(new Error('Packaged code smoke timed out'));},45000);
    child.on('error',e=>{clearTimeout(timer);reject(e);});
    child.on('exit',code=>{clearTimeout(timer);code===0?resolve():reject(new Error(`Packaged smoke exit ${code}`));});
  });
}finally{fs.rmSync(dir,{recursive:true,force:true});}
