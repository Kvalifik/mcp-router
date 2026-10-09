import test from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import updates from '../src/mac-updates.cjs';
function fixture({feed='https://github.com/example/router/releases/download/v1.1.0/update-mac-arm64.json',check}={}) {
 const native=new EventEmitter(),events=[];
 let checks=0,installs=0,requests=0;
 native.setFeedURL=options=>{assert.deepEqual(options,{url:feed,serverType:'json'});};
 native.checkForUpdates=()=>{checks++;};
 native.quitAndInstall=()=>{installs++;};
 const checker={check:async()=>{requests++;return check?check():{state:'available',version:'1.1.0'};},macFeed:arch=>{assert.equal(arch,'arm64');return feed;}};
 const updater=updates.createMacUpdater({checker,autoUpdater:native,arch:'arm64',onChange:s=>events.push(s)});
 return {native,updater,events,counts:()=>({checks,installs,requests})};
}
test('concurrent checks and checks during download never start duplicate native downloads',async()=>{
 const f=fixture();
 assert.throws(()=>f.updater.install(),/No verified/);
 const results=await Promise.all([f.updater.check(),f.updater.check()]);
 assert.deepEqual(results,[{state:'downloading',version:'1.1.0'},{state:'downloading',version:'1.1.0'}]);
 await f.updater.check();assert.deepEqual(f.counts(),{checks:1,installs:0,requests:1});
 f.native.emit('update-downloaded',{},'untrusted notes','untrusted name');
 assert.deepEqual(await f.updater.check(),{state:'ready',version:'1.1.0'});
 f.updater.install();assert.equal(f.counts().installs,1);
 assert.throws(()=>f.updater.install(),/No verified/);
});
test('native signature/download failures cannot install and can be retried',async()=>{
 const f=fixture();await f.updater.check();f.native.emit('error',Error('private URL'));
 assert.deepEqual(f.updater.status(),{state:'error',reason:'install'});
 assert.throws(()=>f.updater.install(),/No verified/);
 await f.updater.check();assert.equal(f.counts().checks,2);
 f.native.emit('update-not-available');assert.deepEqual(f.updater.status(),{state:'current'});
});
test('missing feed preserves manual-download fallback without native updating',async()=>{
 const f=fixture({feed:null});assert.deepEqual(await f.updater.check(),{state:'available',version:'1.1.0'});
 assert.equal(f.counts().checks,0);assert.throws(()=>f.updater.install(),/No verified/);
 f.native.emit('update-downloaded');assert.equal(f.updater.status().state,'available');
});
test('synchronous native errors are safe and no-update checks do not download',async()=>{
 const f=fixture();f.native.setFeedURL=()=>{throw Error('private details');};
 assert.deepEqual(await f.updater.check(),{state:'error',reason:'install'});
 assert.equal(f.counts().checks,0);
 const current=fixture({check:()=>({state:'current'})});assert.deepEqual(await current.updater.check(),{state:'current'});
 assert.equal(current.counts().checks,0);
});
test('restart failure preserves ready update for retry',async()=>{
 const f=fixture();await f.updater.check();f.native.emit('update-downloaded');
 f.native.quitAndInstall=()=>{throw Error('private details');};
 assert.throws(()=>f.updater.install(),/Could not restart/);
 assert.deepEqual(f.updater.status(),{state:'ready',version:'1.1.0'});
});
