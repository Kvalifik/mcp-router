import test from 'node:test';
import assert from 'node:assert/strict';
import access from '../src/access-status.cjs';
import menuBar from '../src/menu-bar.cjs';
const fixture = () => ({ connections: [{ id:'c', name:'Example', enabled:true, channel:'stable', channels:{ stable:{authorized:true,status:'connected',siteIds:['a','b','c']}, beta:{authorized:true,status:'connected',siteIds:['a']} } }], projects:['a','b','c'].map(id=>({id,siteId:id,name:`Project ${id}`,connectionId:'c',enabled:true,permissions:{'site:read':true}})) });
test('three enabled switches and a missing Beta grant explain the two ready projects',()=>{
  const data=fixture();data.projects[1].channel='beta';
  const status=access.accessStatus(data);
  assert.equal(status.enabledProjects,3);assert.equal(status.projects,2);
  assert.deepEqual(status.readyProjectIds,['a','c']);assert.equal(status.issues.length,1);
  assert.equal(status.issues[0].projectId,'b');assert.equal(status.issues[0].channel,'beta');
  assert.equal(status.issues[0].actionLabel,'Reconnect Beta');
  assert.match(status.issues[0].reason,/not included/);
  let tooltip;menuBar.createTrayTextUpdater()({setTitle(){},setToolTip(value){tooltip=value;}},'projects',status);
  assert.match(tooltip,/2 of 3 enabled projects ready/);assert.match(tooltip,/Project b:.*Beta.*Reconnect Beta/);
});
test('disabled connections and projects do not create issues',()=>{
  const data=fixture();data.connections[0].enabled=false;data.connections[0].channels={};
  assert.equal(access.accessStatus(data).issues.length,0);assert.equal(access.accessStatus(data).enabledProjects,0);
  data.connections[0].enabled=true;data.connections[0].channels.stable={authorized:true,status:'connected',siteIds:[]};data.projects.forEach(p=>p.enabled=false);
  assert.equal(access.accessStatus(data).issues.length,0);
});
test('pending checks are informational, failed checks stay actionable even with pending inventory',()=>{
  const data=fixture();const grant=data.connections[0].channels.stable;grant.inventoryPending=true;
  let status=access.accessStatus(data);assert.equal(status.projects,0);assert.equal(status.attention,false);assert.ok(status.issues.every(i=>i.pending));
  grant.status='check_failed';status=access.accessStatus(data);assert.equal(status.attention,true);assert.ok(status.issues.every(i=>i.action==='check'&&!i.pending));
  grant.inventoryPending=false;grant.status='connected';assert.equal(access.accessStatus(data).issues.length,0);
});
test('authorization and permissions give distinct actions without using the other grant',()=>{
  const data=fixture();data.projects[0].permissions={};data.projects[1].channel='beta';data.connections[0].channels.beta.authorized=false;
  const status=access.accessStatus(data);assert.equal(status.projects,1);
  assert.equal(status.issues[0].action,'permissions');assert.equal(status.issues[1].actionLabel,'Authorize Beta');
});
test('connection-only issues remain visible and use their selected channel',()=>{
  const data=fixture();data.projects=[];data.connections[0].channel='beta';data.connections[0].channels.beta.status='check_failed';
  const status=access.accessStatus(data);assert.equal(status.issues.length,1);assert.equal(status.issues[0].name,'Example');assert.equal(status.issues[0].channel,'beta');
});
test('healthy tray hover uses plain counts; ratios appear only for warnings',()=>{
  let tooltip;
  const tray={setTitle(){},setToolTip(value){tooltip=value;}};
  const update=menuBar.createTrayTextUpdater();
  const data=fixture();
  update(tray,'projects',access.accessStatus(data));
  assert.equal(tooltip,'1 connection · 3 projects');
  data.connections[0].channels.stable.inventoryPending=true;
  update(tray,'projects',access.accessStatus(data));
  assert.doesNotMatch(tooltip,/\d of \d|needs attention/);
  assert.match(tooltip,/Checking Stable access/);
  data.connections[0].channels.stable.status='check_failed';
  update(tray,'projects',access.accessStatus(data));
  assert.match(tooltip,/0 of 3 enabled projects ready/);
  data.connections[0].channels.stable.inventoryPending=false;
  data.connections[0].channels.stable.status='connected';
  update(tray,'projects',access.accessStatus(data));
  assert.equal(tooltip,'1 connection · 3 projects');
});
