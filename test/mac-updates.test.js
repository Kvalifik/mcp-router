import test from 'node:test';
import assert from 'node:assert/strict';
import {EventEmitter} from 'node:events';
import {createHash} from 'node:crypto';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import updates from '../src/mac-updates.cjs';
import archives from '../src/update-cache.cjs';

function fixture(saved = {}, {manualOnly = false, prepare = async () => {}} = {}) {
  const native = new EventEmitter();
  const calls = [], events = [];
  const release = {version:'2.0.0'};
  native.setFeedURL = ({url}) => calls.push(url);
  native.checkForUpdates = () => calls.push('native check');
  native.quitAndInstall = () => calls.push('restart');
  const updater = updates.createAppUpdater({
    checker:{check:async () => ({state:'available', ...release}), macArchive:() => ({...release, sha256:release.version}), releaseUrl:() => 'release'},
    autoUpdater:manualOnly ? null : native, arch:'arm64',
    cache:{prepare, installFeed:async () => 'private feed'},
    isSkipped:v => saved.skip?.includes(v), setSkipped:v => { (saved.skip ||= []).push(v); }, onChange:s => events.push(s),
  });
  return {updater, native, calls, release, events};
}

test('downloads once across windows and requires approval of the currently offered version', async () => {
  let downloads = 0;
  const f = fixture({}, {prepare:async () => { downloads++; }});
  await Promise.all([f.updater.check(),f.updater.check(true)]);
  await f.updater.check();
  assert.equal(downloads, 1);
  assert.deepEqual(f.calls, []);
  f.native.emit('update-downloaded');
  await assert.rejects(f.updater.install('1.9.0'));
  assert.deepEqual(f.calls, []);
  await f.updater.install('2.0.0');
  assert.deepEqual(f.calls, ['private feed','native check']);
  await assert.rejects(f.updater.install('2.0.0'));
  f.native.emit('update-downloaded');
  assert.deepEqual(f.calls, ['private feed','native check','restart']);
});

for (const manualOnly of [true,false]) {
  test('skip survives relaunch, manual check reoffers it and newer versions surface: manual download '+manualOnly, async () => {
    const saved = {};
    let f = fixture(saved,{manualOnly});
    await f.updater.check();
    f.updater.skip('2.0.0');
    f = fixture(saved,{manualOnly});
    assert.deepEqual(await f.updater.check(), {state:'skipped'});
    assert.equal((await f.updater.check(true)).version, '2.0.0');
    if (manualOnly) assert.equal(f.updater.downloadUrl('2.0.0'),'release');
    else await f.updater.install('2.0.0');
    f = fixture(saved,{manualOnly});
    f.release.version = '2.0.1';
    assert.deepEqual(await f.updater.check(), {state:manualOnly?'available':'ready',version:'2.0.1'});
    assert.throws(() => f.updater.skip('2.0.0'));
    assert.throws(() => f.updater.downloadUrl('2.0.0'));
    await assert.rejects(f.updater.install('2.0.0'));
    f.updater.skip('2.0.1');
    f.release.version = '2.0.0';
    assert.deepEqual(await f.updater.check(),{state:'skipped'});
  });
}

test('release notes follow the offered version through download and readiness', async () => {
  const started = Promise.withResolvers(), finish = Promise.withResolvers();
  const f = fixture({}, {prepare:() => { started.resolve(); return finish.promise; }});
  const check = f.updater.check();
  await started.promise;
  assert.equal(f.updater.releaseNotesUrl('2.0.0'), 'release');
  assert.throws(() => f.updater.releaseNotesUrl('1.0.0'));
  finish.resolve();
  await check;
  assert.equal(f.updater.releaseNotesUrl('2.0.0'), 'release');
  assert.deepEqual(f.calls, []);
  f.updater.skip('2.0.0');
  assert.throws(() => f.updater.releaseNotesUrl('2.0.0'));
});

test('skip during download suppresses its completion and clears a concurrent manual offer', async () => {
  const start = Promise.withResolvers(), end = Promise.withResolvers();
  const f = fixture({}, {prepare:() => { start.resolve(); return end.promise; }});
  const check = f.updater.check(true);
  await start.promise;
  f.updater.skip('2.0.0');
  end.resolve();
  assert.deepEqual(await check, {state:'skipped'});
  await assert.rejects(f.updater.install('2.0.0'));
  assert.equal((await f.updater.check(true)).state, 'ready');
});

test('a manual check immediately after skipping a slow download can retry', async () => {
  let attempts = 0;
  const start = Promise.withResolvers();
  const f = fixture({}, {prepare:async (_asset, signal) => {
    if (++attempts > 1) return;
    start.resolve();
    await new Promise((_, reject) => signal.addEventListener('abort', () => reject(signal.reason), {once:true}));
  }});
  const automatic = f.updater.check();
  await start.promise;
  f.updater.skip('2.0.0');
  const manual = f.updater.check(true);
  assert.equal((await automatic).state,'skipped');
  assert.deepEqual(await manual,{state:'ready',version:'2.0.0'});
  assert.equal(attempts,2);
});

test('native rejection requires another explicit install even after retry', async () => {
  const f = fixture();
  await f.updater.check();
  await f.updater.install('2.0.0');
  f.native.emit('error',new Error('private error'));
  assert.deepEqual(f.events.at(-1),{state:'error',reason:'install'});
  await f.updater.check();
  f.native.emit('update-downloaded');
  assert.ok(!f.calls.includes('restart'));
});

test('cache verifies bytes, recovers from interruption and reuses the download after ordinary quit', async t => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(),'update-cache-'));
  t.after(() => fs.rm(dir,{force:true,recursive:true}));
  const bytes = Buffer.from('signed fixture placeholder');
  const asset = {version:'2.0.0',url:'https://example.invalid/archive',sha256:createHash('sha256').update(bytes).digest('hex'),size:bytes.length};
  let body = Buffer.alloc(bytes.length), requests = 0;
  const fetchImpl = async () => {requests++;return new Response(body);};
  let cache = archives.createUpdateCache(dir,fetchImpl);
  await assert.rejects(cache.prepare(asset),/checksum/);
  assert.deepEqual(await fs.readdir(dir),[]);
  body = bytes;
  await cache.prepare(asset);
  assert.deepEqual(await fs.readdir(dir),['update.zip']);
  cache = archives.createUpdateCache(dir,fetchImpl);
  await cache.prepare(asset);
  assert.equal(requests,2);
  const feed = JSON.parse(await fs.readFile(fileURLToPath(await cache.installFeed(asset))));
  assert.deepEqual(await fs.readFile(fileURLToPath(feed.url)),bytes);
  assert.equal(feed.sha256,asset.sha256);
  await cache.clear();
  assert.deepEqual(await fs.readdir(dir),[]);
});
