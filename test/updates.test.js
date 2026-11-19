import test from 'node:test';
import assert from 'node:assert/strict';
import updates from '../src/updates.cjs';
const {newer,createUpdateChecker}=updates;
test('version checks compare numeric stable releases and reject preview or malformed tags',()=>{
 assert.equal(newer('v0.10.0','0.9.9'),true);for(const v of ['0.9.9','0.8.0','1.0.0-beta','bad'])assert.equal(newer(v,'0.9.9'),false);
});
test('checks retain the detected version but link to trusted releases page, ignoring remote URLs',async()=>{
 const checker=createUpdateChecker({repository:'example/router',currentVersion:'1.0.0',fetchImpl:async(url,options)=>{assert.equal(url,'https://api.github.com/repos/example/router/releases/latest');assert.equal(options.redirect,'error');return {ok:true,text:async()=>JSON.stringify({tag_name:'v1.1.0',html_url:'https://evil.example'})};}});
 assert.deepEqual(await checker.check(),{state:'available',version:'1.1.0'});assert.equal(checker.releaseUrl(),'https://github.com/example/router/releases/tag/v1.1.0');
});
test('missing configuration never makes a network request; network and missing-release failures are handled',async()=>{
 const c=createUpdateChecker({currentVersion:'1.0.0',fetchImpl:()=>{throw Error('must not run')}});assert.equal((await c.check()).state,'unconfigured');assert.equal(c.releaseUrl(),null);
 for(const [fetchImpl,state] of [[async()=>({status:404}),'no-release'],[async()=>{throw Error('offline')},'error'],[async()=>({ok:true,text:async()=>'{invalid'}),'error'],[async()=>({ok:true,text:async()=>JSON.stringify({tag_name:'2.0.0',prerelease:true})}),'no-release']])assert.equal((await createUpdateChecker({repository:'example/router',currentVersion:'1.0.0',fetchImpl}).check()).state,state);
});

test('update failures expose safe diagnostic categories without remote error contents',async()=>{
 const fixtures=[
  [async()=>{throw new DOMException('private detail','TimeoutError')},'timeout'],
  [async()=>{throw new TypeError('private detail')},'network'],
  [async()=>({ok:false,status:429}),'rate-limit'],
  [async()=>({ok:false,status:403,headers:new Headers({'x-ratelimit-remaining':'0'})}),'rate-limit'],
  [async()=>({ok:false,status:403,headers:new Headers()}),'server'],
  [async()=>({ok:false,status:503}),'server'],
  [async()=>({ok:true,text:async()=>'{invalid'}),'invalid-response'],
 ];
 for(const [fetchImpl,reason] of fixtures){
  const checker=createUpdateChecker({repository:'example/router',currentVersion:'1.0.0',fetchImpl});
  assert.deepEqual(await checker.check(),{state:'error',reason});
 }
});

test('Mac archives are pinned to the detected tag, architecture and GitHub digest',async()=>{
 const name='MCP-Router-1.2.3-mac-arm64.zip', digest='a'.repeat(64);
 const archive={name, size:123, digest:'sha256:'+digest,browser_download_url:'https://untrusted.invalid'};
 const release={tag_name:'v1.2.3',assets:[{name:'update-mac-arm64.json'},archive]};
 const checker=createUpdateChecker({repository:'example/router',currentVersion:'1.0.0',fetchImpl:async()=>Response.json(release)});
 await checker.check();
 assert.deepEqual(checker.macArchive('arm64'),{version:'1.2.3',url:'https://github.com/example/router/releases/download/v1.2.3/'+name,sha256:digest,size:123});
 assert.equal(checker.macArchive('x64'),null);
 archive.digest=null;await checker.check();assert.equal(checker.macArchive('arm64'),null);
});

test('RC installs find later candidates and the corresponding stable release across pages',async()=>{
 const candidate=n=>({tag_name:'v2.0.0-rc.'+n,prerelease:true});
 const items=[candidate(2),candidate(10),{tag_name:'v9.0.0',draft:true},...Array(7).fill({tag_name:'junk'})];
 const last=[];
 const checker=createUpdateChecker({repository:'example/router',currentVersion:'2.0.0-rc.2',fetchImpl:async url=>{
   assert.ok(url.includes('/releases?'));
   return Response.json(url.endsWith('page=1')?items:last);
 }});
 assert.equal((await checker.check()).version,'2.0.0-rc.10');
 last.push({tag_name:'v2.0.0'});assert.equal((await checker.check()).version,'2.0.0');
 assert.equal(newer('1.9.9','2.0.0-rc.1'),false);
 assert.equal(newer('2.0.0-rc.10','2.0.0'),false);
 const stable=createUpdateChecker({repository:'example/router',currentVersion:'1.9.9',fetchImpl:async()=>Response.json(candidate(10))});
 assert.equal((await stable.check()).state,'no-release');
});
