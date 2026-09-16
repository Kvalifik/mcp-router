import test from 'node:test';
import assert from 'node:assert/strict';
import { projectAuthorized } from '../ui/channel-access.js';
test('OAuth approval for one site does not authorize other projects',()=>{
 const c={channels:{beta:{authorized:true,siteIds:['example-site']},stable:{authorized:true,siteIds:['example-site','other']}}};
 assert.equal(projectAuthorized(c,'beta','example-site'),true);
 assert.equal(projectAuthorized(c,'beta','other'),false);
 assert.equal(projectAuthorized(c,'stable','other'),true);
 c.channels.beta.inventoryPending=true;
 assert.equal(projectAuthorized(c,'beta','example-site'),false);
 c.channels.beta.inventoryPending=false;c.channels.beta.authorized=false;
 assert.equal(projectAuthorized(c,'beta','example-site'),false);
});
