// Manual macOS integration check. Uses a separate bundle ID and temporary data;
// never starts, replaces, or reads an installed MCP Router app.
import { packager } from '@electron/packager';
import { sign } from '@electron/osx-sign';
import fs from 'node:fs/promises';
import { createReadStream } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import http from 'node:http';
import { execFileSync, spawn } from 'node:child_process';
import { createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';
const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
if(process.platform!=='darwin'||!process.env.MAC_SIGNING_IDENTITY?.startsWith('Developer ID Application: '))throw Error('Run on macOS with MAC_SIGNING_IDENTITY');
const temp=await fs.mkdtemp(path.join(os.tmpdir(),'router-update-test-'));
const result=path.join(temp,'result.json'),events=path.join(temp,'events.txt');
const feeds={};
const server=http.createServer((req,res)=>{
 const name=req.url?.slice(1);
 if(feeds[name]){res.setHeader('Content-Type','application/json');res.end(JSON.stringify(feeds[name]));}
 else if(['good.zip','bad.zip'].includes(name)){res.setHeader('Content-Type','application/zip');createReadStream(path.join(temp,name)).pipe(res);}
 else {res.writeHead(404);res.end();}
});
await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
const origin=`http://127.0.0.1:${server.address().port}`;
let child;
try {
 const source=path.join(temp,'source');await fs.mkdir(source);
 await fs.copyFile(path.join(root,'src/mac-updates.cjs'),path.join(source,'mac-updates.cjs'));
 const main=`
 const {app,autoUpdater,BrowserWindow}=require('electron');
 const fs=require('node:fs');
 app.setPath('userData',${JSON.stringify(path.join(temp,'profile'))});
 const log=s=>fs.appendFileSync(${JSON.stringify(events)},s+'\\n');
 app.whenReady().then(async()=>{
  if(app.getVersion()==='1.1.0'){
   fs.writeFileSync(${JSON.stringify(result)},JSON.stringify({version:app.getVersion(),rejected:fs.readFileSync(${JSON.stringify(events)},'utf8').includes('rejected')}));
   app.quit();return;
  }
  const win=new BrowserWindow({show:false,webPreferences:{sandbox:true,contextIsolation:true}});
  win.on('close',event=>{if(!app.isQuitting)event.preventDefault();});
  autoUpdater.on('before-quit-for-update',()=>{app.isQuitting=true;});
  app.on('before-quit',()=>{app.isQuitting=true;});
  let bad=true;
  const updater=require('./mac-updates.cjs').createMacUpdater({autoUpdater,arch:process.arch,
   checker:{check:async()=>({state:'available',version:'1.1.0'}),macFeed:()=>${JSON.stringify(origin)}+(bad?'/bad.json':'/good.json')},
   onChange:state=>{
    log(state.state);
    if(state.state==='error'){
     if(!bad){fs.writeFileSync(${JSON.stringify(result)},JSON.stringify({error:'Valid update failed'}));app.quit();return;}
     log('rejected');bad=false;setTimeout(()=>updater.check(),500);
    }
    if(state.state==='ready')updater.install();
   }});
  updater.check();
 }).catch(()=>{fs.writeFileSync(${JSON.stringify(result)},JSON.stringify({error:'Fixture startup failed'}));app.quit();});
 `;
 await fs.writeFile(path.join(source,'main.cjs'),main);
 const apps=[];
 for(const version of ['1.0.0','1.1.0']){
  await fs.writeFile(path.join(source,'package.json'),JSON.stringify({name:'router-update-test',version,main:'main.cjs'}));
  const [output]=await packager({dir:source,name:'Router Update Test',appBundleId:'dk.kvalifik.mcp-router.update-test',
   asar:false,appVersion:version,platform:'darwin',arch:process.arch,out:path.join(temp,version),overwrite:true,
   electronVersion:JSON.parse(await fs.readFile(path.join(root,'package.json'))).devDependencies.electron,
   extendInfo:{NSAppTransportSecurity:{NSAllowsArbitraryLoads:true}}}); // Local fixture server only.
  const app=path.join(output,'Router Update Test.app');
  await sign({app,identity:process.env.MAC_SIGNING_IDENTITY,platform:'darwin',preEmbedProvisioningProfile:false});
  apps.push(app);
 }
 const archive=name=>execFileSync('ditto',['-c','-k','--norsrc','--keepParent',apps[1],path.join(temp,name)]);
 archive('good.zip');
 // Alter a sealed resource so integrity passes but code-signature validation fails.
 await fs.appendFile(path.join(apps[1],'Contents/Resources/app/main.cjs'),'\n// altered after signing\n');
 archive('bad.zip');
 for(const kind of ['good','bad']){
  const bytes=await fs.readFile(path.join(temp,`${kind}.zip`));
  feeds[`${kind}.json`]={currentRelease:'1.1.0',releases:[{version:'1.1.0',updateTo:{version:'1.1.0',name:'1.1.0',url:`${origin}/${kind}.zip`,sha256:createHash('sha256').update(bytes).digest('hex'),size:bytes.length}}]};
 }
 console.log('Testing signature rejection, download, install, and relaunch in isolated fixture…');
 child=spawn(path.join(apps[0],'Contents/MacOS/Router Update Test'),[],{stdio:'ignore'});
 const deadline=Date.now()+180000;
 let outcome;
 while(Date.now()<deadline){
  try {outcome=JSON.parse(await fs.readFile(result,'utf8'));break;}catch {}
  await new Promise(resolve=>setTimeout(resolve,1000));
 }
 if(!outcome||outcome.error||outcome.version!=='1.1.0'||!outcome.rejected){
  console.log(await fs.readFile(events,'utf8').catch(()=>''));
  throw Error(outcome?.error||'Update installation did not complete');
 }
 console.log('Passed: tampered update rejected; signed update installed and relaunched as 1.1.0.');
} finally {
 child?.kill();server.close();
 await fs.rm(temp,{recursive:true,force:true});
}
