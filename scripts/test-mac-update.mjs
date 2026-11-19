// Manual macOS integration check. Uses a separate bundle ID and temporary data;
// never starts, replaces, or reads an installed MCP Router app.
import { nativeVersions, restoreCandidateLabel } from '../packaging.mjs';
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
const assets={};
const downloads = {good:0, bad:0};
const server=http.createServer((req,res)=>{
 const name=req.url?.slice(1);
 if(['good.zip','bad.zip'].includes(name)){downloads[name.split('.')[0]]++;res.setHeader('Content-Type','application/zip');createReadStream(path.join(temp,name)).pipe(res);}
 else {res.writeHead(404);res.end();}
});
await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
const origin=`http://127.0.0.1:${server.address().port}`;
let child;
try {
 const source=path.join(temp,'source');await fs.mkdir(source);
 for (const file of ['mac-updates.cjs','update-cache.cjs']) await fs.copyFile(path.join(root,'src',file),path.join(source,file));
 const main=`
 const {app,autoUpdater,BrowserWindow}=require('electron');
 const fs=require('node:fs');
 const path=require('node:path');
 const folder=${JSON.stringify(temp)};
 app.setPath('userData',path.join(folder,'profile'));
 const log=s=>fs.appendFileSync(${JSON.stringify(events)},s+'\\n');
 const logged=s=>fs.existsSync(${JSON.stringify(events)}) && fs.readFileSync(${JSON.stringify(events)},'utf8').includes(s);
 const finish=value=>{fs.writeFileSync(${JSON.stringify(result)},JSON.stringify(value));app.quit();};
 app.whenReady().then(async()=>{
  const version=app.getVersion();
  if(version==='1.1.0'){finish({version,approved:logged('clicked-good')});return;}
  if(version!=='1.1.0-rc.1'){finish({error:'Incorrect prerelease version'});return;}
  const win=new BrowserWindow({show:false,webPreferences:{sandbox:true,contextIsolation:true}});
  win.on('close',event=>{if(!app.isQuitting)event.preventDefault();});
  autoUpdater.on('before-quit-for-update',()=>{app.isQuitting=true;});
  app.on('before-quit',()=>{app.isQuitting=true;});
  const assets=JSON.parse(fs.readFileSync(path.join(folder,'assets.json')));
  let bad=!logged('rejected');
  const updater=require('./mac-updates.cjs').createAppUpdater({autoUpdater,arch:process.arch,
   cache:require('./update-cache.cjs').createUpdateCache(path.join(folder,'cache')),
   isSkipped:()=>false, setSkipped:()=>{},
   checker:{check:async()=>({state:'available',version:'1.1.0'}),macArchive:()=>assets[bad?'bad':'good']},
   onChange:state=>{
    log(state.state);
    if(state.state==='error'){
     if(!bad || !logged('clicked-bad')){finish({error:'Unexpected update failure'});return;}
     log('rejected');bad=false;setTimeout(()=>updater.check(),100);
    }
    if(state.state==='ready'){
     if(!bad && !logged('ordinary-quit')){log('ordinary-quit');app.quit();return;}
     log(bad?'clicked-bad':'clicked-good');updater.install(state.version);
    }
   }});
  await updater.check();
 }).catch(()=>finish({error:'Fixture startup failed'}));
 `;
 await fs.writeFile(path.join(source,'main.cjs'),main);
 const apps=[];
 for(const version of ['1.1.0-rc.1','1.1.0']){
  await fs.writeFile(path.join(source,'package.json'),JSON.stringify({name:'router-update-test',version,main:'main.cjs'}));
  const [output]=await packager({dir:source,name:'Router Update Test',appBundleId:'dk.kvalifik.mcp-router.update-test',
   asar:false,...nativeVersions(version,'darwin'),platform:'darwin',arch:process.arch,out:path.join(temp,version),overwrite:true,
   electronVersion:JSON.parse(await fs.readFile(path.join(root,'package.json'))).devDependencies.electron});
  const app=path.join(output,'Router Update Test.app');
  await restoreCandidateLabel(path.join(app,'Contents/Resources'),version);
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
  assets[kind]={version:'1.1.0',url:`${origin}/${kind}.zip`,sha256:createHash('sha256').update(bytes).digest('hex'),size:bytes.length};
 }
 await fs.writeFile(path.join(temp,'assets.json'),JSON.stringify(assets));
 console.log('Testing signature rejection, download, install, and relaunch in isolated fixture…');
 // Shells launched by Electron-based tooling may inherit Node-only mode.
 // The updater fixture must launch the GUI runtime, including its relaunch.
 const childEnv={...process.env};delete childEnv.ELECTRON_RUN_AS_NODE;
 const launch=()=>spawn(path.join(apps[0],'Contents/MacOS/Router Update Test'),[],{stdio:'ignore',env:childEnv});
 child=launch();
 const exited=await new Promise((resolve,reject)=>{
  const timer=setTimeout(()=>reject(Error('Ordinary quit timed out')),120000);
  child.once('exit',code=>{clearTimeout(timer);resolve(code);});
 });
 if(exited!==0 || !(await fs.readFile(events,'utf8')).includes('ordinary-quit')) throw Error('Expected ordinary quit after download');
 child=launch();
 const deadline=Date.now()+180000;
 let outcome;
 while(Date.now()<deadline){
  try {outcome=JSON.parse(await fs.readFile(result,'utf8'));break;}catch {}
  await new Promise(resolve=>setTimeout(resolve,1000));
 }
 if(!outcome||outcome.error||outcome.version!=='1.1.0'||!outcome.approved||downloads.good!==1||downloads.bad!==1){
  console.log(await fs.readFile(events,'utf8').catch(()=>''));
  throw Error(outcome?.error||'Update installation did not complete');
 }
 console.log('Passed: tampered update rejected, ordinary quit preserved rc.1, cached stable update installed after approval.');
} finally {
 child?.kill();server.close();
 await fs.rm(temp,{recursive:true,force:true});
}
