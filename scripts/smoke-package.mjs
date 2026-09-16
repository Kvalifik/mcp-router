// Exercise the shipped Electron/Node runtime and packaged dependencies on the native CI host.
import {spawn} from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {fileURLToPath, pathToFileURL} from 'node:url';
const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
const platform=process.env.BUILD_PLATFORM || process.platform;
const arch=process.env.BUILD_ARCH || process.arch;
const output=path.join(root,`dist/MCP Router-${platform}-${arch}`);
const resources=path.join(output,platform==='darwin'?'MCP Router.app/Contents/Resources':'resources');
const executable=path.join(output,platform==='darwin'?'MCP Router.app/Contents/MacOS/MCP Router':'MCP Router.exe');
const timeoutMs=Number(process.env.SMOKE_TIMEOUT_MS || 30000);
if (!Number.isSafeInteger(timeoutMs) || timeoutMs < 1000 || timeoutMs > 300000) throw new Error('SMOKE_TIMEOUT_MS must be between 1000 and 300000');
const dir=fs.mkdtempSync(path.join(os.tmpdir(),'router-smoke-'));
const code=`
 const {main}=await import(${JSON.stringify(pathToFileURL(path.join(resources,'app/src/server.js')).href)});
 const {ipcEndpoint}=require(${JSON.stringify(path.join(resources,'app/src/paths.cjs'))});
 const {ipc,dashboard}=await main();
 const headers={'Content-Type':'application/json'};
 if(process.platform==='win32')headers.Authorization='Bearer '+require('node:fs').readFileSync(require('node:path').join(process.env.ROUTER_DATA_DIR,'ipc-token'),'utf8');
 const req=require('node:http').request({socketPath:ipcEndpoint(require('node:path').join(process.env.ROUTER_DATA_DIR,'router.sock')),path:'/call',method:'POST',headers},res=>{
  let body='';res.on('data',chunk=>body+=chunk);res.on('end',()=>{
   if(res.statusCode!==200 || !Array.isArray(JSON.parse(body).result))process.exit(1);
   dashboard.close();ipc.close();console.log('Packaged router smoke test passed');
  });
 });
 req.on('error',()=>process.exit(1));req.end(JSON.stringify({name:'list_projects',arguments:{}}));
`;
try {
 await new Promise((resolve,reject)=>{
  const child=spawn(executable,['-e',`(async()=>{${code}})().catch(e=>{console.error(e);process.exit(1)})`],{env:{...process.env,ELECTRON_RUN_AS_NODE:'1',ROUTER_DATA_DIR:dir,ROUTER_PORT:'43139'},stdio:'inherit',windowsHide:true});
  const timer=setTimeout(()=>{child.kill();reject(new Error('Packaged router smoke test timed out'));},timeoutMs);
  child.on('error',error=>{clearTimeout(timer);reject(error);});
  child.on('exit',code=>{clearTimeout(timer);code===0?resolve():reject(new Error(`Packaged runtime exited ${code}`));});
 });
} finally { fs.rmSync(dir,{recursive:true,force:true}); }
