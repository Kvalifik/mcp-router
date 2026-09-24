import { SettingsMenu, ActionMenu } from './settings-menu.jsx';
import React, { useEffect, useState, useRef } from 'react';
import { createRoot } from 'react-dom/client';
import { TestTubeDiagonal, Maximize2, Plus, RotateCcw, Ellipsis, Pencil, Trash2, RefreshCw, Check, Monitor, Terminal, ChevronDown, Settings2, Paintbrush, ArrowUpRight, LoaderCircle, Copy, Sparkles, Pin, GripVertical, ArrowUp, ArrowDown, Server, TriangleAlert, ArrowDownUp, ShieldCheck, Activity, AppWindow, MessageSquare, Code2, Info, FileText } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { ClearableInput as Input } from '@/components/ui/clearable-input';
import { Badge } from '@/components/ui/badge';
import { Tooltip, TooltipTrigger, TooltipContent } from '@/components/ui/tooltip';
import { Switch } from '@/components/ui/switch';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from '@/components/ui/dialog';
import { toast } from 'sonner';
import { Toaster } from '@/components/ui/sonner';
import { Accordion, AccordionItem, AccordionTrigger, AccordionContent } from '@/components/ui/accordion';
import { Table, TableHeader, TableBody, TableRow, TableHead, TableCell } from '@/components/ui/table';
import { Label } from '@/components/ui/label';
import { ThemeProvider, useTheme } from './theme';
import './style.css';
import { projectAuthorized } from './channel-access.js';
import { presetGrants, accessLabel } from './permission-presets.js';
import { permissionUnavailable, availablePreset, connectionTestUnavailable } from './permission-availability.js';
import appPackage from '../package.json';
import kvalifikLogo from '../assets/brand/kvalifik.svg';

// Measure before React moves keyed rows, then animate from their previous positions.
class AnimatedProjectList extends React.Component {
  list = React.createRef();
  animations = [];

  stopAnimations = () => {
    this.animations.forEach(animation => animation.cancel());
    this.animations = [];
  };

  getSnapshotBeforeUpdate(previous) {
    const before = previous.ids;
    const after = this.props.ids;
    if (before.length !== after.length || before.some(id => !after.includes(id)) ||
        before.every((id, index) => id === after[index])) return null;
    return new Map(Array.from(this.list.current.children, row =>
      [row.dataset.projectId, row.getBoundingClientRect().top]));
  }

  componentDidUpdate(previous, state, positions) {
    if (!positions) {
      if (previous.ids.length !== this.props.ids.length ||
          previous.ids.some(id => !this.props.ids.includes(id))) this.stopAnimations();
      return;
    }
    this.stopAnimations();
    if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) return;
    const moves = Array.from(this.list.current.children, row => ({
      row, delta: positions.get(row.dataset.projectId) - row.getBoundingClientRect().top,
    }));
    this.animations = moves.filter(({ delta }) => Number.isFinite(delta) && Math.abs(delta) > 1)
      .map(({ row, delta }) => row.animate([
        { transform: `translateY(${delta}px)` },
        { transform: 'translateY(0)' },
      ], { duration: 320, easing: 'cubic-bezier(0.2, 0, 0, 1)' }));
  }

  componentWillUnmount() { this.stopAnimations(); }

  render() {
    return <div ref={this.list} aria-label={this.props.label} className="project-list border-t">{this.props.children}</div>;
  }
}

function PublisherLink({ className = '', large = false, children }) {
  return <a href="https://kvalifik.dk" target="_blank" rel="noopener noreferrer" className={`inline-flex items-center gap-1 rounded-sm underline-offset-4 hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring ${className}`} onClick={async event => {
    if (!window.routerDesktop) return;
    event.preventDefault();
    try { await window.routerDesktop.openPublisher(); } catch { toast.error('Could not open kvalifik.dk.'); }
  }}>{children || <><img src={kvalifikLogo} alt="Kvalifik" className={`${large ? 'h-5' : 'h-[0.8em]'} w-auto dark:invert`} /><ArrowUpRight className="size-3.5" aria-hidden="true" /></>}</a>;
}
async function checkForUpdates(manual=false) {
  if (!window.routerDesktop?.checkUpdates) return;
  if(manual)toast.loading('Checking for updates…',{id:'app-update'});
  const result=await window.routerDesktop.checkUpdates().catch(()=>({state:'error'}));
  if(result.state==='available') {
    toast.info(`Version ${result.version} is available`,{id:'app-update',duration:Infinity,description:'Download and replace the app to update.',action:{label:'Download update',onClick:()=>window.routerDesktop.downloadUpdate().catch(()=>toast.error('Could not open the download page.'))}});
  } else if(manual) {
    const message={current:'You’re using the latest version.','no-release':'No public release is available yet.',unconfigured:'Update checks will be available when the GitHub release repository is set.',error:'Could not check for updates. Try again later.'}[result.state];
    const description=result.state==='error'?{timeout:'GitHub took too long to respond. Check your connection and try again.',network:'Could not connect to GitHub. Check your connection, VPN, or firewall.', 'rate-limit':'GitHub’s request limit has been reached. Try again later.',server:'GitHub could not complete the request. Try again later.','invalid-response':'GitHub returned an unreadable response. Try again later.'}[result.reason]:undefined;
    toast[result.state==='error'?'error':'info'](message,{id:'app-update',description});
  }
}
function AboutPanel() {
  return <div className="space-y-6">
    <div className="flex items-center gap-4 rounded-lg border bg-background p-5">
      <div><p className="text-xs text-muted-foreground">Created by</p><PublisherLink large className="mt-2" /></div>
    </div>
    <div className="space-y-2 text-sm"><p>Connect multiple Webflow workspaces to your AI tools through one MCP connection.</p><p className="text-muted-foreground">Independent software by <PublisherLink>Kvalifik ApS</PublisherLink>. Not affiliated with or endorsed by Webflow or connected AI providers.</p></div>
    <Button variant="outline" className="w-full justify-between" onClick={async () => { try { await window.routerDesktop.openLicenses(); } catch { toast.error('Could not open third-party licenses.'); } }} disabled={!window.routerDesktop}><span className="flex items-center gap-2"><FileText className="size-4" />Third-party licenses</span><ArrowUpRight className="size-4" /></Button>
    <Button variant="outline" className="w-full" disabled={!window.routerDesktop} onClick={()=>checkForUpdates(true)}><RefreshCw className="size-4" />Check for updates</Button>
    <p className="text-xs text-muted-foreground">Version {appPackage.version} · © {new Date().getFullYear()} <PublisherLink>Kvalifik ApS</PublisherLink></p>
  </div>;
}
const MODES = ['read', 'write', 'delete', 'publish'];
function IconButton({ label, icon: Icon, onClick, disabled }) {
  return <Button variant="ghost" size="icon" title={label} aria-label={label} onClick={onClick} disabled={disabled}><Icon className="size-4" /></Button>;
}
function Toggle({ label, detail, checked, onChange, disabled }) {
  return <Label className="flex items-center justify-between gap-6 py-2"><span><span className="block text-sm font-medium">{label}</span>{detail && <span className="mt-1 block text-xs text-muted-foreground">{detail}</span>}</span><Switch aria-label={label} checked={checked} onCheckedChange={onChange} disabled={disabled} /></Label>;
}
function AccessBadge({ project, connection, permissionKeys, onClick }) {
  const access = accessLabel(permissionKeys, project.permissions || {});
  return <Badge asChild variant="secondary" className="project-access-badge hover:bg-accent hover:text-accent-foreground"><button type="button" onClick={onClick} title="Edit project permissions" aria-label={`${access} — settings for ${project.name}`}>{project.available === false ? 'Unavailable' : !connection.enabled ? 'Connection off' : !project.enabled ? 'Disabled' : access}</button></Badge>;
}
function BetaBadge({ project, connection, onClick }) {
  const missing = !projectAuthorized(connection, 'beta', project.siteId);
  return <Tooltip>
    <TooltipTrigger asChild>
      <Badge asChild variant="outline" className={`project-beta-badge ${missing ? 'border-amber-500/50 text-amber-700 dark:text-amber-400' : ''}`}>
        <button type="button" aria-label={missing ? `β Beta access missing for ${project.name}. Open settings to authorize.` : `β Beta settings for ${project.name}`} onClick={onClick}>
          {missing ? <TriangleAlert className="size-3" /> : <span className="compact-window-only text-sm leading-none" aria-hidden="true">β</span>}<span className="full-window-only">β Beta</span>
        </button>
      </Badge>
    </TooltipTrigger>
    <TooltipContent side="top" collisionPadding={{ top: 72, right: 12, bottom: 12, left: 12 }}>
      {missing ? 'This project isn’t included in the current β Beta authorization. Click to open settings and authorize access.' : 'Using β Beta MCP. Click to edit project settings.'}
    </TooltipContent>
  </Tooltip>;
}
function ProjectLinks({project}) {
  const slug=project.shortName;
  if(!slug)return null;
  const open=destination=>async e=>{
    if(!window.routerDesktop)return;
    e.preventDefault();
    try { await window.routerDesktop.openProject(slug,destination); }
    catch { toast.error('Could not open the project link.'); }
  };
  return <div className="project-links flex shrink-0 items-center gap-0 text-xs text-muted-foreground">
    <Button asChild variant="ghost" size="icon-xs" className="project-site-link shrink-0 text-muted-foreground"><a href={`https://${slug}.webflow.io/`} target="_blank" rel="noopener noreferrer" title={`${slug}.webflow.io`} aria-label={`Open ${project.name} site (${slug}.webflow.io)`} onClick={open('site')}><span className="full-window-only truncate">{slug}.webflow.io</span><ArrowUpRight className="size-3.5" aria-hidden="true" /></a></Button>
    <Button asChild variant="ghost" size="icon-xs" className="shrink-0 text-muted-foreground"><a href={`https://webflow.com/design/${encodeURIComponent(slug)}`} target="_blank" rel="noopener noreferrer" title="Open in Designer" aria-label={`Open ${project.name} in Designer`} onClick={open('designer')}><Paintbrush className="size-3.5" /></a></Button>
  </div>;
}
function PermissionToggle({label,checked,reason,busy,onChange}) {
  if(!reason)return <Switch aria-label={label} checked={checked} disabled={busy} onCheckedChange={onChange} />;
  const explanation=`${reason} This permission is unavailable; your saved preference is kept.`;
  return <Tooltip><TooltipTrigger asChild>
    <span tabIndex={0} role="group" aria-label={`${label}: unavailable. ${explanation}`} className="inline-flex cursor-not-allowed rounded-full outline-none focus-visible:ring-2 focus-visible:ring-ring">
      <Switch aria-label={label} checked={false} disabled className="pointer-events-none" />
    </span>
  </TooltipTrigger><TooltipContent side="top" className="z-[70]">{explanation}</TooltipContent></Tooltip>;
}
function PermissionForm({ model, data, busy, perform, close, connect, refresh }) {
  const defaults = model.type === 'defaults';
  const item = model.item || {};
  const [name,setName] = useState(item.name || '');
  const [channel,setChannel]=useState(item.channel || 'inherit');
  const [requestedChannel,setRequestedChannel]=useState(null);
  const [authorizing,setAuthorizing]=useState(false);
  const [testing,setTesting]=useState(false);
  const connection=data.connections.find(c=>c.id===item.connectionId);
  const defaultChannelLabel=`Default (Currently ${connection?.channel==='beta'?'β Beta':'Stable'})`;
  const selectedChannel=channel==='inherit'?(connection?.channel||'stable'):channel;
  const hasAccess=endpoint=>projectAuthorized(connection,endpoint,item.siteId);
  const requestedEndpoint=requestedChannel==='inherit'?(connection?.channel||'stable'):requestedChannel;
  function selectChannel(value) {
    const endpoint=value==='inherit'?(connection?.channel||'stable'):value;
    if(hasAccess(endpoint)){setChannel(value);setRequestedChannel(null);setAuthorizing(false);}
    else {setRequestedChannel(value);setAuthorizing(false);}
  }
  useEffect(()=>{
    if(requestedChannel===null)return;
    const state=connection?.channels?.[requestedEndpoint];
    if(!hasAccess(requestedEndpoint)){
      if(authorizing&&state?.authorized&&!state.inventoryPending&&state.status==='connected'){setAuthorizing(false);toast.error(`Webflow did not authorize ${item.name}. Try again and include this project.`);}
      return;
    }
    setChannel(requestedChannel);setRequestedChannel(null);setAuthorizing(false);
    toast.success(`${requestedEndpoint==='beta'?'β Beta':'Stable'} authorized. Save changes to use it for this project.`);
  },[requestedChannel,requestedEndpoint,connection?.channels?.[requestedEndpoint]?.authorized,connection?.channels?.[requestedEndpoint]?.inventoryPending,JSON.stringify(connection?.channels?.[requestedEndpoint]?.siteIds)]);
  useEffect(()=>{
    if(!authorizing)return;
    let active=true,running=false;
    const check=async()=>{if(running||!active)return;running=true;try{await refresh();}catch{}finally{running=false;}};
    const timer=setInterval(check,2000);window.addEventListener('focus',check);
    return()=>{active=false;clearInterval(timer);window.removeEventListener('focus',check);};
  },[authorizing]);
  async function authorizeRequested() {
    try {await connect(item.connectionId,requestedEndpoint);setAuthorizing(true);toast.info('Complete authorization in your browser. Your project settings will stay open.');}
    catch(e){setAuthorizing(false);toast.error(e.message);}
  }

  const [useDefault,setUseDefault] = useState(false);
  const testUnavailable = defaults ? null : connectionTestUnavailable(item, connection, selectedChannel);
  const [editingName,setEditingName] = useState(false);
  const [grants, setGrants] = useState(defaults ? data.settings.defaultPermissions : item.permissions || {});
  const [query, setQuery] = useState('');
  const keys = data.permissionGroups.flatMap(g => g.modes.map(m => `${g.area}:${m}`));
  const groups = data.permissionGroups.filter(g => g.title.toLowerCase().includes(query.toLowerCase()));
  const unavailable = key => permissionUnavailable({connection, channel:selectedChannel, siteId:item.siteId, key, defaults});
  const hasUnavailable = keys.some(key=>unavailable(key));
  const preset = type => setGrants(current=>availablePreset(current,presetGrants(keys, type),unavailable));
  async function submit(e) {
    e.preventDefault();
    if(requestedChannel!==null){toast.error('Complete or cancel authorization before saving.');return;}
    if(!defaults&&channel!==(item.channel||'inherit')&&!hasAccess(selectedChannel)){selectChannel(channel);return;}
    try {
      await perform(defaults ? '/api/settings/default-permissions' : `/api/projects/${item.id}/edit`, defaults ? { permissions:grants } : { permissions:grants, channel, ...(useDefault ? {useDefaultName:true} : name !== item.name ? {name} : {}) });
      toast.success(defaults ? 'Default permissions saved.' : 'Project settings saved.');
      close();
    } catch(e) { toast.error(e.message); }
  }
  return <form className="dialog-form" onSubmit={submit}>
    {!defaults && <DialogHeader className="flex-row shrink-0 items-center gap-1 space-y-0 pr-6 text-left">
      {editingName ? <><DialogTitle className="sr-only">{name || item.name}</DialogTitle><Input className="min-w-0 flex-1" aria-label="Project name" value={name} onClear={()=>{setName('');setUseDefault(false);}} onChange={e=>{setName(e.target.value);setUseDefault(false);}} maxLength={80} autoFocus onKeyDown={e=>{if(e.key==='Enter'){e.preventDefault();if(name.trim())setEditingName(false);}if(e.key==='Escape'){e.preventDefault();e.stopPropagation();setName(item.name);setUseDefault(false);setEditingName(false);}}} /><Button type="button" variant="ghost" size="icon" title={`Use Webflow name (${item.sourceName || item.name})`} aria-label={`Use Webflow name (${item.sourceName || item.name})`} onClick={()=>{setName(item.sourceName || item.name);setUseDefault(true);}}><RotateCcw className="size-4" /></Button><Button type="button" variant="ghost" size="icon" title="Done editing name" aria-label="Done editing name" disabled={!name.trim()} onClick={()=>setEditingName(false)}><Check className="size-4" /></Button></> : <><DialogTitle className="min-w-0 truncate" title={name}>{name}</DialogTitle><Button type="button" variant="ghost" size="icon" title="Rename project" aria-label="Rename project" onClick={()=>setEditingName(true)}><Pencil className="size-4" /></Button></>}
      <DialogDescription className="sr-only">Edit the project name and permissions.</DialogDescription>
    </DialogHeader>}
    {!defaults&&<div className="flex flex-wrap items-center gap-3"><Label htmlFor="project-mcp-version">MCP version</Label><ActionMenu trigger={<Button id="project-mcp-version" type="button" variant="outline" size="sm" disabled={busy}>{channel==='inherit'?defaultChannelLabel:channel==='beta'?'β Beta':'Stable'}<ChevronDown className="size-3.5" /></Button>} items={[['inherit',defaultChannelLabel],['stable','Stable'],['beta','β Beta']].map(([value,label])=>({id:value,label:label+(!hasAccess(value==='inherit'?(connection?.channel||'stable'):value)?' — Authorize':''),checked:channel===value,onSelect:()=>selectChannel(value)}))} /></div>}
    {!defaults&&requestedChannel!==null&&<div role="status" className="rounded-md border bg-background p-3 space-y-2"><p className="text-sm font-medium">{authorizing?'Waiting for authorization…':`Authorize ${requestedEndpoint==='beta'?'β Beta':'Stable'} for ${item.name}`}</p><p className="text-xs text-muted-foreground">{authorizing?'Complete the Webflow prompt in your browser, then return here. Your edits are kept.':'Select this project in Webflow’s authorization screen. Include any other projects that should keep access through this connection. Your current version stays unchanged until you save.'}</p><div className="flex gap-2"><Button type="button" size="sm" disabled={busy||!connection} onClick={authorizeRequested}>{authorizing?'Open authorization again':`Authorize ${requestedEndpoint==='beta'?'β Beta':'Stable'}`}</Button><Button type="button" size="sm" variant="ghost" disabled={busy} onClick={()=>{setRequestedChannel(null);setAuthorizing(false);}}>Cancel</Button></div></div>}
    {!defaults&&requestedChannel===null&&!hasAccess(selectedChannel)&&<Button type="button" variant="outline" size="sm" onClick={()=>selectChannel(channel)}>Authorize {selectedChannel==='beta'?'β Beta':'Stable'} for this project</Button>}

    <div className="flex min-h-0 flex-col gap-3">
        <div className="flex shrink-0 items-center gap-2"><Input search className="min-w-0 flex-1" aria-label="Search permissions" placeholder="Search permissions…" value={query} onClear={()=>setQuery('')} onChange={e=>setQuery(e.target.value)} /><ActionMenu trigger={<Button type="button" variant="outline" disabled={busy}>Presets<ChevronDown className="size-4" /></Button>} items={[['all','All permissions'],['no-publishing','No publishing'],['read','Read only'],['none','No permissions']].map(([key,label])=>({id:key,label,onSelect:()=>preset(key)}))} /></div>
        <div className="permission-frame"><Table containerClassName="permission-container" className="permission-table text-xs" aria-label="Permission areas"><TableHeader><TableRow><TableHead className="p-3 text-left">Area</TableHead>{MODES.map(m=><TableHead key={m} className="p-2 text-center capitalize">{m}</TableHead>)}</TableRow></TableHeader><TableBody className="permission-scroll">
          {groups.map(g=><TableRow key={g.area}><TableHead className="p-3 text-left font-medium">{g.title}</TableHead>{MODES.map(m=><TableCell key={m} className="p-2 text-center">{g.modes.includes(m)?<PermissionToggle label={`${g.title}: ${m}`} checked={!!grants[`${g.area}:${m}`]} reason={unavailable(`${g.area}:${m}`)} busy={busy} onChange={value=>setGrants({...grants,[`${g.area}:${m}`]:value})} />:<span className="text-muted-foreground">—</span>}</TableCell>)}</TableRow>)}
          {!groups.length&&<TableRow><TableCell colSpan={5} className="p-5 text-center text-muted-foreground">No matching permission areas.</TableCell></TableRow>}
        </TableBody></Table></div>
        <p className="shrink-0 text-xs text-muted-foreground">Router permissions only limit access already granted by Webflow. Webflow may still reject restricted actions.</p>
        {hasUnavailable&&<p className="shrink-0 text-xs text-muted-foreground">Unavailable permissions are locked off. Hover or focus a locked toggle for details. Saved preferences are kept for when access is restored.</p>}
        <p className="shrink-0 text-xs text-muted-foreground">{defaults?'Applies to new projects and disabled projects still using defaults. New projects always start disabled.':'Changes require Instructions → Read. Canvas editing also requires Custom code → Write. Delete and publish are separate permissions.'}</p>
    </div>
    {!defaults&&testUnavailable&&<p id="connection-test-unavailable" className="shrink-0 text-xs text-muted-foreground">{testUnavailable}</p>}
    <DialogFooter className="shrink-0 border-t pt-4">{!defaults && <Button type="button" variant="outline" size="icon" aria-label={testing?'Testing connection…':'Test connection'} aria-busy={testing} title={testing?'Testing connection…':testUnavailable || 'Test connection using saved permissions'} disabled={busy || testing || !!testUnavailable} aria-describedby={testUnavailable?'connection-test-unavailable':undefined} onClick={async()=>{if(testing)return;setTesting(true);try{await perform('/api/read-project',{projectId:item.id});toast.success(`${item.name}: read succeeded.`);}catch(e){toast.error(e.message);}finally{setTesting(false);}}}>{testing?<LoaderCircle className="size-4 animate-spin" aria-hidden="true" />:<TestTubeDiagonal className="size-4" aria-hidden="true" />}</Button>}<Button type="button" variant="outline" disabled={busy} onClick={close}>Cancel</Button><Button disabled={busy || requestedChannel!==null || !defaults && !name.trim()}>{busy?'Saving…':'Save changes'}</Button></DialogFooter>
  </form>;
}
function ClientConnections() {
  const [clients,setClients] = useState([]), [pending,setPending] = useState(null);
  useEffect(()=>{if(!window.routerDesktop)return;let alive=true;const refresh=()=>window.routerDesktop.clientStatus().then(result=>{if(alive)setClients(result);}).catch(()=>{});refresh();window.addEventListener('focus',refresh);const timer=setInterval(refresh,30000);return()=>{alive=false;clearInterval(timer);window.removeEventListener('focus',refresh);};},[]);
  if(!window.routerDesktop)return null;
  const icon=id=>id==='codex'||id==='claude-desktop'?'MessageSquare':id==='cursor'||id==='vscode'?'Code2':'Terminal';
  async function connect(client) {
    if(pending)return;
    setPending(client.id);const notice=toast.loading(`Connecting ${client.name}…`);
    try {const result=await window.routerDesktop.connectClient(client.id);if(!result.ok)throw new Error(result.error);toast.success(result.message,{id:notice,duration:10000});setClients(current=>current.map(c=>c.id===client.id?{...c,state:'configured'}:c));}
    catch(e){toast.error(e.message,{id:notice,duration:10000});}finally{setPending(null);}
  }
  const items=[
    ...clients.filter(c=>c.installed).map(c=>({label:c.name,icon:c.state==='configured'?'Check':c.state==='needs-reconnect'?'TriangleAlert':undefined,children:[
      {id:`status-${c.id}`,label:c.state==='configured'?'Connected':c.state==='needs-reconnect'?'Needs reconnecting':'Not connected',disabled:true},
      {separator:true},
      {id:`connect-${c.id}`,label:c.state==='configured'||c.state==='needs-reconnect'?'Reconnect':'Set up',icon:c.state==='configured'||c.state==='needs-reconnect'?'RefreshCw':'Plus',disabled:!!pending,onSelect:()=>connect(c)},
    ]})),
    ...(!clients.some(c=>c.installed)?[{id:'no-installed-apps',label:'No supported apps installed',disabled:true}]:[]),
    ...(clients.some(c=>!c.installed)?[{label:'Not installed',icon:'Plus',children:clients.filter(c=>!c.installed).map(c=>({id:`download-${c.id}`,label:c.name,icon:icon(c.id),onSelect:async()=>{try{await window.routerDesktop.clientDownload(c.id);}catch{toast.error('Could not open the download page.');}}}))}]:[]),
    {separator:true},
    {label:'Copy configuration',icon:'Copy',children:[['standard','Standard MCP'],['vscode','VS Code'],['agent','Agent setup snippet']].map(([format,label])=>({id:`copy-${format}`,label,icon:'Copy',onSelect:async()=>{try{await window.routerDesktop.copyClientConfig(format);toast.success(`${label}${format==='agent'?'':' configuration'} copied to clipboard.`,{duration:6000});}catch{toast.error('Could not copy configuration.',{duration:6000});}}}))},
  ];
  return <ActionMenu items={items} trigger={<Button className="app-client-menu" variant="outline" size="sm" aria-label="App connections" title="Apps" disabled={!!pending}><Sparkles className="size-4" /><span className="full-window-only">Apps</span><ChevronDown className="size-3" aria-hidden="true" /></Button>} />;
}

function ConnectionOrderForm({connections,busy,perform,close}) {
  const [items,setItems]=useState(connections);
  const [dragging,setDragging]=useState(null);
  const drag=useRef(null),list=useRef(null);
  const move=(from,to)=>setItems(current=>{const next=[...current];next.splice(to,0,next.splice(from,1)[0]);return next;});
  function start(e,id) {
    if(busy||e.button!==0)return;
    e.preventDefault();e.currentTarget.setPointerCapture(e.pointerId);
    drag.current={id,pointer:e.pointerId,original:items};setDragging(id);
  }
  function update(e) {
    if(!drag.current||e.pointerId!==drag.current.pointer)return;
    const rows=[...list.current.querySelectorAll('[data-connection-id]')];
    const from=rows.findIndex(row=>row.dataset.connectionId===drag.current.id);
    const to=rows.findIndex((row,index)=>{const r=row.getBoundingClientRect();return index!==from&&e.clientY>=r.top&&e.clientY<=r.bottom&&(index>from?e.clientY>r.top+r.height/2:e.clientY<r.top+r.height/2);});
    if(from>=0&&to>=0)move(from,to);
  }
  function finish(e,cancel=false) {
    if(!drag.current)return;
    if(cancel)setItems(drag.current.original);
    drag.current=null;setDragging(null);
    if(e.currentTarget.hasPointerCapture?.(e.pointerId))e.currentTarget.releasePointerCapture(e.pointerId);
  }
  return <form className="dialog-form" onSubmit={async e=>{e.preventDefault();try{await perform('/api/settings/connection-order',{ids:items.map(c=>c.id)});toast.success('Connection order saved.');close();}catch(e){toast.error(e.message);}}}>
    <div ref={list} className="dialog-scroll space-y-2">{items.map((c,index)=><div key={c.id} data-connection-id={c.id} className={`flex items-center gap-2 rounded-md border p-2 ${dragging===c.id?'border-ring bg-accent shadow-sm':'bg-background'}`}><Button type="button" variant="ghost" size="icon-xs" disabled={busy} className="touch-none select-none cursor-grab active:cursor-grabbing text-muted-foreground" aria-label={`Drag ${c.name} to reorder`} title="Drag to reorder" onPointerDown={e=>start(e,c.id)} onPointerMove={update} onPointerUp={e=>finish(e)} onPointerCancel={e=>finish(e,true)} onLostPointerCapture={e=>finish(e)} onKeyDown={e=>{if(e.key==='ArrowUp'&&index>0){e.preventDefault();move(index,index-1);}if(e.key==='ArrowDown'&&index<items.length-1){e.preventDefault();move(index,index+1);}}}><GripVertical className="size-4 pointer-events-none" /></Button><span className="min-w-0 flex-1 truncate text-sm">{c.name}</span><Button type="button" variant="ghost" size="icon-xs" disabled={busy||index===0} aria-label={`Move ${c.name} up`} onClick={()=>move(index,index-1)}><ArrowUp className="size-4" /></Button><Button type="button" variant="ghost" size="icon-xs" disabled={busy||index===items.length-1} aria-label={`Move ${c.name} down`} onClick={()=>move(index,index+1)}><ArrowDown className="size-4" /></Button></div>)}</div>
    <DialogFooter><Button type="button" variant="outline" disabled={busy} onClick={close}>Cancel</Button><Button disabled={busy||!!dragging}>Save order</Button></DialogFooter>
  </form>;
}
function GrantComparison({connection,onReconnect,busy}) {
  const comparison=connection?.grantComparison;
  if(!comparison)return null;
  const {missingProjects,missingWorkspaceIds}=comparison;
  const mismatch=missingProjects.length||missingWorkspaceIds?.length;
  if(!mismatch)return null;
  return <div className="space-y-2 text-xs"><p className="font-medium text-sm">Stable and β Beta have access to different projects.</p>
    {!!missingProjects.length&&<><p>{missingProjects.length} {missingProjects.length===1?'project available':'projects available'} on Stable {missingProjects.length===1?'is':'are'} not available on β Beta.</p><div className="max-h-24 overflow-auto text-muted-foreground">{missingProjects.map(p=><div key={p.id}>{p.name}</div>)}</div></>}
    {missingWorkspaceIds===null&&<p className="text-muted-foreground">Workspace coverage could not be verified.</p>}
    {!!missingWorkspaceIds?.length&&<p>{missingWorkspaceIds.length} {missingWorkspaceIds.length===1?'workspace represented':'workspaces represented'} on Stable {missingWorkspaceIds.length===1?'has':'have'} no projects in β Beta.</p>}
    <p className="text-muted-foreground">That’s fine if intentional. To use those projects with β Beta, reconnect β Beta and include them.</p><Button type="button" size="sm" variant="outline" disabled={busy||!connection} onClick={onReconnect}>Reconnect β Beta</Button>
  </div>;
}
function NameForm({ model, busy, perform, close }) {
  const item = model.item;
  const [name,setName] = useState(model.suggestedName || item.name);
  const [useDefault,setUseDefault] = useState(false);
  async function submit(e) {
    e.preventDefault();
    try { await perform(`/api/${model.kind}/${item.id}/edit`, useDefault ? {useDefaultName:true} : {name}); toast.success('Display name saved.'); close(true); }
    catch(e) { toast.error(e.message); }
  }
  return <form onSubmit={submit} className="space-y-4">
    <div className="space-y-2"><Label htmlFor="item-name" className="text-sm font-medium">Display name</Label><Input id="item-name" value={name} onClear={()=>{setName('');setUseDefault(false);}} onChange={e => {setName(e.target.value);setUseDefault(false);}} maxLength={80} required /></div>
    {item.sourceName ? <div className="flex items-center justify-between gap-3"><p className="text-xs text-muted-foreground">Webflow name: {item.sourceName}</p><Button type="button" variant="ghost" size="sm" onClick={()=>{setName(item.sourceName);setUseDefault(true);}}>Use default name</Button></div> : <p className="text-xs text-muted-foreground">Webflow hasn’t provided a workspace name. This is a local label.</p>}

    <DialogFooter><Button type="button" variant="outline" disabled={busy} onClick={close}>{model.initialNaming?'Keep current name':'Cancel'}</Button><Button disabled={busy||!name.trim()}>Save changes</Button></DialogFooter>
  </form>;
}
function App() {
  const {theme,setTheme}=useTheme();
  const [toolbarDragging,setToolbarDragging]=useState(false);
  const comparedGrants=useRef(new Map());
  const toolbarPointer=useRef(null);
  function beginToolbarDrag(e) {
    if (!e.currentTarget.contains(e.target) || !window.routerDesktop?.integratedTitleBar || e.button!==0 || e.target.closest('button,a,input') || !document.querySelector('[data-slot="dropdown-menu-content"]')) return;
    toolbarPointer.current=e.pointerId;
    e.currentTarget.setPointerCapture(e.pointerId);
    setToolbarDragging(true);
    window.routerDesktop.toolbarDrag('start');
  }
  function endToolbarDrag() {
    if(toolbarPointer.current===null)return;
    toolbarPointer.current=null;setToolbarDragging(false);window.routerDesktop.toolbarDrag('end');
  }

  const [data,setData] = useState(null), [busy,setBusy] = useState(false), [bootFailed,setBootFailed] = useState(false);
  const [menuBar,setMenuBar]=useState('projects');
  useEffect(()=>{const refresh=()=>window.routerDesktop?.menuBarMode?.().then(setMenuBar).catch(()=>{});refresh();window.addEventListener('focus',refresh);return()=>window.removeEventListener('focus',refresh);},[]);
  const [pinnedOnly,setPinnedOnly]=useState(false);
  const [modal,setModal] = useState(null), [query,setQuery] = useState(''), [expanded,setExpanded] = useState({});
  const mainRef = useRef(null);
  const [focusPopover,setFocusPopover] = useState(false);
  useEffect(()=>window.routerDesktop?.onPopoverOpen?.(()=>setFocusPopover(true)),[]);
  useEffect(()=>{if(!focusPopover||!data)return;const frame=requestAnimationFrame(()=>{if(!modal)mainRef.current?.focus({preventScroll:true});setFocusPopover(false);});return()=>cancelAnimationFrame(frame);},[focusPopover,data,modal]);
  const csrf = useRef(''); const modalRef = useRef(null); modalRef.current = modal;
  async function load() { const response=await fetch('/api/state'); if(!response.ok)throw new Error('Router unavailable');const result=await response.json();csrf.current=result.csrf;setData(result); }
  useEffect(()=>{
    const refresh=()=>{if(!modalRef.current||['channel','permissions'].includes(modalRef.current.type))load().catch(()=>{});};
    window.addEventListener('focus',refresh);
    return()=>window.removeEventListener('focus',refresh);
  },[]);
  useEffect(() => {load().catch(() => {setBootFailed(true);toast.error('Cannot connect to the router. Reopen the app.');});const timer=setInterval(() => {if(!document.hidden&&(!modalRef.current||['channel','permissions'].includes(modalRef.current.type)))load().catch(()=>{});},15000);return()=>clearInterval(timer);},[]);
  async function perform(path,body={}) {setBusy(true);try{const r=await fetch(path,{method:'POST',headers:{'Content-Type':'application/json','X-Router-CSRF':csrf.current},body:JSON.stringify(body)});const result=await r.json();if(!r.ok)throw new Error(result.error);await load();return result;}finally{setBusy(false);}}
  async function action(work,success) {setBusy(true);try{await work();if(success)toast.success(success);}catch(e){toast.error(e.message);}finally{setBusy(false);}}
  useEffect(()=>{
    for(const c of data?.connections||[]){const result=c.grantComparison;if(!result)continue;
      const key=JSON.stringify([c.betaTokenVersion,result]);if(comparedGrants.current.get(c.id)===key)continue;comparedGrants.current.set(c.id,key);
      if(result.missingProjects.length||result.missingWorkspaceIds?.length)toast.info(`${c.name}: β Beta access differs from Stable.`,{id:`beta-grant-${c.id}`,duration:10000,action:{label:'Review',onClick:()=>{if(modalRef.current){toast.info('Save or cancel your project edits, then review Connection access from the connection menu.');}else setModal({type:'channel',item:c});}}});
    }
  },[data]);
  useEffect(()=>{
    if(modal || busy)return;
    const connection=data?.connections.find(c=>c.needsName);
    if(connection)setModal({type:'rename',kind:'connections',item:connection,initialNaming:true,suggestedName:connection.sites.length===1?connection.sites[0].name?.slice(0,80):connection.name});
  },[data,modal,busy]);
  async function closeModal(saved = false) {
    if(busy)return;
    if(modal?.initialNaming && saved !== true){try{await perform(`/api/connections/${modal.item.id}/edit`,{dismissNaming:true});}catch(e){toast.error(e.message);return;}}
    setModal(null);
  }
  async function connect(id,channel) {const r=await perform(`/api/connections/${id}/authorize`,channel?{channel}:{});if(window.routerDesktop)await window.routerDesktop.openOAuth(r.url);else location.assign(r.url);}
  useEffect(()=>{checkForUpdates();const timer=setInterval(()=>checkForUpdates(),6*60*60*1000);return()=>clearInterval(timer);},[]);
  useEffect(() => window.routerDesktop?.onShowAbout(() => { if (modalRef.current && modalRef.current.type !== 'about') { toast.info('Close the current dialog before opening About.'); return; } setModal({type:'about'}); }), []);
  if(!data)return <div className="p-8 text-sm text-muted-foreground">{bootFailed ? <Button variant="outline" onClick={()=>{setBootFailed(false);load().catch(()=>{setBootFailed(true);toast.error('Cannot connect to the router. Reopen the app.');});}}>Retry connection</Button> : 'Opening connections…'}</div>;
  const permissionKeys=data.permissionGroups.flatMap(g=>g.modes.map(m=>`${g.area}:${m}`));
  const titles={connect:'Connect your Webflow projects',about:'About MCP Router',rename:'Rename',permissions:'Project settings',defaults:'Default permissions',delete:'Delete from router',diagnostics:'Diagnostics',order:'Reorder connections',channel:'Connection access'};
  const search=query.trim().toLowerCase();
  const grouped=data.connections.map(c => ({...c,projects:data.projects.filter(p => p.connectionId===c.id).sort((a,b)=>Number(!!b.favourite)-Number(!!a.favourite)||(!a.favourite ? Number(b.enabled)-Number(a.enabled) : 0)||a.name.localeCompare(b.name))})).map(c=>({...c,visible:c.projects.filter(p=>(!pinnedOnly||p.favourite)&&(!search||`${p.name} ${p.sourceName} ${p.shortName} ${c.name}`.toLowerCase().includes(search)))})).filter(c=>pinnedOnly?c.visible.length:!search||c.visible.length||c.name.toLowerCase().includes(search));
  const settingsItems = [
    {label:'Appearance',icon:'SunMoon',children:['system','light','dark'].map(value=>({id:`theme-${value}`,label:value[0].toUpperCase()+value.slice(1),checked:theme===value,onSelect:()=>setTheme(value)}))},
    ...(window.routerDesktop?.titleBarPlatform==='darwin'?[{separator:true},{label:'Menu bar',icon:'PanelTop',children:[['off','Off'],['icon','Icon only'],['connections','Connections'],['projects','Projects'],['both','Connections and projects']].map(([value,label])=>({id:`menu-${value}`,label,checked:menuBar===value,onSelect:()=>action(async()=>setMenuBar(await window.routerDesktop.setMenuBarMode(value)))}))}]:[]),
    {separator:true},
    {label:'Default MCP version',icon:'Server',children:['stable','beta'].map(channel=>({id:`channel-${channel}`,label:channel==='beta'?'β Beta':'Stable',checked:(data.settings.defaultChannel||'stable')===channel,onSelect:()=>action(()=>perform('/api/settings/default-channel',{channel}),'Default MCP version updated.')}))},
    {separator:true},
    ...[['order','Reorder connections'],['defaults','Default permissions'],['diagnostics','Diagnostics']].map(([type,label])=>({id:type,label,icon:{order:'ArrowDownUp',defaults:'ShieldCheck',diagnostics:'Activity'}[type],onSelect:()=>setModal({type})})),
    {separator:true},
    ...(window.routerDesktop?[{id:'updates',icon:'RefreshCw',label:'Check for updates',onSelect:()=>checkForUpdates(true)}]:[]),
    {id:'about',icon:'Info',label:'About MCP Router',onSelect:()=>setModal({type:'about'})},
  ];
  const filterActive=!!search||pinnedOnly;
  return <main ref={mainRef} tabIndex={-1} className="router-main">
    <header data-dragging={toolbarDragging} onPointerDown={beginToolbarDrag} onPointerMove={()=>{if(toolbarPointer.current!==null)window.routerDesktop.toolbarDrag('move');}} onPointerUp={endToolbarDrag} onPointerCancel={endToolbarDrag} onLostPointerCapture={endToolbarDrag} className={`app-header ${window.routerDesktop?.integratedTitleBar ? `app-header-integrated ${window.routerDesktop.titleBarPlatform === 'win32' ? 'app-header-windows' : 'app-header-mac'}` : ''}`}><div className="min-w-0"><div className="flex flex-wrap items-baseline gap-x-2"><h1 className="text-base font-semibold">MCP Router</h1><span className="full-window-only inline-flex items-baseline gap-1 text-sm"><span className="text-muted-foreground">by</span><PublisherLink className="font-semibold" /></span></div><p className="text-xs text-muted-foreground">{data.connections.length} connections · {data.projects.length} projects</p></div><div className="app-header-actions"><ClientConnections /><SettingsMenu disabled={busy} items={settingsItems} />{window.routerDesktop?.openMainWindow&&<Button className="compact-window-only" variant="outline" size="icon" aria-label="Open main window" title="Open main window" onClick={()=>window.routerDesktop.openMainWindow()}><Maximize2 className="size-4" /></Button>}</div></header>
    <div className="router-toolbar flex flex-wrap items-center justify-between gap-2 py-4"><div className="flex min-w-0 flex-1 items-center gap-2"><div className="min-w-40 flex-1 max-w-xs"><Input search placeholder="Search projects…" aria-label="Search projects" value={query} onClear={()=>setQuery('')} onChange={e=>setQuery(e.target.value)} /></div><Button size="icon" aria-label="Show pinned projects" title="Show pinned projects" variant={pinnedOnly?'secondary':'outline'} aria-pressed={pinnedOnly} onClick={()=>setPinnedOnly(value=>!value)}><Pin className={`size-4 ${pinnedOnly?'fill-current':''}`} /></Button></div><Button variant="outline" size="icon" disabled={busy} aria-label="Add connection" title="Add connection" onClick={()=>setModal({type:'connect'})}><Plus className="size-4" /></Button></div>
    <Accordion type="multiple" className="space-y-3" aria-label="Connections and projects" value={grouped.filter(c=>expanded[`${filterActive ? `filter:${search}:${pinnedOnly}:` : ''}${c.id}`]??filterActive).map(c=>c.id)} onValueChange={ids=>setExpanded(prev=>({...prev,...Object.fromEntries(grouped.map(c=>[`${filterActive ? `filter:${search}:${pinnedOnly}:` : ''}${c.id}`,ids.includes(c.id)]))}))}>
      {!grouped.length && <p className="rounded-lg border bg-background p-5 text-sm text-muted-foreground">{pinnedOnly?'No pinned projects match. Pin a project to add it here.':search?'No matching projects or connections.':'Add a connection to discover its projects.'}</p>}
      {grouped.map(c=>{const expandKey=`${filterActive ? `filter:${search}:${pinnedOnly}:` : ''}${c.id}`;const open=expanded[expandKey]??filterActive;return <AccordionItem key={c.id} value={c.id} className="overflow-hidden rounded-lg border bg-background last:border-b">
        <div className="flex flex-wrap items-center gap-2 p-3">
          <AccordionTrigger headerClassName="min-w-0 flex-1" className="items-center p-1 text-left hover:no-underline" aria-label={`${open?'Collapse':'Expand'} ${c.name}`} ><span className="min-w-0"><span className="block truncate text-sm font-semibold">{c.name}</span><span className="mt-1 block text-xs text-muted-foreground">{c.projects.length} projects · {c.projects.filter(p=>p.enabled&&p.available!==false).length} enabled{!c.enabled?' · Connection off':c.lastError?' · Check failed':''}</span></span></AccordionTrigger>
          <div className="flex shrink-0 items-center gap-1">

            {c.enabled&&!c.tokenFingerprint&&<Button size="sm" disabled={busy} onClick={()=>action(()=>connect(c.id),'Complete OAuth in your browser.')}>Connect OAuth</Button>}
            {c.enabled&&c.tokenFingerprint&&<IconButton label={`Sync ${c.name}`} icon={RefreshCw} disabled={busy} onClick={()=>action(()=>perform(`/api/connections/${c.id}/check`),`${c.name}: projects updated.`)} />}
            <ActionMenu trigger={<Button variant="ghost" size="icon" aria-label={`More options for ${c.name}`} title={`More options for ${c.name}`} disabled={busy}><Ellipsis className="size-4" /></Button>} items={[
              {id:'channel',label:'Connection access',icon:'ShieldCheck',onSelect:()=>setModal({type:'channel',item:c})},
              {id:'rename',label:'Rename',icon:'Pencil',onSelect:()=>setModal({type:'rename',kind:'connections',item:c})},
              {separator:true},
              {id:'delete',label:'Delete',icon:'Trash2',variant:'destructive',onSelect:()=>setModal({type:'delete',kind:'connections',item:c})},
            ]} />
            <Switch className="ml-2" aria-label={`Enable ${c.name}`} checked={c.enabled} disabled={busy} onCheckedChange={enabled=>action(()=>perform(`/api/connections/${c.id}/toggle`,{enabled}))} />
          </div>
        </div>
        <AccordionContent className="pb-0"><AnimatedProjectList label={`${c.name} projects`} ids={c.visible.map(p=>p.id)}>
          {!c.visible.length&&<p className="p-5 text-sm text-muted-foreground">{c.tokenFingerprint?'Sync this connection to discover projects.':'Connect with OAuth to discover projects.'}</p>}
          {c.visible.map(p=><div key={p.id} data-project-id={p.id} className="project-row flex items-center gap-2 pl-8 pr-3 py-2.5"><Button variant="ghost" size="icon-xs" className={`-ml-5 shrink-0 ${p.favourite?'text-foreground':'text-muted-foreground'}`} aria-pressed={!!p.favourite} aria-label={`${p.favourite?'Unpin':'Pin'} ${p.name}`} disabled={busy} onClick={()=>action(()=>perform(`/api/projects/${p.id}/edit`,{favourite:!p.favourite}))}><Pin className={`size-3.5 ${p.favourite?'fill-current':''}`} /></Button><div className="project-name mr-auto min-w-0"><div className="project-title flex min-w-0 items-center gap-1"><h3 className="truncate text-sm font-medium" title={p.name}>{p.name}</h3><ProjectLinks project={p} /></div><div className="project-badges flex items-center gap-2">{(p.channel&&p.channel!=='inherit'?p.channel:c.channel)==='beta'&&<BetaBadge project={p} connection={c} onClick={()=>setModal({type:'permissions',item:p})} />}<AccessBadge project={p} connection={c} permissionKeys={permissionKeys} onClick={()=>setModal({type:'permissions',item:p})} /></div></div><div className="project-controls flex shrink-0 items-center gap-0.5">
            <IconButton label={`Settings for ${p.name}`} icon={Settings2} disabled={busy} onClick={()=>setModal({type:'permissions',item:p})} />
            <Switch className="ml-2" aria-label={`Enable ${p.name}`} checked={p.enabled} disabled={busy||!c.enabled||p.available===false} onCheckedChange={enabled=>action(()=>perform(`/api/projects/${p.id}/edit`,{enabled}))} />
          </div></div>)}
        </AnimatedProjectList></AccordionContent>
      </AccordionItem>;})}
    </Accordion>
    <Dialog open={!!modal} onOpenChange={open=>{if(!open&&!busy)void closeModal();}}><DialogContent onInteractOutside={event=>{if(event.target.closest('[data-sonner-toaster]'))event.preventDefault();}} onOpenAutoFocus={event=>{if(['permissions','rename'].includes(modal?.type)){event.preventDefault();event.target.focus();}}} className={`dialog-shell ${['permissions','defaults'].includes(modal?.type)?'permission-dialog sm:max-w-2xl':'sm:max-w-lg'}`}>{modal?.type!=='permissions'&&<DialogHeader className="shrink-0 pr-6 text-left"><DialogTitle>{modal?.initialNaming?'Name your connection':modal&&titles[modal.type]}</DialogTitle><DialogDescription className={['permissions','about'].includes(modal?.type)?'sr-only':undefined}>{modal?.initialNaming?'Webflow is connected. What would you like to call this connection?':modal?.type==='connect'?'Choose access in Webflow, then limit AI access here.':modal?.type==='permissions'?'Edit the project name and permissions.':modal?.type==='about'?'Application information and third-party licenses.':modal?.type==='defaults'?'Starting permissions for automatically discovered projects.':modal?.type==='delete'?`Remove ${modal.item.name} from this router?`:modal?.type==='channel'?'Review Stable and β Beta access and reconnect either version.':modal?.type==='order'?'Drag connections or use the arrows to change their order.':modal?.type==='diagnostics'?'Connection checks and recent activity.':'Change the local display name.'}</DialogDescription></DialogHeader>}
      {modal?.type==='connect'&&<>
        <p className="text-sm">Select the projects you want to manage and allow the requested permissions so MCP Router can support its full feature set. You’ll control what your AI tools can actually do using per-project permissions here.</p>
        <p className="text-sm font-medium">New projects start disabled. Review their permissions before enabling them.</p>
        <p className="text-xs text-muted-foreground">You can choose fewer projects or permissions. Features requiring access you haven’t granted won’t be available. Router restrictions apply only to actions passing through MCP Router.</p>
        <DialogFooter><Button variant="outline" disabled={busy} onClick={()=>setModal(null)}>Cancel</Button><Button disabled={busy} onClick={()=>action(async()=>{
          const id=modal.connectionId || (await perform('/api/connections')).id;
          setModal({type:'connect',connectionId:id});
          setExpanded(prev=>({...prev,[id]:true}));
          await connect(id);setModal(null);
        },'Complete authorization in your browser. New projects will appear disabled.')}>{busy?'Opening…':'Continue to Webflow'}</Button></DialogFooter>
      </>}
      {modal&&['permissions','defaults'].includes(modal.type)&&<PermissionForm key={`${modal.type}-${modal.item?.id||''}`} model={modal} data={data} busy={busy} perform={perform} connect={connect} refresh={load} close={()=>setModal(null)} />}
      {modal?.type==='channel'&&<div className="dialog-scroll space-y-4">
        <p className="text-xs text-muted-foreground">Authorize the projects and permissions you want this connection to use, then limit AI access in each project’s settings. Narrower authorization is supported. When reconnecting, include any projects that should keep access.</p>
        {['stable','beta'].map(channel=>{const c=data.connections.find(c=>c.id===modal.item.id),state=c?.channels?.[channel];return <div key={channel} className="rounded-md border bg-background p-3 space-y-3"><div className="flex items-center justify-between gap-3"><div><Label>{channel==='beta'?'β Beta':'Stable'}</Label><p className="text-xs text-muted-foreground">{state?.authorized?(state.inventoryPending?'Checking project access…':`${state.siteIds?.length||0} projects authorized`):'Authorization required'}</p></div><Button variant="outline" size="sm" disabled={busy||!c} onClick={()=>action(async()=>{await connect(c.id,channel);},'Complete authorization in your browser.')}>{state?.authorized?'Reconnect':'Authorize'} {channel==='beta'?'β Beta':'Stable'}</Button></div></div>;})}
        <GrantComparison connection={data.connections.find(c=>c.id===modal.item.id)} busy={busy} onReconnect={()=>action(async()=>{await connect(modal.item.id,'beta');},'Complete β Beta authorization in your browser.')} />
        <p className="text-xs text-muted-foreground">The default is set in Settings. β Beta uses the existing permission catalog; new or changed tools are not automatically enabled. Router limits do not change access in Webflow or other integrations.</p>
      </div>}
    {modal?.type==='order'&&<ConnectionOrderForm connections={data.connections} busy={busy} perform={perform} close={()=>setModal(null)} />}
      {modal?.type==='rename'&&<NameForm key={modal.item.id} model={modal} busy={busy} perform={perform} close={closeModal} />}
      {modal?.type==='delete'&&<><p className="text-sm">Permanently remove this connection, its local OAuth credentials and project settings?</p><p className="text-xs text-muted-foreground">This cannot be undone. Webflow sites are not deleted. You can authorize a new connection later.</p><DialogFooter><Button variant="outline" disabled={busy} onClick={()=>setModal(null)}>Cancel</Button><Button variant="destructive" disabled={busy} onClick={()=>action(async()=>{await perform(`/api/${modal.kind}/${modal.item.id}/delete`);setModal(null);},'Connection permanently deleted.')}>Delete connection</Button></DialogFooter></>}
      {modal?.type==='about'&&<AboutPanel />}
      {modal?.type==='diagnostics'&&<div className="dialog-scroll space-y-4"><div className="flex flex-wrap gap-2">{data.connections.filter(c=>c.enabled&&c.hasRefreshToken).map(c=><Button key={c.id} size="sm" variant="outline" disabled={busy} onClick={()=>action(()=>perform(`/api/connections/${c.id}/refresh`),`${c.name}: OAuth refreshed.`)}>Refresh OAuth · {c.name}</Button>)}</div><div className="space-y-1 text-xs text-muted-foreground">{data.audit.map((a,i)=><div key={i}>{new Date(a.at).toLocaleTimeString()} · {a.event}</div>)}</div></div>}

    </DialogContent></Dialog>
  </main>;
}
function ThemedToaster(){const {resolved}=useTheme();return <Toaster theme={resolved} position="bottom-right" closeButton duration={4500} />;}
createRoot(document.getElementById('root')).render(<ThemeProvider><App /><ThemedToaster /></ThemeProvider>);
