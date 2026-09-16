import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import integrations from '../src/integrations.cjs';
const {createIntegrations,writeRegistration,readConfig,NAME}=integrations;
function fixture(t) {
 const home=fs.mkdtempSync(path.join(os.tmpdir(),'wfr-clients-'));t.after(()=>fs.rmSync(home,{recursive:true,force:true}));
 fs.mkdirSync(path.join(home,'.local/bin'),{recursive:true});for(const n of ['codex','claude','gemini'])fs.writeFileSync(path.join(home,'.local/bin',n),'');for(const n of ['Claude','Cursor','Visual Studio Code'])fs.mkdirSync(path.join(home,'Applications',n+'.app'),{recursive:true});
 const appData=path.join(home,'Library/Application Support'),expected={command:'/Router.app/Contents/MacOS/Router',args:['/Router.app/Contents/Resources/app/src/stdio.js'],env:{ELECTRON_RUN_AS_NODE:'1',ROUTER_SOCKET:'/private/router.sock'}};
 let codexConfig=null;const calls=[];
 const client=createIntegrations({home,appData,applicationsDirs:[path.join(home,'Applications')],binaryDirs:[path.join(home,'.local/bin')],executable:expected.command,script:expected.args[0],socket:expected.env.ROUTER_SOCKET,run:async(command,args)=>{calls.push(args);if(args[1]==='add'){codexConfig={enabled:true,transport:expected};return {stdout:''};}if(!codexConfig)throw Object.assign(new Error('missing'),{stderr:'No MCP server named webflow_router_poc found.'});return {stdout:JSON.stringify(codexConfig)};}});
 return {home,appData,expected,client,calls,setCodex:d=>codexConfig=d};
}
test('Claude registration preserves unrelated settings and reconnect is idempotent',t=>{
 const {home,expected}=fixture(t),file=path.join(home,'config.json');const initial={preferences:{theme:'dark'},mcpServers:{other:{command:'other',env:{secret:'keep'}}}};fs.writeFileSync(file,JSON.stringify(initial));
 writeRegistration(file,expected);writeRegistration(file,expected);
 const result=readConfig(file).data;assert.deepEqual(result.preferences,initial.preferences);assert.deepEqual(result.mcpServers.other,initial.mcpServers.other);assert.deepEqual(result.mcpServers[NAME],expected);assert.equal(Object.keys(result.mcpServers).length,2);assert.equal(fs.statSync(file).mode&0o777,0o600);
});
test('malformed settings are left untouched',t=>{
 const {home,expected}=fixture(t),file=path.join(home,'bad.json');for(const raw of ['{broken','[]','{"mcpServers":[]}']){fs.writeFileSync(file,raw);assert.throws(()=>writeRegistration(file,expected));assert.equal(fs.readFileSync(file,'utf8'),raw);}
});
test('all clients report registration state and connect only the selected app',async t=>{
 const {client,home,appData}=fixture(t);assert.deepEqual((await client.status()).map(c=>c.state),Array(6).fill('not-connected'));
 assert.equal((await client.connect('claude-desktop')).ok,true);assert.equal(fs.existsSync(path.join(home,'.claude.json')),false);assert.ok(readConfig(path.join(appData,'Claude/claude_desktop_config.json')).data.mcpServers[NAME]);
 assert.equal((await client.connect('claude-code')).ok,true);assert.equal(readConfig(path.join(home,'.claude.json')).data.mcpServers[NAME].type,'stdio');assert.equal((await client.connect('codex')).ok,true);
 assert.deepEqual((await client.status()).map(c=>c.state),['configured','configured','configured','not-connected','not-connected','not-connected']);assert.equal((await client.connect('unknown')).ok,false);
});
test('disabled or stale Codex registration offers reconnect; malformed config is an error',async t=>{
 const {client,expected,setCodex,home}=fixture(t);setCodex({enabled:false,transport:expected});assert.equal((await client.status())[0].state,'needs-reconnect');setCodex({enabled:true,transport:{...expected,args:['/old/path']}});assert.equal((await client.status())[0].state,'needs-reconnect');
 assert.equal((await client.connect('codex')).ok,true);assert.equal((await client.status())[0].state,'configured');fs.writeFileSync(path.join(home,'.claude.json'),'{broken');assert.equal((await client.status())[2].state,'error');assert.equal((await client.connect('claude-code')).ok,false);
});
test('Cursor, VS Code and Gemini preserve comments, other servers and restrictions',async t=>{
 const {client,home,appData,expected}=fixture(t);
 for(const [id,file,key] of [['cursor',path.join(home,'.cursor/mcp.json'),'mcpServers'],['vscode',path.join(appData,'Code/User/mcp.json'),'servers'],['gemini',path.join(home,'.gemini/settings.json'),'mcpServers']]){
  fs.mkdirSync(path.dirname(file),{recursive:true});
  fs.writeFileSync(file,`{\n // Keep this comment\n "theme": "dark", "mcp":{"excluded":["other"]}, "${key}": {"other":{"command":"keep"}, "${NAME}": {"command":"old", "trust":false, "excludeTools":["delete"]}},\n}`);
  assert.equal((await client.connect(id)).ok,true,id);
  const {raw,data}=readConfig(file,key,true);
  assert.match(raw,/Keep this comment/);assert.equal(data.theme,'dark');assert.equal(data[key].other.command,'keep');assert.equal(data[key][NAME].command,expected.command);assert.equal(data[key][NAME].trust,false);assert.deepEqual(data[key][NAME].excludeTools,['delete']);assert.deepEqual(data.mcp.excluded,['other']);
  assert.equal((await client.status()).find(c=>c.id===id).state,'configured');
 }
});
test('configuration exports use the right root and contain only local launch data',t=>{
 const {client,expected}=fixture(t);
 for(const [format,key] of [['standard','mcpServers'],['vscode','servers']])assert.deepEqual(JSON.parse(client.configuration(format)),{[key]:{[NAME]:{type:'stdio',...expected}}});
 assert.throws(()=>client.configuration('other'));assert.equal(client.download('unknown'),undefined);
});
test('missing applications are rediscovered after installation',async t=>{
 const {client,home}=fixture(t);const binary=path.join(home,'.local/bin/gemini');fs.unlinkSync(binary);
 assert.equal((await client.status()).find(c=>c.id==='gemini').installed,false);assert.equal((await client.connect('gemini')).ok,false);
 fs.writeFileSync(binary,'');assert.equal((await client.status()).find(c=>c.id==='gemini').installed,true);
});
test('malformed JSONC is never rewritten',t=>{
 const {home,expected}=fixture(t),file=path.join(home,'mcp.json');
 for(const raw of ['{"servers":[]}', '{"servers":{oops}}']){fs.writeFileSync(file,raw);assert.throws(()=>writeRegistration(file,expected,'servers',true));assert.equal(fs.readFileSync(file,'utf8'),raw);}
});


test('legacy client names migrate with tool restrictions, disabled state and unrelated entries preserved',t=>{
 const {client,home,appData}=fixture(t);
 const file=path.join(appData,'Claude/claude_desktop_config.json');fs.mkdirSync(path.dirname(file),{recursive:true});
 const old={command:'router',disabled:true,disabledTools:['write_webflow'],env:{ROUTER_SOCKET:home+'/Library/Application Support/WebflowRouter/router/router.sock',KEEP:'yes'}};
 fs.writeFileSync(file,JSON.stringify({mcpServers:{webflow_router_poc:old,other:{command:'keep'}}}));
 const codex=path.join(home,'.codex/config.toml');fs.mkdirSync(path.dirname(codex),{recursive:true});
 fs.writeFileSync(codex,'# keep comment\n[mcp_servers.webflow_router_poc]\nenabled = false\ndisabled_tools = ["write_webflow"]\n[mcp_servers.webflow_router_poc.env]\nROUTER_SOCKET = "'+old.env.ROUTER_SOCKET+'"\n[mcp_servers.other]\ncommand = "keep"\n');
 client.migrateLegacy();client.migrateLegacy();
 const result=readConfig(file).data.mcpServers;
 assert.equal(result.webflow_router_poc,undefined);assert.equal(result[NAME].disabled,true);assert.deepEqual(result[NAME].disabledTools,old.disabledTools);assert.equal(result[NAME].env.KEEP,'yes');assert.match(result[NAME].env.ROUTER_SOCKET,/MCPRouter/);assert.deepEqual(result.other,{command:'keep'});
 const text=fs.readFileSync(codex,'utf8');assert.ok(!text.includes('webflow_router_poc'));assert.ok(text.includes('[mcp_servers.mcp_router_for_webflow]'));assert.ok(text.includes('enabled = false'));assert.ok(text.includes('disabled_tools = ["write_webflow"]'));assert.ok(text.includes('# keep comment'));assert.ok(text.includes('[mcp_servers.other]'));
});

test('migration refuses to overwrite a current registration with a legacy one',t=>{
 const {client,home}=fixture(t);const file=path.join(home,'.claude.json');
 const raw=JSON.stringify({mcpServers:{webflow_router_poc:{command:'old'},[NAME]:{command:'new'}}});fs.writeFileSync(file,raw);
 assert.throws(()=>client.migrateLegacy(),/Both legacy/);assert.equal(fs.readFileSync(file,'utf8'),raw);
});
