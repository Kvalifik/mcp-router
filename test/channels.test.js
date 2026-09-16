import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { Store } from '../src/store.js';
import { OAuthManager, endpoint } from '../src/oauth.js';
import { Router } from '../src/router.js';

function fixture(t) {
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'router-channels-'));t.after(()=>fs.rmSync(dir,{recursive:true,force:true}));
 const store=new Store(dir),seen=[];
 const oauth=new OAuthManager(store,'http://127.0.0.1:43127',{authFn:async(provider,options)=>{
  seen.push(options.serverUrl);
  if(options.authorizationCode){provider.saveTokens({access_token:`${provider.channel}-token`,refresh_token:`${provider.channel}-refresh`});return 'AUTHORIZED';}
  provider.saveClientInformation({client_id:`${provider.id}-${provider.channel}`});provider.saveCodeVerifier('proof');provider.redirectToAuthorization(new URL('https://mcp.webflow.com/authorize'));return 'REDIRECT';
 }});
 const opened=[];
 const router=new Router(store,oauth,{open:async p=>{opened.push(p.channel);return {listSites:async()=>[{id:'site',name:'Site'}],close:async()=>{}};}});
 const id=router.createConnection('Workspace');store.connection(id).tokens={access_token:'stable-original',refresh_token:'stable-refresh'};
 return {store,oauth,router,id,seen,opened,dir};
}
test('Beta OAuth, revocation and persistence stay separate from stable',async t=>{
 const {store,oauth,router,id,seen,dir}=fixture(t);
 await oauth.begin(id,'beta');const pending={...store.connection(id).beta.pending};
 assert.equal(store.connection(id).tokens.access_token,'stable-original');
 assert.equal(await oauth.complete(id,{...pending,code:'code'}),'beta');
 assert.deepEqual(seen,[endpoint('beta'),endpoint('beta')]);
 assert.equal(new Store(dir).connection(id).beta.tokens.access_token,'beta-token');
 oauth.provider(id,false,'beta').invalidateCredentials('tokens');
 assert.equal(store.connection(id).tokens.access_token,'stable-original');
 assert.equal(store.connection(id).beta.tokens,undefined);
 assert.throws(()=>endpoint('https://evil.example'));
 assert.throws(()=>router.edit('connections',id,{channel:'other'}));
});
test('Routing respects connection default and explicit project override without token fallback',async t=>{
 const {store,oauth,router,id,opened}=fixture(t);
 await router.sites(id);const project=Object.values(store.data.projects)[0];router.edit('projects',project.id,{enabled:true});
 router.setDefaultChannel('beta');
 await assert.rejects(router.call('read_project_site',{projectId:project.id}));
 assert.deepEqual(opened,['stable']);
 store.connection(id).beta.tokens={access_token:'beta'};
 await router.call('read_project_site',{projectId:project.id});assert.equal(opened.at(-1),'beta');
 router.edit('projects',project.id,{channel:'stable'});
 await router.call('read_project_site',{projectId:project.id});assert.equal(opened.at(-1),'stable');
 assert.equal(project.enabled,true);
});
test('New authorization invalidates prior callback without reusing its channel',async t=>{
 const {store,oauth,id}=fixture(t);
 await oauth.begin(id,'stable');const prior={...store.connection(id).pending};
 await oauth.begin(id,'beta');
 await assert.rejects(oauth.complete(id,{...prior,code:'old'}));
 assert.equal(store.connection(id).beta.pending.used,undefined);
});
