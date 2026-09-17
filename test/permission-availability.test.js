import test from 'node:test';
import assert from 'node:assert/strict';
import {permissionUnavailable, availablePreset, connectionTestUnavailable} from '../ui/permission-availability.js';
import {presetGrants} from '../ui/permission-presets.js';

const state = missingScopes => ({authorized:true,siteIds:['demo'],access:{status:'limited',missingScopes}});
const connection = {channels:{stable:state(['cms:write','sites:write','custom_code:write','pages:write']),beta:state([])}};
const reason = (key, extra={}) => permissionUnavailable({connection,channel:'stable',siteId:'demo',key,...extra});

test('connection testing explains disabled projects and uses saved permissions and server',()=>{
  const c={...connection,enabled:true,channel:'stable'};
  const p={enabled:true,siteId:'demo',permissions:{'site:read':true},read:false};
  assert.equal(connectionTestUnavailable(p,c,'stable'),null);
  assert.match(connectionTestUnavailable({...p,enabled:false},c,'stable'),/Enable this project/);
  assert.match(connectionTestUnavailable(p,{...c,enabled:false},'stable'),/Enable this connection/);
  assert.match(connectionTestUnavailable({...p,permissions:{},read:true},c,'stable'),/Save Site/);
  assert.match(connectionTestUnavailable(p,c,'beta'),/Save the MCP version/);
  assert.match(connectionTestUnavailable({...p,siteId:'missing'},c,'stable'),/isn’t authorized/);
});

test('OAuth scope metadata never locks router permissions',()=>{
  for(const key of ['cms:read','cms:write','cms:delete','site:publish']) assert.equal(reason(key),null);
});

test('missing project authorization locks all toggles, but defaults and unknown scopes stay editable',()=>{
  assert.match(reason('element:read',{siteId:'not-authorized'}),/include this project/);
  assert.match(reason('cms:read',{connection:{channels:{}}}),/Authorize Stable/);
  assert.match(reason('cms:read',{connection:{channels:{stable:{...state([]),inventoryPending:true}}}}),/still being checked/);
  assert.equal(reason('cms:write',{defaults:true}),null);
  assert.equal(reason('cms:write',{connection:{channels:{stable:{...state([]),access:{status:'unverified'}}}}}),null);
});

test('presets cannot turn on unavailable permissions or erase previously saved preferences',()=>{
  const keys=['cms:read','cms:write','cms:delete'];
  const current={'cms:read':false,'cms:write':false,'cms:delete':true};
  assert.deepEqual(availablePreset(current,presetGrants(keys,'all'),()=>reason('cms:read',{siteId:'missing'})),
    {'cms:read':false,'cms:write':false,'cms:delete':true});
  assert.deepEqual(availablePreset(current,presetGrants(keys,'none'),()=>reason('cms:read',{siteId:'missing'})),
    {'cms:read':false,'cms:write':false,'cms:delete':true});
  assert.deepEqual(current,{'cms:read':false,'cms:write':false,'cms:delete':true});
});
