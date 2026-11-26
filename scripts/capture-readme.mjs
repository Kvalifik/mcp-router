// Run with: npx electron scripts/capture-readme.mjs
// Renders the current UI against fictional data, never the router or saved accounts.
import { app, BrowserWindow, nativeTheme, Tray, nativeImage, Menu, screen, ipcMain, shell } from 'electron';
import { createServer } from 'vite';
import { writeFile, mkdir, readdir, readFile } from 'node:fs/promises';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import assert from 'node:assert/strict';
import { GROUPS } from '../src/permissions.js';
import { presetGrants } from '../ui/permission-presets.js';
import menuBar from '../src/menu-bar.cjs';
import { createDemoState } from './demo-state.mjs';
import nativeMenusApi from '../src/native-menu.cjs';
import integrations from '../src/integrations.cjs';

async function main() {
const setupDemo = process.argv.find(arg => arg === '--app-setup' || arg.startsWith('--app-setup='));
const recording = Boolean(setupDemo) || process.argv.includes('--record');
const verifyDirect = process.argv.includes('--verify-direct');
const verifyAppSetup = process.argv.includes('--verify-app-setup');
const verifyAttention = process.argv.includes('--verify-attention');
const attentionPreview = process.argv.includes('--attention') || verifyAttention || verifyDirect;
const root = fileURLToPath(new URL('../', import.meta.url));
const temporary = mkdtempSync(join(tmpdir(), 'mcp-router-screenshots-'));
// Keep Chromium's profile until shutdown; quit handlers must be synchronous.
app.once('quit', () => rmSync(temporary, { recursive: true, force: true }));
app.setPath('userData', join(temporary, 'profile'));
nativeTheme.themeSource = 'light';
const keys = GROUPS.flatMap(group => group.modes.map(mode => `${group.area}:${mode}`));
const projects = [
  ['studio', 'Juniper & Kite', 'read', true, true],
  ['studio', 'Paper Moon Journal', 'no-publishing', true, true],
  ['studio', 'Studio Sandbox', 'read-write', true, false],
  ['studio', 'Archive Concept', 'all', false, false],
  ['personal', 'Weekend Fieldnotes', 'all', true, true],
  ['personal', 'Portfolio Playground', 'no-publishing', true, false],
].map(([connectionId, name, preset, enabled, favourite], index) => ({
  id: `demo-project-${index}`, siteId: `demo-site-${index}`, connectionId,
  name, sourceName: name, shortName: `demo-${name.toLowerCase().replace(/ & /g, '-').replace(/ /g, '-')}`,
  enabled, favourite, available: true, read: true, channel: [1, 2].includes(index) ? 'beta' : 'inherit',
  permissions: presetGrants(keys, preset),
}));
const data = {
  csrf: 'fictional-demo', permissionGroups: GROUPS, projects, audit: [],
  settings: { defaultChannel: 'stable', defaultPermissions: presetGrants(keys, 'all') },
  connections: [['studio', 'Example Studio'], ['personal', 'Personal Projects']].map(([id, name]) => ({
    id, name, enabled: true, sites:projects.filter(p=>p.connectionId===id).map(p=>({id:p.siteId,workspaceId:`demo-workspace-${id}`,workspaceName:name})), workspacePermissions:{}, channel: 'stable', tokenFingerprint: 'fictional-demo',
    channels: Object.fromEntries(['stable', 'beta'].map(channel => [channel, {
      authorized: true, status: 'connected', siteIds: projects.filter(p => p.connectionId === id).map(p => p.siteId),
    }])),
  })),
};
const demo = createDemoState(data);
if (verifyAppSetup || setupDemo) for (const project of demo.state.projects) project.enabled = false;
const applications = join(temporary, 'Applications');
const appData = join(temporary, 'app-data');
const demoBin = join(temporary, 'bin');
let codexConfigured = false;
const clients = integrations.createIntegrations({
  home:temporary, appData, platform:'darwin', applicationsDirs:[applications], binaryDirs:[demoBin],
  codexHome:join(temporary, 'codex'), executable:join(temporary, 'demo-router'),
  script:join(temporary, 'stdio.js'), socket:join(temporary, 'router.sock'),
  // The Codex integration invokes its CLI. Simulate that CLI inside the demo.
  run:async (command, args) => {
    assert.equal(command, join(demoBin, 'codex'));
    if (args[1] === 'add') { codexConfigured = true; return {stdout:''}; }
    assert.equal(args[1], 'get');
    if (!codexConfigured) throw Object.assign(new Error('Demo server missing'), {stderr:'not found'});
    const transport = JSON.parse(clients.configuration()).mcpServers[integrations.NAME];
    return {stdout:JSON.stringify({enabled:true, transport})};
  },
});
let server;
let window;
let tray;
let popover;
try {
  await app.whenReady();
  if (setupDemo) {
    const only = setupDemo.split('=')[1];
    const desktopApps = {'claude-desktop':'Claude', cursor:'Cursor', vscode:'Visual Studio Code', antigravity:'Antigravity'};
    const cliApps = {codex:'codex', 'claude-code':'claude', gemini:'gemini'};
    if (only !== undefined && !Object.hasOwn(desktopApps, only) && !Object.hasOwn(cliApps, only)) throw new Error('Unknown demo app. Choose one of: ' + Object.keys({...desktopApps, ...cliApps}).join(', '));
    await mkdir(demoBin);
    for (const [id, name] of Object.entries(desktopApps)) {
      if (!only || id === only) await mkdir(join(applications, name + '.app'), {recursive:true});
    }
    for (const [id, name] of Object.entries(cliApps)) {
      if (!only || id === only) await writeFile(join(demoBin, name), '');
    }
  } else if (!verifyAppSetup) {
    await mkdir(join(applications, 'Claude.app'), {recursive:true});
    assert.ok((await clients.connect('claude-desktop')).ok);
  }
  app.on('window-all-closed',()=>{});
  const preload = join(temporary, 'preload.cjs');
  await writeFile(preload, `const {contextBridge, ipcRenderer} = require('electron');
  contextBridge.exposeInMainWorld('routerDesktop', {
    integratedTitleBar: true,
    showNativeMenu: request => ipcRenderer.invoke('demo-native-menu', request),
    openMainWindow: () => ipcRenderer.invoke('demo-open-main-window'),
    openRepository: () => ipcRenderer.invoke('demo-open-repository'),
    openIssues: () => ipcRenderer.invoke('demo-open-issues'),
    openOAuth: async url => { if (url !== "demo:authorized") throw new Error("Only simulated demo authorization is available."); },
    clientStatus: () => ipcRenderer.invoke('demo-client-status'),
    connectClient: id => ipcRenderer.invoke('demo-connect-client', id),
    ${verifyAppSetup ? "copyClientConfig: format => ipcRenderer.invoke('verify-copy-config', format)," : ''}
    setTheme: async () => {},
    onShowAbout: () => {},
  });`);
  server = await createServer({
    configFile: join(root, 'vite.config.js'),
    server: { host: '127.0.0.1', port: 0 },
    plugins: [{ name: 'fictional-screenshot-data', configureServer(server) {
      server.middlewares.use('/api', async (request, response) => {
        response.setHeader('Content-Type', 'application/json');
        response.setHeader('Cache-Control', 'no-store');
        try {
          const origin = `http://127.0.0.1:${server.httpServer.address().port}`;
          if (request.headers.host !== new URL(origin).host || (request.headers.origin && request.headers.origin !== origin) || request.headers['sec-fetch-site'] === 'cross-site') throw new Error('Request denied');
          if (request.method === 'GET' && request.url === '/state') { response.end(JSON.stringify({...demo.state, accessStatus: menuBar.menuBarStatus(demo.state)})); return; }
          if ((!recording && !attentionPreview && !verifyAppSetup) || request.method !== 'POST' || request.headers.origin !== origin || request.headers['x-router-csrf'] !== data.csrf || !request.headers['content-type']?.startsWith('application/json')) throw new Error('Request denied');
          let text = '';
          for await (const chunk of request) { text += chunk; if (text.length > 1048576) throw new Error('Request too large'); }
          const result = demo.mutate(request.url, JSON.parse(text || '{}'));
          if (tray) menuBar.createTrayTextUpdater()(tray, 'projects', menuBar.menuBarStatus(demo.state));
          response.end(JSON.stringify(result));
        } catch (error) { response.statusCode = 400; response.end(JSON.stringify({ error: error.message })); }
      });
    } }],
  });
  await server.listen();
  const origin = `http://127.0.0.1:${server.httpServer.address().port}`;
  const allowed = event => [window, popover].some(owner => owner && !owner.isDestroyed() &&
    event.sender === owner.webContents && event.senderFrame === owner.webContents.mainFrame) &&
    event.senderFrame?.url === `${origin}/`;
  const showMain = () => { popover?.hide(); if (window.isMinimized()) window.restore(); window.show(); window.focus(); };
  ipcMain.handle('demo-client-status', event => { if (!allowed(event)) throw new Error('Denied'); return clients.status(); });
  ipcMain.handle('demo-connect-client', (event, id) => { if (!allowed(event)) throw new Error('Denied'); return clients.connect(id); });
  let copiedConfig;
  if (verifyAppSetup) ipcMain.handle('verify-copy-config', (event, format) => {
    if (!allowed(event)) throw new Error('Denied');
    copiedConfig = clients.configuration(format);
  });
  ipcMain.handle('demo-open-main-window', event => { if (!allowed(event)) throw new Error('Denied'); showMain(); });
  const {updateRepository} = JSON.parse(await readFile(join(root, 'package.json'), 'utf8'));
  for (const [channel, suffix] of [['demo-open-repository', ''], ['demo-open-issues', '/issues']]) {
    ipcMain.handle(channel, async event => {
      if (!allowed(event)) throw new Error('Denied');
      await shell.openExternal(`https://github.com/${updateRepository}${suffix}`);
    });
  }
  const icons = {};
  const iconDirectory = join(root, 'assets/icons/menu');
  for (const file of await readdir(iconDirectory)) {
    if (!/^[A-Za-z0-9]+\.png$/.test(file)) continue;
    const icon = nativeImage.createEmpty();
    icon.addRepresentation({ scaleFactor: 2, buffer: await readFile(join(iconDirectory, file)) });
    icon.setTemplateImage(true);
    icons[file.slice(0, -4)] = icon;
  }
  const nativeMenus = new Set();
  let verificationMenuSelection=null;
  let inspectedMenu;
  ipcMain.handle('demo-native-menu', (event, request) => {
    if (!allowed(event) || !request || !Number.isFinite(request.x) || !Number.isFinite(request.y)) throw new Error('Denied');
    const owner = BrowserWindow.fromWebContents(event.sender);
    if (nativeMenus.has(owner)) throw new Error('Menu already open');
    let selection = null;
    const menu = Menu.buildFromTemplate(nativeMenusApi.menuTemplate(request.items, id => { selection = id; }, icons));
    if (verifyAppSetup) inspectedMenu = request.items;
    if(verificationMenuSelection) {
      const id=verificationMenuSelection;verificationMenuSelection=null;
      if(!request.items.some(item=>item.id===id&&!item.disabled))throw new Error('Verification menu item missing');
      return id;
    }
    if (verifyAppSetup) return null;
    const [width, height] = owner.getContentSize();
    nativeMenus.add(owner);
    return new Promise((resolve, reject) => {
      try {
        menu.popup({ window: owner, x: Math.max(0, Math.min(width, Math.round(request.x))),
          y: Math.max(0, Math.min(height, Math.round(request.y))), callback: () => {
            nativeMenus.delete(owner);
            if (!owner.isDestroyed()) {
              if (selection) { owner.show(); owner.focus(); }
              else if (owner === popover && !owner.isFocused()) owner.hide();
            }
            resolve(selection);
          } });
      } catch (error) { nativeMenus.delete(owner); reject(error); }
    });
  });
  window = new BrowserWindow({ width: 860, height: 640, show: false,
    titleBarStyle: 'hidden', trafficLightPosition: { x: 16, y: 25 },
    webPreferences: { preload, contextIsolation: true, nodeIntegration: false, sandbox: true, partition: 'screenshot-demo' } });
  window.webContents.session.webRequest.onBeforeRequest((details, callback) => {
    callback({ cancel: !details.url.startsWith(`${origin}/`) });
  });
  await window.loadURL(origin);
  window.show();
  const evaluate = code => window.webContents.executeJavaScript(code);
  async function waitFor(selector) {
    for (let attempt = 0; attempt < 100; attempt++) {
      if (await evaluate(`!!document.querySelector(${JSON.stringify(selector)})`)) return;
      await new Promise(resolve => setTimeout(resolve, 100));
    }
    throw new Error(`UI did not render: ${selector}`);
  }
  const click = selector => evaluate(`document.querySelector(${JSON.stringify(selector)}).click()`);
  async function capture(name) {
    if (verifyAttention || verifyDirect && !name.startsWith('/')) return;
    await evaluate('document.fonts.ready');
    app.focus({ steal: true });
    window.focus();
    await new Promise(resolve => setTimeout(resolve, 1500));
    await window.webContents.capturePage();
    const path = name.startsWith('/') ? name : join(root, 'docs/images', name);
    await mkdir(dirname(path), { recursive: true });
    const windowId = window.getMediaSourceId().split(':')[1];
    let captured = false;
    for (let attempt = 0; attempt < 3; attempt++) {
      window.show(); window.focus();
      await promisify(execFile)('/usr/sbin/screencapture', ['-x', '-T', '1', '-l', windowId, path]);
      const pixels = nativeImage.createFromPath(path).toBitmap();
      let visible = 0;
      for (let i = 3; i < pixels.length; i += 4) if (pixels[i] > 0) visible++;
      if (visible > 10000) { captured = true; break; }
      await new Promise(resolve => setTimeout(resolve, 1000));
    }
    if (!captured) throw new Error('Window capture was blank: ' + name);
    await new Promise(resolve => setTimeout(resolve, 1500));
    console.log(`Saved ${path}`);
  }
  await waitFor('[aria-label="Expand Example Studio"]');
  await click('[aria-label="Expand Example Studio"]');
  await click('[aria-label="Expand Personal Projects"]');
  await evaluate('document.activeElement.blur()');
  if (verifyAppSetup) {
    const prompt = '.app-setup-reveal[data-open="true"] [aria-label="AI app setup"]';
    const primary = prompt + ' button:first-of-type';
    const setupComplete = `body:not(:has(${prompt})) [role="status"]`;
    const apps = 'button.app-client-menu';
    const waitForCount = count => waitFor(`${apps}[aria-label="Apps (${count})"]`);
    const claudeSettings = join(appData, 'Claude', 'claude_desktop_config.json');
    const reload = async () => { await window.loadURL(origin); await waitFor(apps); };
    const buttonText = () => evaluate(`document.querySelector('${primary}').textContent`);
    const hasPrompt = () => evaluate(`!!document.querySelector('${prompt}')`);
    async function inspectMenu(selector, selection = null) {
      inspectedMenu = null;
      verificationMenuSelection = selection;
      await click(selector);
      for (let i = 0; !inspectedMenu && i < 100; i++) await new Promise(resolve => setTimeout(resolve, 20));
      assert.ok(inspectedMenu, 'expected a validated native menu');
      return inspectedMenu;
    }

    assert.equal(await hasPrompt(), false);
    await waitForCount('0/0');
    await evaluate(`window.setupTransitions = [];
      document.addEventListener('transitionend', event => {
        if (event.target.matches('.app-setup-reveal') && event.propertyName === 'grid-template-rows') window.setupTransitions.push(event.target.dataset.open);
      });`);
    await click('[aria-label="Enable Juniper & Kite"]');
    await waitFor(prompt);
    assert.equal(await buttonText(), 'Copy setup instructions');
    await click(primary); await waitFor('[role="status"]');
    assert.equal(copiedConfig, clients.configuration('agent'));
    assert.ok(await hasPrompt());
    const reduced = await evaluate("matchMedia('(prefers-reduced-motion: reduce)').matches");
    const finishReveal = () => evaluate(`new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))).then(() =>
      Promise.all(document.querySelector('.app-setup-reveal').getAnimations().map(animation => animation.finished)))
      .then(() => new Promise(resolve => requestAnimationFrame(() => resolve(true))))`);
    await finishReveal();
    await click('[aria-label="Enable Juniper & Kite"]');
    await waitFor('.app-setup-reveal[data-open="false"][inert]');
    await finishReveal();
    assert.deepEqual(await evaluate('window.setupTransitions'), reduced ? [] : ['true', 'false']);
    await click('[aria-label="Enable Juniper & Kite"]');
    await waitFor(prompt);
    await mkdir(join(applications, 'Claude.app'), {recursive:true});
    await reload(); await waitFor(prompt);
    await waitForCount('0/1');
    assert.equal(await buttonText(), 'Set up Claude Desktop');

    // Break the fixture after discovery to exercise a real failed registration and retry.
    await mkdir(dirname(claudeSettings), {recursive:true});
    await writeFile(claudeSettings, '{');
    await click(primary); await waitFor('[role="alert"]');
    assert.equal(await readFile(claudeSettings, 'utf8'), '{');
    assert.ok(await hasPrompt());
    await writeFile(claudeSettings, '{}');
    await click(primary); await waitFor(setupComplete);
    await waitForCount('1/1');
    assert.equal(await hasPrompt(), false);
    assert.match(await evaluate("document.querySelector('[role=status]').textContent"), /Claude Desktop is set up\. Quit and reopen Claude Desktop/);
    await reload();
    const claude = (await inspectMenu(apps)).find(item => item.label === 'Claude Desktop');
    assert.ok(claude.children.some(item => item.disabled && item.label === 'Set up'));
    assert.ok(claude.children.some(item => item.disabled && item.label.includes('Quit and reopen Claude Desktop')));

    await writeFile(claudeSettings, '{}');
    await mkdir(join(applications, 'Cursor.app'));
    await reload(); await waitFor(prompt);
    await waitForCount('0/2');
    assert.equal(await buttonText(), 'Choose an AI app');
    const choices = await inspectMenu(primary);
    assert.deepEqual(choices.map(item => item.label), ['Set up Claude Desktop', 'Set up Cursor']);
    assert.ok(!(await clients.status()).some(client => client.state === 'configured'));
    await inspectMenu(primary, 'connect-cursor'); await waitFor(setupComplete);
    await waitForCount('1/2');
    window.setSize(400, 560);
    await waitForCount('1/2');
    assert.ok(await evaluate(`(() => {
      const button = document.querySelector('.app-client-menu'), label = button.querySelector('.tabular-nums');
      const bounds = label.getBoundingClientRect(), header = document.querySelector('.app-header');
      return innerWidth === 400 && bounds.width > 0 && bounds.left >= button.getBoundingClientRect().left &&
        bounds.right <= button.getBoundingClientRect().right && header.scrollWidth <= innerWidth;
    })()`), 'compact header must fit the visible Apps count');
    window.setSize(860, 640);
    assert.deepEqual((await clients.status()).filter(client => client.state === 'configured').map(client => client.id), ['cursor']);
    assert.equal(await hasPrompt(), false);

    await writeFile(join(temporary, '.cursor', 'mcp.json'), '{}');
    await reload(); await waitFor(prompt);
    await click('[aria-label="Dismiss AI app setup"]');
    await reload();
    assert.ok((await inspectMenu(apps)).find(item => item.label === 'Claude Desktop').children.some(item => item.label === 'Set up' && !item.disabled));
    assert.equal(await hasPrompt(), false);
    console.log('Verified first-project setup, manual fallback, app selection, retry, persistent instructions and dismissal using temporary client configurations.');
    return;
  }
  if (recording) {
    if (process.platform === 'darwin') {
      const icon = nativeImage.createFromPath(join(root, 'assets/icons/menubar/MCPRouterTemplate.png'));
      icon.setTemplateImage(true);
      tray = new Tray(icon);
      menuBar.createTrayTextUpdater()(tray, 'projects', menuBar.menuBarStatus(data));
      popover = new BrowserWindow({ width: 400, height: 560, show: false, frame: false,
        type: 'panel', resizable: false, fullscreenable: false, minimizable: false,
        maximizable: false, skipTaskbar: true, alwaysOnTop: true,
        webPreferences: { preload, contextIsolation: true, nodeIntegration: false, sandbox: true, partition: 'screenshot-demo' } });
      popover.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
      popover.webContents.on('will-navigate', (event, url) => { if (url !== `${origin}/`) event.preventDefault(); });
      popover.on('blur', () => { if (!nativeMenus.has(popover)) popover.hide(); });
      popover.webContents.on('before-input-event', (event, input) => {
        if (input.key === 'Escape' && input.type === 'keyDown') { popover.hide(); event.preventDefault(); }
      });
      await popover.loadURL(origin);
      tray.on('click', () => {
        if (popover.isVisible()) { popover.hide(); return; }
        const anchor = tray.getBounds();
        popover.setBounds(menuBar.popoverBounds(anchor, screen.getDisplayMatching(anchor).workArea));
        popover.show();
        popover.focus();
      });
      tray.on('right-click', () => tray.popUpContextMenu(Menu.buildFromTemplate([
        { label: 'Open MCP Router Demo', click: showMain },
        { type: 'separator' },
        { label: 'Quit Demo', click: () => window.close() },
      ])));
    }
    console.log('Interactive demo ready. Changes stay in memory and reset on exit. Webflow actions are simulated. Close the window to quit.');
    await new Promise(resolve => window.once('closed', resolve));
    window = undefined;
    return;
  }
  await capture('project-overview.png');
  await click('[aria-label="Settings for Juniper & Kite"]');
  await waitFor('[role="dialog"]');
  await capture('project-permissions.png');
  if (attentionPreview) {
    const assertUI = async (expression, message) => {
      if (!await evaluate(expression)) throw new Error(`Access UI regression: ${message}`);
    };
    const loadDemo = async () => { await window.loadURL(origin); await waitFor('[aria-label="Expand Example Studio"]'); };
    const projectBadge = '[aria-label="Access needs attention for Paper Moon Journal"]';
    const connectionBadge = '[aria-label="Access needs attention for Example Studio"]';
    const dismiss = async () => { await click('[data-slot="dialog-close"]'); await new Promise(resolve=>setTimeout(resolve,250)); };
    await dismiss();
    const projectPermissionsBefore=JSON.stringify(demo.state.projects.map(project=>project.permissions));
    verificationMenuSelection='workspace';
    await click('[aria-label="More options for Example Studio"]');
    await waitFor('[aria-label="Example Studio: Read members, invitations and site roles"]');
    await assertUI(`document.querySelector('[role="dialog"]').textContent.includes('including sites that are disabled') && document.querySelector('[aria-label="Example Studio: Read members, invitations and site roles"]').getAttribute('aria-checked')==='false'`, 'workspace scope must be explicit and default off');
    await assertUI(`document.querySelector('[aria-label="List all accessible workspaces"]').getAttribute('aria-checked')==='false' && document.querySelector('[aria-label="Create and deploy standalone apps and set their access"]').getAttribute('aria-checked')==='false'`, 'account-wide grants must default off');
    await assertUI(`document.querySelector('[aria-label="Example Studio: Create workspace AEO topics and tracked prompts · Beta"]').getAttribute('aria-checked')==='false'`, 'workspace AEO must default off');
    await click('[aria-label="Example Studio: Create workspace AEO topics and tracked prompts · Beta"]');
    await click('[aria-label="List all accessible workspaces"]');
    await click('[aria-label="Example Studio: Read members, invitations and site roles"]');
    await evaluate(`Array.from(document.querySelectorAll('[role="dialog"] button')).find(button=>button.textContent==='Save changes').click()`);
    for(let attempt=0;attempt<50&&await evaluate(`!!document.querySelector('[role="dialog"]')`);attempt++)await new Promise(resolve=>setTimeout(resolve,100));
    if(demo.state.connections[0].workspacePermissions?.['demo-workspace-studio']?.['workspace_members:read']!==true || JSON.stringify(demo.state.projects.map(project=>project.permissions))!==projectPermissionsBefore)throw new Error('Workspace permissions must save independently of project grants');
    if(demo.state.connections[0].workspacePermissions?.['demo-workspace-studio']?.['workspace_aeo:write']!==true)throw new Error('Workspace AEO grant must save independently');
    if(demo.state.connections[0].connectionPermissions?.['workspace_discovery:read']!==true)throw new Error('Account-wide grant must save independently');
    await assertUI(`(() => {
      const strip = document.querySelector('.router-shell > .update-banner-reveal[data-open="true"] [role="status"]');
      return strip?.textContent === 'Workspace permissions saved.' &&
        strip.getBoundingClientRect().bottom <= document.querySelector('.router-main').getBoundingClientRect().top;
    })()`, 'save feedback must appear above the scrollable controls');
    demo.state.connections[0].connectionPermissions={};
    demo.state.connections[0].workspacePermissions={};
    const projectsBeforeDirect=JSON.stringify(demo.state.projects);
    verificationMenuSelection='access-mode';
    await click('[aria-label="More options for Example Studio"]');
    await waitFor('input[name="accessMode"][value="managed"]');
    await assertUI(`document.querySelector('input[value="managed"]').checked`, 'connections must default to Managed');
    await click('input[name="accessMode"][value="direct"]');
    await assertUI(`document.querySelector('[role="dialog"]').textContent.includes('Project permissions don’t apply') && document.querySelector('[role="dialog"]').textContent.includes('other projects or workspaces')`, 'Direct scope must be explicit before saving');
    await evaluate(`document.querySelectorAll('[aria-label="Dismiss notification"]').forEach(button=>button.click()); document.activeElement.blur()`);
    await capture('/tmp/mcp-router-direct-dialog.png');
    window.setWindowButtonVisibility(false);
    window.setSize(400,420);
    await new Promise(resolve=>setTimeout(resolve,300));
    await capture('/tmp/mcp-router-direct-compact.png');
    await assertUI(`(()=>{const footer=document.querySelector('[role="dialog"] [data-slot="dialog-footer"]').getBoundingClientRect(); const scroller=document.querySelector('[role="dialog"] .dialog-scroll'); return footer.bottom<=innerHeight && footer.top>=0 && scroller.clientHeight>0 && scroller.scrollHeight>scroller.clientHeight;})()`, 'compact Direct dialog must scroll and keep its save action visible');
    window.setSize(860,640);
    window.setWindowButtonVisibility(true);
    await evaluate(`Array.from(document.querySelectorAll('[role="dialog"] button')).find(button=>button.textContent==='Enable Direct Webflow').click()`);
    for(let attempt=0;attempt<50&&await evaluate(`!!document.querySelector('[role="dialog"]')`);attempt++)await new Promise(resolve=>setTimeout(resolve,100));
    if(demo.state.connections[0].accessMode!=='direct')throw new Error('Direct mode did not save');
    await assertUI(`document.querySelector('[aria-label="Enable Juniper & Kite"]').disabled && document.querySelector('[aria-label="Settings for Juniper & Kite"]').disabled`, 'project controls must be inactive in Direct mode');
    await assertUI(`document.querySelector('[aria-label="Direct Webflow — settings for Archive Concept"]') !== null`, 'disabled managed projects must show Direct access');
    await evaluate(`document.querySelectorAll('[aria-label="Dismiss notification"]').forEach(button=>button.click()); document.activeElement.blur()`);
    await capture('/tmp/mcp-router-direct-overview.png');
    verificationMenuSelection='access-mode';
    await click('[aria-label="More options for Example Studio"]');
    await waitFor('input[name="accessMode"][value="managed"]');
    await click('input[name="accessMode"][value="managed"]');
    await evaluate(`Array.from(document.querySelectorAll('[role="dialog"] button')).find(button=>button.textContent==='Save changes').click()`);
    for(let attempt=0;attempt<50&&await evaluate(`!!document.querySelector('[role="dialog"]')`);attempt++)await new Promise(resolve=>setTimeout(resolve,100));
    await assertUI(`!document.querySelector('[aria-label="Enable Juniper & Kite"]').disabled`, 'Managed controls must return');
    if(JSON.stringify(demo.state.projects)!==projectsBeforeDirect)throw new Error('Mode switch changed saved project settings');
    if (verifyDirect) { console.log('Verified: default Managed mode, explicit Direct scope, native menu, responsive dialog, inactive project controls and unchanged restored settings.'); return; }

    window.setWindowButtonVisibility(false);
    window.setSize(400, 560);
    await loadDemo();
    await click('[aria-label="Expand Example Studio"]');
    await new Promise(resolve=>setTimeout(resolve,400));
    const healthyHeight = await evaluate(`document.querySelector('[data-project-id="demo-project-1"]').getBoundingClientRect().height`);
    await assertUI(`!document.querySelector('.access-issue-badge') && !document.body.innerText.includes('enabled projects ready')`, 'healthy view must stay quiet');
    await capture('/tmp/mcp-router-healthy-compact.png');

    // One missing Beta project, with Stable left intact.
    const stableBefore = JSON.stringify(demo.state.connections[0].channels.stable);
    demo.state.connections[0].channels.beta.siteIds = demo.state.connections[0].channels.beta.siteIds.filter(id => id !== 'demo-site-1');
    await loadDemo();
    await waitFor(connectionBadge);
    await capture('/tmp/mcp-router-attention-overview.png');
    await click('[aria-label="Expand Example Studio"]');
    await waitFor(projectBadge);
    await new Promise(resolve=>setTimeout(resolve,400));
    await assertUI(`(()=>{const connection=document.querySelector('${connectionBadge}').getBoundingClientRect();const project=document.querySelector('${projectBadge}').getBoundingClientRect();return Math.abs(connection.x+connection.width/2-project.x-project.width/2)<1;})()`, 'connection and project attention badges must align');
    await assertUI(`Math.abs(document.querySelector('[data-project-id="demo-project-1"]').getBoundingClientRect().height - ${healthyHeight}) < 1`, 'warning must not increase project row height');
    await assertUI(`document.querySelectorAll('.access-issue-warning').length === 2 && !document.body.innerText.includes('enabled projects ready') && !document.body.innerText.includes('Project not included')`, 'one badge per affected project and connection, with no inline error prose');
    await capture('/tmp/mcp-router-attention-compact.png');

    const point = await evaluate(`(()=>{const r=document.querySelector('${projectBadge}').getBoundingClientRect();return {x:Math.round(r.x+r.width/2),y:Math.round(r.y+r.height/2)};})()`);
    window.webContents.sendInputEvent({type:'mouseMove',...point});
    await waitFor('[data-slot="tooltip-content"]');
    await assertUI(`document.querySelector('[data-slot="tooltip-content"]').textContent.includes('Project not included in Beta authorization')`, 'hover must explain the issue');
    await capture('/tmp/mcp-router-attention-tooltip.png');
    window.webContents.sendInputEvent({type:'mouseMove',x:5,y:200});
    // Verify keyboard entry into details, not only pointer clicks.
    app.focus({steal:true});
    window.focus();
    window.webContents.focus();
    await new Promise(resolve=>setTimeout(resolve,200));
    await evaluate(`document.querySelector('${projectBadge}').focus()`);
    await assertUI(`document.activeElement===document.querySelector('${projectBadge}')`, 'warning badge must receive keyboard focus');
    window.webContents.sendInputEvent({type:'keyDown',keyCode:'Return'});
    window.webContents.sendInputEvent({type:'char',keyCode:'\r'});
    window.webContents.sendInputEvent({type:'keyUp',keyCode:'Return'});
    await waitFor('[role="dialog"]');
    await assertUI(`document.querySelector('[role="dialog"]').textContent.includes('Paper Moon Journal') && document.querySelector('[role="dialog"]').textContent.includes('Reconnect Beta')`, 'keyboard must open a scoped recovery action');
    await capture('/tmp/mcp-router-attention-review.png');
    await dismiss();
    await assertUI(`document.activeElement === document.querySelector('${projectBadge}')`, 'closing details must restore keyboard focus');
    await evaluate('document.activeElement.blur()');
    window.setSize(860,640);
    window.setWindowButtonVisibility(true);
    await capture('/tmp/mcp-router-attention-project.png');
    await click(connectionBadge);
    await waitFor('[role="dialog"]');
    await assertUI(`document.querySelector('[role="dialog"]').textContent.includes('2 of 3 enabled projects ready')`, 'connection detail counts must be scoped');
    await dismiss();

    // A filtered-out project must still be reachable from its connection badge.
    await click('[aria-label="Show pinned projects"]');
    demo.state.projects[1].favourite=false;
    await loadDemo();
    await click('[aria-label="Show pinned projects"]');
    await waitFor(connectionBadge);
    await assertUI(`!document.querySelector('[data-project-id="demo-project-1"]')`, 'fixture must hide the affected project');
    await click(connectionBadge);
    await waitFor('[role="dialog"]');
    await assertUI(`document.querySelector('[role="dialog"]').textContent.includes('Paper Moon Journal')`, 'filtered projects must remain in connection details');
    await evaluate(`Array.from(document.querySelectorAll('[role="dialog"] button')).find(b=>b.textContent==='Reconnect Beta').click()`);
    await waitFor('[data-slot="dialog-title"]');
    for (let attempt=0;attempt<50;attempt++) {
      if (await evaluate(`document.querySelector('[data-slot="dialog-title"]')?.textContent==='Access restored'`)) break;
      await new Promise(resolve=>setTimeout(resolve,100));
    }
    await assertUI(`document.querySelector('[data-slot="dialog-title"]').textContent==='Access restored' && !document.querySelector('.access-issue-warning')`, 'recovery must clear the warning');
    if (JSON.stringify(demo.state.connections[0].channels.stable)!==stableBefore) throw new Error('Recovery changed the wrong grant');
    await dismiss();
    demo.state.connections[0].channels.beta.inventoryPending=true;
    await loadDemo();
    await click('[aria-label="Expand Example Studio"]');
    await waitFor('[aria-label="Checking access for Paper Moon Journal"]');
    await assertUI(`!document.querySelector('.access-issue-warning') && document.querySelectorAll('.access-issue-badge').length===3`, 'pending checks must be neutral, including their connection');
    demo.state.connections[0].channels.beta.status='check_failed';
    demo.state.projects[0].permissions={};
    demo.state.projects[1].name='Paper Moon Journal — Editorial and publishing';
    window.setSize(400,560);
    window.setWindowButtonVisibility(false);
    await loadDemo();
    await click('[aria-label="Expand Example Studio"]');
    await waitFor('[aria-label="Access needs attention for Juniper & Kite"]');
    await evaluate(`document.documentElement.classList.add('dark')`);
    await assertUI(`document.querySelectorAll('.access-issue-warning').length===4 && document.documentElement.scrollWidth===document.documentElement.clientWidth`, 'multiple issues must fit the compact window');
    await capture('/tmp/mcp-router-attention-dark.png');
    await click(connectionBadge);
    await waitFor('[role="dialog"]');
    await assertUI(`document.querySelector('[role="dialog"]').textContent.includes('Juniper & Kite') && document.querySelector('[role="dialog"]').textContent.includes('Paper Moon Journal') && document.querySelector('[role="dialog"]').textContent.includes('Studio Sandbox')`, 'connection details must list all affected projects');
    await evaluate(`Array.from(document.querySelectorAll('[role="dialog"] button')).find(b=>b.textContent==='Review permissions').click()`);
    await waitFor('[aria-label="Search permissions"]');
    await assertUI(`document.querySelector('[role="dialog"]').textContent.includes('Juniper & Kite')`, 'permission recovery must open the affected project');
    demo.state.connections[0].enabled=false;
    await loadDemo();
    await assertUI(`!document.querySelector('.access-issue-badge')`, 'disabled connections must not show warnings');
    console.log('Verified: quiet healthy state, unchanged row height, hover details, keyboard entry and focus return, scoped counts, filtered project access, Beta-only recovery, neutral pending checks, multiple errors, permission recovery, and disabled connections.');
  }

} catch (error) {
  console.error(error);
  process.exitCode=1;
} finally {
  ipcMain.removeHandler('demo-native-menu');
  ipcMain.removeHandler('demo-open-main-window');
  tray?.destroy();
  await server?.close();
  // Normal captures follow Electron's graceful window/application lifecycle.
  // Retain a nonzero exit status for failed automation.
  if(process.exitCode)app.exit(process.exitCode);
  else app.quit();
}
}
main().catch(error => { console.error(error); app.exit(1); });
