import test from 'node:test';
import assert from 'node:assert/strict';
import updates from '../src/updates.cjs';
const {newer,createUpdateChecker}=updates;
test('version checks compare numeric stable releases and reject preview or malformed tags',()=>{
 assert.equal(newer('v0.10.0','0.9.9'),true);for(const v of ['0.9.9','0.8.0','1.0.0-beta','bad'])assert.equal(newer(v,'0.9.9'),false);
});
test('checks use fixed GitHub API and construct trusted download URLs, ignoring remote URLs',async()=>{
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
