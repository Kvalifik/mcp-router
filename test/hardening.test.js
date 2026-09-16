import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import http from 'node:http';
import {once} from 'node:events';
import {createDashboard} from '../src/server.js';
import {Store} from '../src/store.js';
import {excludeFromPackage} from '../packaging.mjs';

async function dashboard(t, options={}) {
 const origin='http://127.0.0.1:43138';
 const router={store:{summary:()=>({connections:[]})},createConnection:()=> 'synthetic'};
 const server=createDashboard(router,{},origin,{managementToken:'owner-secret',loginTicket:'one-time-ticket',...options});
 server.listen(43138,'127.0.0.1');await once(server,'listening');
 t.after(()=>new Promise(resolve=>{server.closeAllConnections();server.close(resolve);}));
 const request=(pathname,headers={},method='GET',body)=>new Promise((resolve,reject)=>{
  const req=http.request(origin,{path:pathname,headers,method,agent:false},res=>{let data='';res.on('data',c=>data+=c);res.on('end',()=>resolve({status:res.statusCode,headers:res.headers,body:data}));});req.on('error',reject);req.end(body);
 });
 return {origin,request};
}

test('dashboard requires owner authentication even with forged Origin and known CSRF',async t=>{
 const {origin,request}=await dashboard(t);
 for(const Cookie of ['', 'router_session=wrong', 'router_session=xxxxxxxxxxxx']) {
  assert.equal((await request('/api/state',{Origin:origin,Cookie})).status,403);
  assert.equal((await request('/',{Cookie})).status,403);
 }
 const Cookie='router_session=owner-secret';
 const state=await request('/api/state',{Cookie});assert.equal(state.status,200);
 assert.ok(!state.body.includes('owner-secret'));assert.ok(!state.body.includes('one-time-ticket'));
 const {csrf}=JSON.parse(state.body);
 const headers={Origin:origin,'Content-Type':'application/json','X-Router-CSRF':csrf};
 assert.equal((await request('/api/connections',headers,'POST','{}')).status,403);
 assert.equal((await request('/api/connections',{...headers,Cookie},'POST','{}')).status,200);
 assert.equal((await request('/api/connections',{...headers,Cookie,Origin:'https://evil.example'},'POST','{}')).status,403);
 assert.equal((await request('/api/connections',{...headers,Cookie,'X-Router-CSRF':'wrong'},'POST','{}')).status,403);
 assert.equal((await request('/api/state',{Cookie,Host:'evil.example'})).status,403);
 assert.equal((await request('/api/state',{Cookie,'Sec-Fetch-Site':'cross-site'})).status,403);
});

test('private browser login is single-use, HttpOnly, expires, and malformed URLs do not crash',async t=>{
 let clock=1000;const {request}=await dashboard(t,{now:()=>clock});
 assert.equal((await request('/dashboard/login/wrong')).status,403);
 const login=await request('/dashboard/login/one-time-ticket',{'Sec-Fetch-Site':'cross-site'});
 assert.equal(login.status,303);assert.equal(login.headers.location,'/');
 const cookie=login.headers['set-cookie'][0];assert.match(cookie,/HttpOnly; SameSite=Strict/);
 assert.equal((await request('/api/state',{Cookie:cookie.split(';')[0]})).status,200);
 assert.equal((await request('/dashboard/login/one-time-ticket')).status,410);
 assert.equal((await request('http://[')).status,400);
 assert.equal((await request('/api/state',{Cookie:cookie.split(';')[0]})).status,200);
});

test('unused browser login expires after ten minutes',async t=>{
 let clock=1000;const {request}=await dashboard(t,{now:()=>clock});clock+=600000;
 assert.equal((await request('/dashboard/login/one-time-ticket')).status,410);
});

test('reopening a copied vault restores owner-only directory, key and vault permissions',t=>{
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'router-modes-'));t.after(()=>fs.rmSync(dir,{recursive:true,force:true}));
 const store=new Store(dir);store.save();fs.chmodSync(dir,0o755);
 for(const name of ['vault.key','vault.enc'])fs.chmodSync(path.join(dir,name),0o644);
 new Store(dir);assert.equal(fs.statSync(dir).mode&0o777,0o700);
 for(const name of ['vault.key','vault.enc'])assert.equal(fs.statSync(path.join(dir,name)).mode&0o777,0o600);
});

test('packaging includes runtime and legal files, excludes unexpected files and credentials',()=>{
 for(const name of ['', '/', '/src/server.js','/public/assets/index.js','/node_modules/zod/index.js','/assets/icons/MCPRouter.icns','/licenses/shadcn-ui.txt','/LICENSE','/THIRD_PARTY_NOTICES.md','/package.json'])assert.equal(excludeFromPackage(name),false,name);
 for(const name of ['/test/test.js','/dist/app.zip','/.private-release/notes.md','/.local/vault.enc','/notes.txt','/.env','/src/.env.production','/src/debug.log','/assets/private.key','/packaging.mjs'])assert.equal(excludeFromPackage(name),true,name);
});
