import test from 'node:test';
import assert from 'node:assert/strict';
import {compareGrants} from '../src/grant-comparison.js';
test('Beta partial grants disclose missing sites and workspaces',()=>{
 const c={tokens:{scope:'read write'},stableSites:[{id:'a',name:'A',workspaceId:'w1'},{id:'b',name:'B',workspaceId:'w2'}],beta:{tokens:{scope:'read'},sites:[{id:'a',name:'A',workspaceId:'w1'}]}};
 const r=compareGrants(c);assert.deepEqual(r.missingProjects,[{id:'b',name:'B'}]);assert.deepEqual(r.missingWorkspaceIds,['w2']);
 assert.equal(Object.hasOwn(r,'missingScopes'),false);
 c.beta.inventoryPending=true;assert.equal(compareGrants(c),null);
});
