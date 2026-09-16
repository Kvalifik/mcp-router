import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import paths from '../src/paths.cjs';

test('legacy profile moves intact, including vault and UI preferences, and migration is idempotent',t=>{
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'router-paths-'));t.after(()=>fs.rmSync(dir,{recursive:true,force:true}));
 const old=path.join(dir,'WebflowRouter');fs.mkdirSync(path.join(old,'router'),{recursive:true,mode:0o700});fs.writeFileSync(path.join(old,'router/vault.enc'),'synthetic');fs.writeFileSync(path.join(old,'Preferences'),'synthetic preference');
 const current=paths.migrateUserData(dir);assert.equal(current,path.join(dir,'MCPRouter'));assert.equal(fs.existsSync(old),false);assert.equal(fs.readFileSync(path.join(current,'router/vault.enc'),'utf8'),'synthetic');assert.equal(fs.readFileSync(path.join(current,'Preferences'),'utf8'),'synthetic preference');assert.equal(paths.migrateUserData(dir),current);
});
test('migration does not move a running legacy daemon or overwrite existing target data',t=>{
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'router-paths-'));t.after(()=>fs.rmSync(dir,{recursive:true,force:true}));
 const old=path.join(dir,'WebflowRouter');fs.mkdirSync(path.join(old,'router'),{recursive:true});fs.writeFileSync(path.join(old,'router/daemon.lock'),String(process.pid));assert.throws(()=>paths.migrateUserData(dir),/Quit the previous/);assert.ok(fs.existsSync(old));
 fs.mkdirSync(path.join(dir,'MCPRouter'));assert.equal(paths.migrateUserData(dir),path.join(dir,'MCPRouter'));assert.ok(fs.existsSync(old));
});
test('old socket configuration resolves to neutral path without altering unrelated sockets',()=>{
 assert.equal(paths.currentSocket('/home/Library/Application Support/WebflowRouter/router/router.sock'),'/home/Library/Application Support/MCPRouter/router/router.sock');assert.equal(paths.currentSocket('/tmp/other/router.sock'),'/tmp/other/router.sock');
});
