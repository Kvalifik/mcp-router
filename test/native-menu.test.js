import test from 'node:test';
import assert from 'node:assert/strict';
import nativeMenu from '../src/native-menu.cjs';
const {menuTemplate}=nativeMenu;
test('native menu preserves submenu state and returns only selected action IDs',()=>{
  let selected;
  const menu=menuTemplate([{label:'Appearance',children:[{id:'theme-dark',label:'Dark',checked:true}]},{separator:true},{id:'about',label:'About'}],id=>{selected=id;});
  assert.equal(menu[0].submenu[0].checked,true);
  assert.equal(menu[1].type,'separator');
  menu[0].submenu[0].click();assert.equal(selected,'theme-dark');
});
test('rejects malformed, duplicate and oversized native menus',()=>{
  for(const items of [null,[{label:'Missing ID'}],[{id:'a',label:'A'},{id:'a',label:'Duplicate'}],[{id:'a',label:'A',checked:'yes'}],Array.from({length:101},()=>({separator:true}))])assert.throws(()=>menuTemplate(items,()=>{}));
  let items=[{id:'a',label:'A'}];for(let i=0;i<5;i++)items=[{label:'Nested',children:items}];
  assert.throws(()=>menuTemplate(items,()=>{}));
});
test('only bundled icons can be used by native actions and submenu headings',()=>{
  const icon={fixture:true};
  const menu=menuTemplate([{label:'Appearance',icon:'Monitor',children:[{id:'about',label:'About',icon:'Info'}]}],()=>{},{Monitor:icon,Info:icon});
  assert.equal(menu[0].icon,icon);assert.equal(menu[0].submenu[0].icon,icon);
  assert.throws(()=>menuTemplate([{id:'about',label:'About',icon:'/private/file.png'}],()=>{}));
});
test('disabled operations remain disabled in the native menu',()=>{
  const [item]=menuTemplate([{id:'reconnect',label:'Reconnect',disabled:true}],()=>{});
  assert.equal(item.enabled,false);
  assert.throws(()=>menuTemplate([{id:'reconnect',label:'Reconnect',disabled:'true'}],()=>{}));
});
