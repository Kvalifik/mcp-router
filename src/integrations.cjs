const fs = require('node:fs');
const path = require('node:path');
const { randomUUID } = require('node:crypto');
const jsonc = require('jsonc-parser');
const NAME = 'mcp_router_for_webflow';
const LEGACY_NAME = 'webflow_router_poc';
const { currentSocket } = require('./paths.cjs');
const isObject = x => x && typeof x === 'object' && !Array.isArray(x);
function readConfig(file, key = 'mcpServers', comments = false) {
  let raw; try { raw = fs.readFileSync(file, 'utf8'); } catch (e) { if (e.code === 'ENOENT') return { raw:null, data:{} }; throw e; }
  const errors=[];
  const data = comments ? jsonc.parse(raw,errors,{allowTrailingComma:true}) : JSON.parse(raw);
  if (errors.length || !isObject(data) || (data[key] !== undefined && !isObject(data[key]))) throw new Error('Invalid MCP configuration');
  return { raw, data };
}
function writeRegistration(file, entry, key = 'mcpServers', comments = false) {
  const {raw,data} = readConfig(file,key,comments);
  // Preserve this registration's client-specific restrictions and unrelated fields.
  const merged = {...(isObject(data[key]?.[NAME]) ? data[key][NAME] : {}), ...entry};
  delete merged.url; delete merged.httpUrl;
  data[key] = {...data[key], [NAME]:merged};
  const output = comments && raw !== null ? jsonc.applyEdits(raw,jsonc.modify(raw,[key,NAME],merged,{formattingOptions:{insertSpaces:true,tabSize:2}})) : JSON.stringify(data,null,2)+'\n';
  fs.mkdirSync(path.dirname(file), {recursive:true, mode:0o700});
  const temp = `${file}.router-${randomUUID()}.tmp`;
  try {
    fs.writeFileSync(temp, output, {flag:'wx',mode:0o600});
    if (readConfig(file,key,comments).raw !== raw) throw new Error('Configuration changed. Please retry.');
    if (raw !== null) fs.writeFileSync(`${file}.mcp-router-backup-${randomUUID()}`,raw,{flag:'wx',mode:0o600});
    fs.renameSync(temp,file);
  } finally { if(fs.existsSync(temp)) fs.unlinkSync(temp); }
}
function replaceConfig(file, raw, output) {
 const temp=`${file}.router-${randomUUID()}.tmp`;
 try {
  fs.writeFileSync(temp,output,{flag:'wx',mode:0o600});
  if(fs.readFileSync(file,'utf8')!==raw)throw new Error('Configuration changed');
  fs.writeFileSync(`${file}.mcp-router-backup-${randomUUID()}`,raw,{flag:'wx',mode:0o600});
  fs.renameSync(temp,file);
 } finally {if(fs.existsSync(temp))fs.unlinkSync(temp);}
}
async function readCodexConfig(file) {
  const toml = await import('@decimalturn/toml-patch');
  let raw; try { raw=fs.readFileSync(file,'utf8'); } catch(e) { if(e.code!=='ENOENT')throw e; raw=null; }
  const data=toml.parse(raw || '');
  if (!isObject(data) || (data.mcp_servers!==undefined && !isObject(data.mcp_servers))) throw new Error('Invalid MCP configuration');
  return {raw,data,toml};
}
async function writeCodexRegistration(file,entry) {
  const {raw,data,toml}=await readCodexConfig(file);
  const previous=data.mcp_servers?.[NAME];
  if(previous!==undefined && !isObject(previous))throw new Error('Invalid MCP registration');
  const merged={...previous,...entry,env:{...previous?.env,...entry.env}};
  delete merged.url; delete merged.httpUrl;
  data.mcp_servers ||= Object.create(null);
  data.mcp_servers[NAME]=toml.parse(toml.stringify(merged));
  const output=toml.patch(raw || '',data);
  if (!require('node:util').isDeepStrictEqual(toml.parse(output),data))throw new Error('Could not preserve configuration');
  if(output===raw)return;
  fs.mkdirSync(path.dirname(file),{recursive:true,mode:0o700});
  const temp=`${file}.router-${randomUUID()}.tmp`;
  try {
    fs.writeFileSync(temp,output,{flag:'wx',mode:0o600});
    if((await readCodexConfig(file)).raw!==raw)throw new Error('Configuration changed. Please retry.');
    if(raw!==null)fs.writeFileSync(`${file}.mcp-router-backup-${randomUUID()}`,raw,{flag:'wx',mode:0o600});
    fs.renameSync(temp,file);
  } finally {if(fs.existsSync(temp))fs.unlinkSync(temp);}
}
function matches(actual, expected) {
  return isObject(actual) && (!actual.type || actual.type==='stdio') && actual.command===expected.command && JSON.stringify(actual.args)===JSON.stringify(expected.args) && Object.entries(expected.env).every(([k,v])=>(k==='ROUTER_SOCKET' && typeof actual.env?.[k]==='string' ? currentSocket(actual.env[k]) : actual.env?.[k])===v);
}
function createIntegrations({home,appData,executable,script,socket,run,getWindowsPackageRoots,codexHome=process.env.CODEX_HOME || path.join(home,'.codex'),platform=process.platform,localAppData=process.env.LOCALAPPDATA || path.join(home,'AppData/Local'),programFiles=process.env.ProgramFiles || 'C:/Program Files',applicationsDirs=['/Applications',path.join(home,'Applications')],binaryDirs=[path.join(home,'.local/bin'),'/opt/homebrew/bin','/usr/local/bin',...(process.env.PATH||'').split(path.delimiter).filter(Boolean)]}) {
  const entry={command:executable,args:[script],env:{ELECTRON_RUN_AS_NODE:'1',ROUTER_SOCKET:socket}};
  const first=paths=>paths.find(p=>fs.existsSync(p));
  const windows = platform === 'win32';
  const windowsApps = {
    Claude:[path.join(localAppData,'AnthropicClaude/claude.exe'),path.join(localAppData,'Programs/Claude/Claude.exe')],
    Cursor:[path.join(localAppData,'Programs/cursor/Cursor.exe'),path.join(programFiles,'cursor/Cursor.exe')],
    'Visual Studio Code':[path.join(localAppData,'Programs/Microsoft VS Code/Code.exe'),path.join(programFiles,'Microsoft VS Code/Code.exe')]
  };
  const appPath=name=>first(windows ? windowsApps[name] || [] : applicationsDirs.map(dir=>path.join(dir,name+'.app')));
  const dirs = windows ? [...binaryDirs,path.join(appData,'npm'),path.join(home,'.local/bin')] : binaryDirs;
  const binary=name=>first(dirs.flatMap(dir=>(windows?['.exe','.cmd','']:['']).map(ext=>path.join(dir,name+ext))));
  let packageRoots = [], packageRefresh = null, packageCheckedAt = 0;
  async function refreshWindowsPackages() {
    if (!windows || Date.now() - packageCheckedAt < 30000) return;
    if (packageRefresh) return packageRefresh;
    packageRefresh = (async () => {
      try {
        const roots = getWindowsPackageRoots ? await getWindowsPackageRoots() : JSON.parse((await run(
          path.join(process.env.SystemRoot || 'C:/Windows','System32/WindowsPowerShell/v1.0/powershell.exe'),
          ['-NoProfile','-NonInteractive','-Command', '[Console]::OutputEncoding = [System.Text.UTF8Encoding]::new(); $roots = @(Get-AppxPackage -Name OpenAI.Codex; Get-AppxPackage -Name OpenAI.ChatGPT) | Select-Object -ExpandProperty InstallLocation; ConvertTo-Json -Compress -InputObject @($roots)'],
          {timeout:30000,windowsHide:true}
        )).stdout.replace(/^\uFEFF/, ''));
        packageRoots = Array.isArray(roots) ? roots.filter(root=>typeof root==='string' && path.isAbsolute(root)) : [];
      } catch { packageRoots = []; }
      packageCheckedAt = Date.now();
    })();
    try { await packageRefresh; } finally { packageRefresh = null; }
  }
  function discover() {
    const codexApp=appPath('Codex')||appPath('ChatGPT');
    const codexBinary = binary('codex');
    const codexScript = windows && first(dirs.map(dir=>path.join(dir,'node_modules/@openai/codex/bin/codex.js')));
    const bundledCodex = windows && first(packageRoots.map(root=>path.join(root,'app/resources/codex.exe')));
    const codex = windows ? (bundledCodex || (codexBinary?.toLowerCase().endsWith('.exe') ? codexBinary : codexScript ? executable : null)) : first([...(codexApp?[path.join(codexApp,'Contents/Resources/codex')]:[]),...(codexBinary?[codexBinary]:[])]);
    const commandArgs = windows && codex === executable && codexScript ? [codexScript] : [];
    return [
      {id:'codex',name:'ChatGPT/Codex',command:codex,commandArgs,codexConfig:bundledCodex?path.join(codexHome,'config.toml'):null,installed:!!codex,download:'https://openai.com/codex/',hint:'Reload MCP connections or start a new Codex task.'},
      {id:'claude-desktop',name:'Claude Desktop',installed:!!appPath('Claude'),file:path.join(appData,'Claude/claude_desktop_config.json'),download:'https://claude.ai/download',hint:'Restart Claude Desktop to load the connection.'},
      {id:'claude-code',name:'Claude Code',installed:!!binary('claude'),file:path.join(home,'.claude.json'),download:'https://code.claude.com/docs/en/setup',hint:'Start a new Claude Code session. Project-specific overrides still apply.'},
      {id:'cursor',name:'Cursor',installed:!!appPath('Cursor'),file:path.join(home,'.cursor/mcp.json'),comments:true,download:'https://cursor.com/download',hint:'Enable the server in Cursor Settings → Tools & MCP. Project overrides still apply.'},
      {id:'vscode',name:'VS Code / Copilot',installed:!!appPath('Visual Studio Code'),file:path.join(appData,'Code/User/mcp.json'),key:'servers',comments:true,download:'https://code.visualstudio.com/download',hint:'Added to the default VS Code profile. Use MCP: List Servers to start and trust it. Other profiles need their own configuration.'},
      {id:'gemini',name:'Gemini CLI',installed:!!binary('gemini'),file:path.join(home,'.gemini/settings.json'),comments:true,download:'https://geminicli.com/docs/get-started/installation/',hint:'Start a new Gemini CLI session in a trusted folder. Existing tool restrictions still apply.'}
    ];
  }
  async function status(c) {
    const base={id:c.id,name:c.name,installed:c.installed,hint:c.hint};
    if(!c.installed) return {...base,state:'not-installed'};
    try {
      let existing, enabled=true;
      if(c.codexConfig) {
        existing=(await readCodexConfig(c.codexConfig)).data.mcp_servers?.[NAME];
        enabled=existing?.enabled!==false;
      } else if(c.id==='codex') {
        try {const {stdout}=await run(c.command,[...(c.commandArgs||[]),'mcp','get',NAME,'--json'],{timeout:10000,cwd:home,env:{...process.env,ELECTRON_RUN_AS_NODE:'1'},windowsHide:true});const d=JSON.parse(stdout);existing=d.transport;enabled=d.enabled!==false;}
        catch(e) { if(/No MCP server named|not found/i.test(e.stderr || ''))return {...base,state:'not-connected'};throw e; }
      } else existing=readConfig(c.file,c.key,c.comments).data[c.key||'mcpServers']?.[NAME];
      return {...base,state:!existing?'not-connected':matches(existing,entry)&&enabled?'configured':'needs-reconnect'};
    } catch {return {...base,state:'error',error:'Cannot read this app’s configuration. Check its settings before reconnecting.'};}
  }
  async function connect(id) {
    await refreshWindowsPackages();
    const c=discover().find(c=>c.id===id);
    if(!c) return {ok:false,error:'Unknown app'};
    if(!c.installed)return {ok:false,error:`Install ${c.name} first, then try again.`};
    try {
      if(c.codexConfig)await writeCodexRegistration(c.codexConfig,entry);
      else if(id==='codex')await run(c.command,[...(c.commandArgs||[]),'mcp','add',NAME,'--env','ELECTRON_RUN_AS_NODE=1','--env',`ROUTER_SOCKET=${socket}`,'--',executable,script],{timeout:15000,cwd:home,env:{...process.env,ELECTRON_RUN_AS_NODE:'1'},windowsHide:true});
      else writeRegistration(c.file,['claude-code','cursor','vscode'].includes(id)?{type:'stdio',...entry}:entry,c.key,c.comments);
      const result=await status(c);
      if(result.state!=='configured')throw new Error('Registration verification failed');
      return {ok:true,message:`${c.name} configured. ${c.hint}`};
    } catch {return {ok:false,error:`Could not configure ${c.name}. Check that its configuration is valid and writable, then retry.`};}
  }
  function migrateLegacy() {
    for (const c of discover()) {
      if (c.id === 'codex') continue;
      if (!c.file || !fs.existsSync(c.file)) continue;
      const key=c.key||'mcpServers', {raw,data}=readConfig(c.file,key,c.comments);
      if (!data[key]?.[LEGACY_NAME]) continue;
      if (data[key][NAME]) throw new Error('Both legacy and current router registrations exist; resolve the duplicate first');
      const old=data[key][LEGACY_NAME];
      const moved={...old,env:{...old.env,ROUTER_SOCKET:currentSocket(old.env?.ROUTER_SOCKET||socket)}};
      let output;
      if (c.comments) {
        output=jsonc.applyEdits(raw,jsonc.modify(raw,[key,NAME],moved,{formattingOptions:{insertSpaces:true,tabSize:2}}));
        output=jsonc.applyEdits(output,jsonc.modify(output,[key,LEGACY_NAME],undefined,{}));
      } else {data[key][NAME]=moved;delete data[key][LEGACY_NAME];output=JSON.stringify(data,null,2)+'\n';}
      replaceConfig(c.file,raw,output);
    }
    const file=path.join(home,'.codex/config.toml');
    if (fs.existsSync(file)) {
      const raw=fs.readFileSync(file,'utf8');
      const oldHeader=/^(\s*\[mcp_servers\.)(?:webflow_router_poc|"webflow_router_poc"|'webflow_router_poc')(?=[.\]])/gm;
      if (oldHeader.test(raw)) {
        if (/^\s*\[mcp_servers\.(?:mcp_router_for_webflow|"mcp_router_for_webflow"|'mcp_router_for_webflow')(?=[.\]])/m.test(raw)) throw new Error('Both legacy and current router registrations exist');
        const output=raw.replace(oldHeader,'$1mcp_router_for_webflow').replace(/(\/Application Support\/)WebflowRouter(\/router\/router\.sock)/g,'$1MCPRouter$2');
        replaceConfig(file,raw,output);
      }
    }
  }
  return {migrateLegacy,status:async()=>{await refreshWindowsPackages();return Promise.all(discover().map(status));},connect, download:id=>discover().find(c=>c.id===id)?.download, configuration:(format='standard')=>{
    if(!['standard','vscode','agent'].includes(format))throw new Error('Unknown format');
    const config=JSON.stringify({[format==='vscode'?'servers':'mcpServers']:{[NAME]:{type:'stdio',...entry}}},null,2);
    if(format!=='agent')return config;
    return `Help me connect this AI app to my local MCP Router for Webflow using the stdio server configuration below. If you cannot identify which app to configure, ask me first.

Adapt this standard MCP JSON to the app's supported configuration format. Preserve the command, arguments, and environment values exactly. Merge the server into the existing settings, preserving other servers, settings, and any existing trust or tool restrictions. Back up an existing configuration before editing it. If you cannot edit the settings, give me the exact steps instead.

MCP Router must be running on this computer. Tell me whether I need to reload or restart the AI app and complete any trust prompt. Verify the connection if possible; otherwise explain what remains to be checked. Do not change project permissions or OAuth authorizations.

\`\`\`json
${config}
\`\`\``;
  }};
}
module.exports={createIntegrations,writeRegistration,matches,readConfig,NAME};
