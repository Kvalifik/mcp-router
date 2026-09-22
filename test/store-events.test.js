import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { Store } from '../src/store.js';
test('saved changes notify after persistence, coalesce within a turn, and stop after unsubscribe',async()=>{
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'router-events-'));
 try {
  const store=await Store.open(dir);let calls=0;
  const listener=()=>{calls++;assert.equal(new Store(dir).data.settings.value,store.data.settings.value);};
  store.on('change',listener);
  store.data.settings={value:1};store.save();store.data.settings.value=2;store.save();
  assert.equal(calls,0);await Promise.resolve();assert.equal(calls,1);
  store.audit('synthetic_test');await Promise.resolve();assert.equal(calls,2);
  store.off('change',listener);store.save();await Promise.resolve();assert.equal(calls,2);
 }finally{fs.rmSync(dir,{recursive:true,force:true});}
});
test('failed persistence does not announce a saved change',async()=>{
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'router-events-'));
 try {const store=await Store.open(dir);let calls=0;store.on('change',()=>calls++);store.file=path.join(dir,'missing','vault.enc');assert.throws(()=>store.save());await Promise.resolve();assert.equal(calls,0);}
 finally{fs.rmSync(dir,{recursive:true,force:true});}
});
