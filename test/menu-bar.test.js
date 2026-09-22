import test from 'node:test';
import assert from 'node:assert/strict';
import menuBar from '../src/menu-bar.cjs';
const {menuBarStatus,menuBarTitle,popoverBounds}=menuBar;
const fixture=()=>({connections:[{id:'one',enabled:true,channel:'stable',channels:{stable:{authorized:true,status:'connected',siteIds:['a']},beta:{authorized:true,status:'connected',siteIds:['a','b']}}}],projects:[{id:'a',connectionId:'one',siteId:'a',enabled:true,permissions:{'site:read':true}},{id:'b',connectionId:'one',siteId:'b',enabled:true,channel:'beta',permissions:{'site:read':true}}]});
test('counts a connection once across grants and honors project channel overrides',()=>{
  assert.deepEqual(menuBarStatus(fixture()),{connections:1,projects:2,attention:false});
});
test('disabled parents, missing authorization and pending inventories never inflate counts',()=>{
  const data=fixture();data.connections[0].enabled=false;
  assert.deepEqual(menuBarStatus(data),{connections:0,projects:0,attention:false});
  data.connections[0].enabled=true;data.connections[0].channels.beta.authorized=false;
  assert.deepEqual(menuBarStatus(data),{connections:1,projects:1,attention:true});
  data.connections[0].channels.stable.inventoryPending=true;
  assert.deepEqual(menuBarStatus(data),{connections:0,projects:0,attention:true});
});
test('excludes projects without permissions, unavailable projects and wrong channel site grants',()=>{
  const data=fixture();data.projects[0].permissions={};data.projects[1].channel='stable';
  assert.equal(menuBarStatus(data).projects,0);
  data.projects[0].permissions={'site:read':true};data.projects[0].available=false;
  assert.equal(menuBarStatus(data).projects,0);
});
test('display modes use plain counts and icon-only stays empty even with attention',()=>{
  const status={connections:2,projects:7,attention:false};
  assert.equal(menuBarTitle('icon',{...status,attention:true}),'');
  assert.equal(menuBarTitle('off',status),'');
  assert.equal(menuBarTitle('connections',status),'2');
  assert.equal(menuBarTitle('projects',status),'7');
  assert.equal(menuBarTitle('both',{...status,attention:true}),'2/7');
});
test('popover stays within work area on either edge and negative-coordinate displays',()=>{
  for(const area of [{x:0,y:24,width:1440,height:876},{x:-1000,y:-800,width:1000,height:700},{x:0,y:0,width:320,height:400}]) {
    for(const x of [area.x,area.x+area.width-20]) {
      const bounds=popoverBounds({x,y:area.y-24,width:20,height:24},area);
      assert.ok(bounds.x>=area.x && bounds.y>=area.y);
      assert.ok(bounds.x+bounds.width<=area.x+area.width);
      assert.ok(bounds.y+bounds.height<=area.y+area.height);
    }
  }
});
test('native title and tooltip update only when changed, and initialize replacement trays',()=>{
  const update=menuBar.createTrayTextUpdater();
  const calls=[];const tray={setTitle:title=>calls.push(['title',title]),setToolTip:tooltip=>calls.push(['tooltip',tooltip])};
  const status={connections:2,projects:4,attention:false};
  update(tray,'both',status);assert.equal(calls.length,2);
  update(tray,'both',status);assert.equal(calls.length,2);
  update(tray,'both',{...status,attention:true});assert.equal(calls.length,3);assert.equal(calls.at(-1)[0],'tooltip');
  update(tray,'icon',{...status,attention:true});assert.deepEqual(calls.at(-1),['title','']);
  update({...tray},'icon',{...status,attention:true});assert.equal(calls.length,6);
});
test('defaults to projects without overwriting saved display preferences',()=>{
  assert.equal(menuBar.menuBarMode(undefined),'projects');
  assert.equal(menuBar.menuBarMode('unknown'),'projects');
  for(const mode of menuBar.MODES)assert.equal(menuBar.menuBarMode(mode),mode);
});
