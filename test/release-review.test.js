import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {spawnSync} from 'node:child_process';
test('release attestation requires current staged sources and complete, fresh channel reviews',t=>{
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'router-review-'));t.after(()=>fs.rmSync(dir,{recursive:true,force:true}));
 const run=(bin,args)=>spawnSync(bin,args,{cwd:dir,encoding:'utf8'});
 const git=(...args)=>assert.equal(run('git',args).status,0);
 for(const folder of ['scripts','docs','src'])fs.mkdirSync(path.join(dir,folder));
 for(const name of ['check-release-review.mjs','check-webflow-catalog.mjs'])fs.copyFileSync(new URL('../scripts/'+name,import.meta.url),path.join(dir,'scripts',name));
 fs.writeFileSync(path.join(dir,'package.json'),JSON.stringify({version:'1.0.0',type:'module'}));
 fs.writeFileSync(path.join(dir,'src/catalog.json'),'[]');
 const snapshot=path.join(dir,'snapshot.json');fs.writeFileSync(snapshot,JSON.stringify([{name:'webflow_guide_tool',inputSchema:{properties:{}}}]));
 git('init');git('add','.');
 const check=(...args)=>run(process.execPath,['scripts/check-release-review.mjs',...args]);
 assert.notEqual(check().status,0,'missing report must fail');
 assert.equal(check('--record',snapshot,snapshot).status,0);
 git('add','docs/release-review.json');assert.equal(check().status,0);
 fs.writeFileSync(path.join(dir,'src/catalog.json'),'[ ]');assert.notEqual(check().status,0,'unstaged change must fail');
 git('add','src/catalog.json');assert.notEqual(check().status,0,'staged change must invalidate review');
 assert.equal(check('--record',snapshot,snapshot).status,0);
 const report=path.join(dir,'docs/release-review.json'),valid=JSON.parse(fs.readFileSync(report));
 for(const edit of [r=>r.channels.beta.status='unverified',r=>r.channels.beta.unverified.push('missing grant'),r=>r.reviewedAt='2000-01-01T00:00:00Z',r=>r.version='2.0.0']) {
  const invalid=structuredClone(valid);edit(invalid);fs.writeFileSync(report,JSON.stringify(invalid));assert.notEqual(check().status,0);
 }
 fs.writeFileSync(report,JSON.stringify(valid));assert.equal(check().status,0);
});
