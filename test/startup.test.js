import test from 'node:test';
import assert from 'node:assert/strict';
import startup from '../src/startup.cjs';

test('startup reads OS state and applies both toggle directions', () => {
  let settings = {openAtLogin:false};
  const calls = [];
  const app = {isPackaged:true, getLoginItemSettings:()=>settings, setLoginItemSettings:value=>{calls.push(value);settings=value;}};
  const control = startup.createStartupSettings(app, 'darwin');
  assert.equal(control.read().enabled, false);
  assert.equal(control.set(true).enabled, true);
  assert.equal(control.set(false).enabled, false);
  assert.deepEqual(calls, [{openAtLogin:true},{openAtLogin:false}]);
  settings = {openAtLogin:true,status:'requires-approval'};
  assert.equal(control.read().requiresApproval, true);
  assert.throws(()=>control.set('true'));
  assert.equal(calls.length, 2);
});

test('development and unsupported platforms cannot register login items', () => {
  for (const [isPackaged, platform] of [[false,'darwin'],[false,'win32'],[true,'linux']]) {
    const app = {isPackaged,getLoginItemSettings:()=>assert.fail(),setLoginItemSettings:()=>assert.fail()};
    const control = startup.createStartupSettings(app, platform);
    assert.deepEqual(control.read(), {supported:false,enabled:false});
    assert.throws(()=>control.set(true));
  }
});

test('Windows respects OS-disabled entries and explicitly enables startup approval', () => {
  let written;
  const app = {isPackaged:true,getLoginItemSettings:()=>({openAtLogin:true,executableWillLaunchAtLogin:false}),setLoginItemSettings:value=>{written=value;}};
  const control = startup.createStartupSettings(app, 'win32');
  assert.equal(control.read().enabled, false);
  control.set(true);
  assert.deepEqual(written, {openAtLogin:true,enabled:true});
  control.set(false);
  assert.deepEqual(written, {openAtLogin:false,enabled:false});
});
