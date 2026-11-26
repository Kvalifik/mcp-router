// Run with: npx electron scripts/capture-readme.mjs
// Renders the current UI against fictional data, never the router or saved accounts.
import { app, BrowserWindow, nativeTheme, Tray, nativeImage, Menu, screen, ipcMain, shell } from 'electron';
import assert from 'node:assert/strict';
import { createServer } from 'vite';
import { writeFile, mkdir, readdir, readFile } from 'node:fs/promises';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { CATALOG, GROUPS } from '../src/permissions.js';
import { presetGrants } from '../ui/permission-presets.js';
import menuBar from '../src/menu-bar.cjs';
import { createDemoState, createDemoActivity } from './demo-state.mjs';
import nativeMenusApi from '../src/native-menu.cjs';
import integrations from '../src/integrations.cjs';

async function main() {
const setupDemo = process.argv.find(arg => arg === '--app-setup' || arg.startsWith('--app-setup='));
const recording = Boolean(setupDemo) || process.argv.includes('--record');
const verifyActivity = process.argv.includes('--verify-activity');
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
    id, name, enabled: true, sites:projects.filter(p=>p.connectionId===id).map(p=>({id:p.siteId,name:p.name,workspaceId:`demo-workspace-${id}`,workspaceName:name})), workspacePermissions:{}, channel: 'stable', tokenFingerprint: 'fictional-demo',
    channels: Object.fromEntries(['stable', 'beta'].map(channel => [channel, {
      authorized: true, status: 'connected', siteIds: projects.filter(p => p.connectionId === id).map(p => p.siteId),
    }])),
  })),
};
if (verifyDirect) {
  const sites = data.connections[0].sites;
  delete sites[2].workspaceName;
  sites[3].workspaceId = 'demo-unnamed-workspace';
  delete sites[3].workspaceName;
}
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
const {activity, tick, advanceTime} = createDemoActivity(demo.state, recording);
const activityTimer = recording ? setInterval(tick, 4000) : null;
let heldPeriodResponse;
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
  const demoClients = verifyDirect ? [
    {id:'codex',name:'Codex',installed:true,state:'configured',hint:'Restart Codex.'},
    {id:'vscode',name:'VS Code',installed:true,state:'error'},
    {id:'cursor',name:'Cursor',installed:false,state:'not-connected'},
  ] : [];
  await writeFile(preload, `const {contextBridge, ipcRenderer} = require('electron');
  window.addEventListener('keydown', event => {
    if (event.key === 'Escape' && !event.defaultPrevented) ipcRenderer.send('demo-hide-panel');
  });
  if (!(${verifyDirect} && location.search === '?web')) contextBridge.exposeInMainWorld('routerDesktop', {
    integratedTitleBar: true,
    showNativeMenu: request => ipcRenderer.invoke('demo-native-menu', request),
    openMainWindow: () => ipcRenderer.invoke('demo-open-main-window'),
    openPublisher: () => ipcRenderer.invoke('demo-open-publisher'),
    openRepository: () => ipcRenderer.invoke('demo-open-repository'),
    openIssues: () => ipcRenderer.invoke('demo-open-issues'),
    openOAuth: async url => { if (url !== "demo:authorized") throw new Error("Only simulated demo authorization is available."); },
    clientStatus: () => ipcRenderer.invoke('demo-client-status'),
    connectClient: id => ipcRenderer.invoke('demo-connect-client', id),
    ${verifyAppSetup ? "copyClientConfig: format => ipcRenderer.invoke('verify-copy-config', format)," : 'copyClientConfig: async () => {},'}
    checkUpdates: manual => ipcRenderer.invoke('demo-check-updates', manual),
    openUpdateNotes: version => ipcRenderer.invoke('demo-update-notes', version),
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
          const url = new URL(request.url, origin);
          if (request.method === 'GET' && url.pathname === '/activity') {
            const view = url.searchParams.get('view') || 'pulse';
            const period = Number(url.searchParams.get('period') ?? 60);
            if (view === 'period' && heldPeriodResponse?.period === period) await heldPeriodResponse.promise;
            response.end(JSON.stringify(activity.snapshot(view, period)));
            return;
          }
          if ((!recording && !attentionPreview && !verifyAppSetup) || request.method !== 'POST' || request.headers.origin !== origin || request.headers['x-router-csrf'] !== data.csrf || !request.headers['content-type']?.startsWith('application/json')) throw new Error('Request denied');
          let text = '';
          for await (const chunk of request) { text += chunk; if (text.length > 1048576) throw new Error('Request too large'); }
          const result = demo.mutate(request.url, JSON.parse(text || '{}'));
          const removed = request.url.match(/^\/connections\/([a-z0-9-]+)\/delete$/);
          if (removed) activity.forgetConnection(removed[1]);
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
  ipcMain.handle('demo-client-status', event => { if (!allowed(event)) throw new Error('Denied'); return verifyDirect ? demoClients : clients.status(); });
  ipcMain.handle('demo-connect-client', (event, id) => { if (!allowed(event)) throw new Error('Denied'); return clients.connect(id); });
  let copiedConfig;
  if (verifyAppSetup) ipcMain.handle('verify-copy-config', (event, format) => {
    if (!allowed(event)) throw new Error('Denied');
    copiedConfig = clients.configuration(format);
  });
  let publisherVisits = 0, mainWindowVisits = 0;
  ipcMain.handle('demo-open-main-window', event => { if (!allowed(event)) throw new Error('Denied'); mainWindowVisits++; showMain(); });
  ipcMain.handle('demo-open-publisher', async event => {
    if (!allowed(event)) throw new Error('Denied');
    publisherVisits++;
    if (recording) await shell.openExternal('https://kvalifik.dk');
  });
  ipcMain.on('demo-hide-panel', event => { if (allowed(event) && event.sender === popover?.webContents) popover.hide(); });
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
  let lastMenuItems, openedNotes;
  let demoUpdate = {state:'current'};
  ipcMain.handle('demo-check-updates', (event, manual) => {
    if (!allowed(event)) throw new Error('Denied');
    return manual ? demoUpdate : {state:'current'};
  });
  ipcMain.handle('demo-update-notes', (event, version) => {
    if (!allowed(event) || version !== demoUpdate.version) throw new Error('Denied');
    openedNotes = version;
  });
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
      lastMenuItems = request.items;
      const contains = items => items.some(item => item.children ? contains(item.children) : item.id===id&&!item.disabled);
      if(!contains(request.items))throw new Error('Verification menu item missing');
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
  const evaluate = async code => {
    try { return await window.webContents.executeJavaScript(code); }
    catch (cause) { throw new Error('Demo renderer check failed near ' + code.trim().slice(0,140), {cause}); }
  };
  async function waitFor(selector) {
    for (let attempt = 0; attempt < 100; attempt++) {
      if (await evaluate(`!!document.querySelector(${JSON.stringify(selector)})`)) return;
      await new Promise(resolve => setTimeout(resolve, 100));
    }
    const focus = await evaluate(`({active:document.activeElement?.getAttribute('aria-label') || document.activeElement?.tagName,windowFocused:document.hasFocus(),dialog:document.querySelector('[data-slot="dialog-title"]')?.textContent})`);
    throw new Error(`UI did not render: ${selector} (${JSON.stringify(focus)})`);
  }
  const click = selector => evaluate(`document.querySelector(${JSON.stringify(selector)}).click()`);
  async function capture(name) {
    if (verifyAttention || (verifyActivity || verifyDirect) && !name.startsWith('/')) return;
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
  await waitFor('[aria-label="Router activity: 12 calls per minute"]');
  await capture('project-overview.png');
  async function saveView(name) {
    await evaluate('document.fonts.ready.then(() => true)');
    await new Promise(resolve => setTimeout(resolve, 300));
    await writeFile(join(tmpdir(), 'mcp-router-activity-' + name + '.png'), (await window.webContents.capturePage()).toPNG());
  }
  async function verifyDialogAlignment() {
    const alignment = await evaluate(`(async () => {
      const dialog = document.querySelector('.dialog-shell');
      await Promise.all(dialog.getAnimations().map(animation => animation.finished.catch(() => {})));
      const row = dialog.querySelector('[data-slot="dialog-title-row"]');
      const close = row.querySelector('[data-slot="dialog-close"]');
      const rect = close.getBoundingClientRect();
      const center = box => box.top + box.height / 2;
      const right = dialog.getBoundingClientRect().left + dialog.clientLeft + dialog.clientWidth - parseFloat(getComputedStyle(dialog).paddingRight);
      const icon = close.querySelector('svg').getBoundingClientRect();
      const aligned = dialog.querySelectorAll('[data-slot="dialog-close"]').length === 1
        && rect.width === 28 && rect.height === 28 && Math.abs(rect.right - right) <= 1
        && Math.abs(center(icon) - center(rect)) < .6 && Math.abs(icon.left + icon.width / 2 - rect.left - rect.width / 2) < .6
        && [...row.querySelectorAll('h2, button')].filter(el => el.getBoundingClientRect().width > 1)
          .every(el => Math.abs(center(el.getBoundingClientRect()) - center(rect)) < .6);
      return aligned ? 'ok' : JSON.stringify({title:row.innerText, width:rect.width,height:rect.height,trailing:rect.right-right,icon:center(icon)-center(rect)});
    })()`);
    if (alignment !== 'ok') throw new Error('Dialog header alignment: ' + alignment);
  }
  async function verifyDialogEdges() {
    await verifyDialogAlignment();
    const result = await evaluate(`(async () => {
      const dialog = document.querySelector('.dialog-shell');
      const area = dialog.querySelector('.dialog-scroll');
      const settle = async () => {
        await new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)));
        await Promise.all(area.getAnimations().map(animation => animation.finished.catch(() => {})));
      };
      const previousHeight = area.style.maxHeight;
      const previousTop = area.scrollTop;
      try {
        await settle();
        const css = getComputedStyle(area);
        const flush = area.parentElement === dialog && (!area.nextElementSibling || area.nextElementSibling.matches('[data-slot="dialog-close"]'));
        const transparent = 'rgba(0, 0, 0, 0)';
        if (!area.hasAttribute('data-scrollable') && (css.borderTopColor !== transparent || css.borderBottomColor !== transparent)) return 'rules on content that fits';
        // Short lists normally fit. Constrain the demo viewport to exercise both boundaries.
        if (area.scrollHeight <= area.clientHeight + 4) area.style.maxHeight = '48px';
        await settle();
        const distance = area.scrollHeight - area.clientHeight;
        if (distance < 4) return 'fixture does not overflow';
        for (const top of [0, distance / 2, distance]) {
          area.scrollTop = top;
          await settle();
          if (css.maskImage !== 'none' || css.borderTopWidth !== '1px' || css.borderBottomWidth !== (flush ? '0px' : '1px')
              || css.borderTopColor === transparent || (!flush && css.borderTopColor !== css.borderBottomColor)) return 'incorrect separators at ' + top;
          if (top === 0 && area.firstElementChild.getBoundingClientRect().top < area.getBoundingClientRect().top + 8) return 'first row needs padding';
          if (top === distance && area.lastElementChild.getBoundingClientRect().bottom > area.getBoundingClientRect().bottom - 8) return 'last row needs padding';
        }
        const bounds = area.getBoundingClientRect(), shell = dialog.getBoundingClientRect();
        return Math.abs(bounds.left - shell.left) <= 2 && Math.abs(bounds.right - shell.right) <= 2 ? 'ok' : 'scrollport is inset';
      } finally { area.style.maxHeight = previousHeight; area.scrollTop = previousTop; await settle(); }
    })()`);
    if (result !== 'ok') throw new Error('Dialog scroll edges: ' + result);
  }
  async function verifyModalControls() {
    const ok = await evaluate(`(() => {
      const controls = document.querySelectorAll('.app-header button, .app-publisher a');
      return !!document.querySelector('main[inert]') && [...controls].every(control => {
        const rect = control.getBoundingClientRect();
        if (!rect.width) return true;
        return !control.disabled && !control.closest('[inert],[aria-hidden="true"]')
          && control.contains(document.elementFromPoint(rect.x + rect.width/2, rect.y + rect.height/2));
      });
    })()`);
    if (!ok) throw new Error('An open dialog must leave the toolbar usable and the project list inert');
  }
  if (verifyActivity) {
    const verify = async (expression, message) => {
      if (!await evaluate(expression)) throw new Error('Activity UI: ' + message);
    };
    const nextPaint = () => evaluate('new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)))');
    const resize = async (width, height) => { window.setContentSize(width, height); await nextPaint(); };
    async function verifyTypography(compact) {
      await evaluate('document.fonts.ready.then(() => true)');
      const expectedDisplay = compact ? 'Denton' : 'Denton Condensed';
      const renderer = window.webContents.debugger;
      renderer.attach();
      try {
        await renderer.sendCommand('DOM.enable');
        await renderer.sendCommand('CSS.enable');
        const {root} = await renderer.sendCommand('DOM.getDocument');
        for (const [selector, family] of [['.app-publisher > span', 'Manrope'], ['.app-header h1', 'Denton'], ['.activity-heading h2', expectedDisplay]]) {
          const {nodeId} = await renderer.sendCommand('DOM.querySelector', {nodeId:root.nodeId, selector});
          const {fonts} = await renderer.sendCommand('CSS.getPlatformFontsForNode', {nodeId});
          const actual = fonts.filter(f => f.glyphCount).map(f => f.postScriptName);
          const available = family === 'Manrope' || await evaluate(`document.fonts.check('100 30px "${family}"')`);
          if (!actual.length || available && !actual.some(name => name.startsWith(family.replaceAll(' ', '')))) {
            throw new Error(`Expected ${family} on ${selector}, rendered ${actual.join(', ')}`);
          }
          console.log(`${compact ? 'Compact' : 'Desktop'} ${selector} rendered in ${actual.join(', ')}`);
        }
      } finally { renderer.detach(); }
      await verify(`(() => {
        const title = getComputedStyle(document.querySelector('.activity-heading h2'));
        const section = getComputedStyle(document.querySelector('.app-header h1'));
        const byline = getComputedStyle(document.querySelector('.app-publisher'));
        const close = (a,b) => Math.abs(parseFloat(a) - b) < .02;
        const progress = Math.max(0, Math.min(1, (innerWidth - 400) / (1440 - 400)));
        return title.fontWeight === '100' && byline.fontWeight === '${compact ? 400 : 425}'
          && close(title.fontSize, .6 * (30 + 20 * progress))
          && close(section.fontSize, .6 * (26 + 4 * progress))
          && close(byline.letterSpacing, parseFloat(byline.fontSize) * ${compact ? .02 : .01})
          && close(title.lineHeight, parseFloat(title.fontSize) * ${compact ? 1.1 : 1});
      })()`, 'responsive heading sizes and leading, text weight and small text tracking');
    }
    const verifyHeader = async () => {
      await verifyBars('.activity-pulse i');
      await verify(`(() => {
        const group = document.querySelector('.app-header-actions');
        const buttons = [...group.querySelectorAll('button')].map(b => b.getBoundingClientRect()).filter(r => r.width);
        const pulse = document.querySelector('.activity-pulse').getBoundingClientRect();
        return pulse.height === 32 && buttons.every(b => b.top === pulse.top && b.bottom === pulse.bottom)
          && group.getBoundingClientRect().right <= innerWidth
          && group.getBoundingClientRect().left >= document.querySelector('.app-header > div').getBoundingClientRect().right;
      })()`, 'header controls must fit and have identical vertical bounds');
    };
    await resize(640,640);
    await waitFor('.app-header-actions .activity-pulse');
    await verifyHeader();
    const verifyDesktopRate = () => verify("document.querySelector('.activity-pulse').innerText.trim() === '12/min'", 'short desktop rate');
    async function verifyBars(selector) {
      if (selector === '.activity-bar') await waitFor('.activity-bar-layer:only-of-type');
      await verify(`(() => {
        const bars = [...document.querySelectorAll('${selector}')].filter(bar => bar.getBoundingClientRect().width > 0);
        const rects = bars.map(bar => bar.getBoundingClientRect());
        const pixel = value => Math.round(value * devicePixelRatio);
        const paintedWidth = rect => pixel(rect.right) - pixel(rect.left);
        if (rects.length < 2 || !rects.every(rect => rect.width === rects[0].width && Number.isInteger(rect.width)
            && paintedWidth(rect) === paintedWidth(rects[0]))) return false;
        return bars.length > 1 && bars.every(bar => {
          const style = getComputedStyle(bar);
          return style.backgroundColor === 'rgb(207, 191, 243)' && parseFloat(style.borderTopLeftRadius) > 0
            && style.borderTopLeftRadius === style.borderBottomRightRadius;
        });
      })()`, 'rounded lavender bars at ' + selector);
    }
    async function verifyDayContrast() {
      await waitFor('.rhythm-grid button[aria-current="date"]');
      await verify(`(() => {
        const ctx = document.createElement('canvas').getContext('2d', {willReadFrequently: true});
        const luminance = color => {
          ctx.fillStyle = color;
          ctx.fillRect(0,0,1,1);
          const channels = Array.from(ctx.getImageData(0,0,1,1).data).slice(0,3).map(n => n / 255)
            .map(n => n <= .04045 ? n / 12.92 : ((n + .055) / 1.055) ** 2.4);
          return channels[0] * .2126 + channels[1] * .7152 + channels[2] * .0722;
        };
        return [...document.querySelectorAll('.rhythm-grid button:enabled')].every(button => {
          const style = getComputedStyle(button);
          const a = luminance(style.color), b = luminance(style.backgroundColor);
          return (Math.max(a,b) + .05) / (Math.min(a,b) + .05) >= 4.5;
        });
      })()`, 'weekly totals stay readable across the full lavender scale');
    }
    const verifySwitchColors = () => verify(`(() => {
      const color = element => getComputedStyle(element).backgroundColor;
      const accent = color(document.querySelector('.activity-pulse i'));
      const switches = [...document.querySelectorAll('main:not([hidden]) [role="switch"]')];
      const on = switches.filter(s => s.getAttribute('aria-checked') === 'true');
      const off = switches.filter(s => s.getAttribute('aria-checked') === 'false');
      return accent === 'rgb(207, 191, 243)' && on.length > 1 && on.every(s => color(s) === accent && color(s.firstElementChild) !== accent)
        && off.length > 0 && off.every(s => color(s) !== accent);
    })()`, 'checked switches use the graph color and unchecked switches have a neutral track');
    const bars = '.activity-columns button';
    const pressedBar = bars + '[aria-pressed="true"]';
    async function verifyBreakdown(count, source, selected = false) {
      const detail = await evaluate(`(() => {
        const card = document.querySelector('.activity-breakdown');
        return {
          count:card.querySelector('.activity-card-head span').textContent,
          sources:card.textContent,
          selected:document.querySelectorAll('.activity-columns [aria-pressed="true"]').length
        };
      })()`);
      assert.equal(detail.count, count + (count === 1 ? ' call' : ' calls'));
      assert.ok(detail.sources.includes(source), 'breakdown includes ' + source);
      assert.equal(detail.selected, selected ? 1 : 0);
    }
    await verifyDesktopRate();
    await resize(400,560);
    await verifyHeader();
    await saveView('header-compact-light');
    await resize(860,640);
    await verifyHeader();
    await verifyDesktopRate();
    await verifySwitchColors();
    await evaluate("document.querySelector('[aria-label=\"β Beta settings for Paper Moon Journal\"]').focus()");
    const focusInput = window.webContents.debugger;
    focusInput.attach();
    try {
      for (const type of ['keyDown', 'keyUp']) await focusInput.sendCommand('Input.dispatchKeyEvent', {type, key:'Tab', code:'Tab', windowsVirtualKeyCode:9});
    } finally { focusInput.detach(); }
    await waitFor('.project-access-badge[aria-label^="No publishing"]:focus-visible');
    await saveView('badge-focus');
    await verify(`(() => {
      const css = getComputedStyle(document.activeElement);
      return css.outlineStyle === 'none' && css.boxShadow.includes('2px') && css.boxShadow.includes('rgb(161, 161, 170)');
    })()`, 'a focused permission badge has one neutral keyboard ring');
    await evaluate('document.activeElement.blur()');
    await saveView('header');
    await click('.app-header-actions .activity-pulse');
    await waitFor('.activity-dialog .activity-chart[aria-label="Calls per 5 seconds"]');
    await verify("document.querySelector('.activity-pulse').getAttribute('aria-expanded') === 'true' && !document.querySelector('[data-slot=popover-content]')", 'one click opens the dialog');
    await verifyBreakdown(12, 'Juniper & Kite8');
    await saveView('period');
    // Hover and arrow navigation may reveal a label or move focus. Only explicit
    // activation should change the breakdown, including for keyboard users.
    const burst = bars + '[aria-label$="3 calls"]';
    const pointer = await evaluate("(() => { const r = document.querySelector(" + JSON.stringify(burst) + ").getBoundingClientRect(); return {x:r.x+r.width/2,y:r.y+r.height/2}; })()");
    const input = window.webContents.debugger;
    input.attach();
    try {
      await input.sendCommand('Input.dispatchMouseEvent', {type:'mouseMoved', ...pointer});
      await waitFor(burst + ':hover');
      await verifyBreakdown(12, 'Juniper & Kite8');
      await evaluate("document.querySelector(" + JSON.stringify(burst) + ").focus()");
      for (const [key, code, number] of [['ArrowRight','ArrowRight',39], ['ArrowLeft','ArrowLeft',37]]) {
        for (const type of ['keyDown','keyUp']) await input.sendCommand('Input.dispatchKeyEvent', {type,key,code,windowsVirtualKeyCode:number});
        await waitFor(key === 'ArrowRight' ? burst + ' + button:focus' : burst + ':focus');
      }
      await verifyBreakdown(12, 'Juniper & Kite8');
      for (const [key, code, number, text] of [['Enter','Enter',13,'\r'], [' ','Space',32,' ']]) {
        await input.sendCommand('Input.dispatchKeyEvent', {type:'keyDown', key, code, text, windowsVirtualKeyCode:number});
        await input.sendCommand('Input.dispatchKeyEvent', {type:'keyUp', key, code, windowsVirtualKeyCode:number});
        await waitFor(burst + '[aria-pressed="' + (key === 'Enter') + '"]');
        if (key === 'Enter') await verifyBreakdown(3, 'Juniper & Kite3', true);
        else await verifyBreakdown(12, 'Juniper & Kite8');
      }
      await input.sendCommand('Input.dispatchMouseEvent', {type:'mouseMoved', x:5, y:200});
    } finally { input.detach(); }
    await click(burst);
    await verifyBreakdown(3, 'Juniper & Kite3', true);
    // Keep the response pending across paints. The pinned table must survive
    // even if a second duration wins the race before the first one responds.
    await evaluate("document.querySelector('.activity-breakdown').dataset.continuity = 'marked'");
    heldPeriodResponse = {period:300, ...Promise.withResolvers()};
    try {
      await click('.activity-periods button:nth-child(2)');
      await nextPaint();
      await verifyBreakdown(3, 'Juniper & Kite3', true);
      await verify("!!document.querySelector('.activity-breakdown[data-continuity][aria-busy=true]')", 'pending duration keeps the table mounted');
      await click(pressedBar);
      await verifyBreakdown(12, 'Last minute');
      await click('.activity-periods button:last-child');
      await waitFor('.activity-chart[aria-label="Calls per minute"]');
      await verifyBreakdown(179, 'Last 15 minutes');
    } finally {
      heldPeriodResponse.resolve();
      heldPeriodResponse = null;
    }
    await nextPaint();
    await verify("!!document.querySelector('.activity-breakdown[data-continuity][aria-busy=false]')", 'duration changes update the same table');
    await verifyBreakdown(179, 'Last 15 minutes');
    const media = window.webContents.debugger;
    const setMotion = value => media.sendCommand('Emulation.setEmulatedMedia', {features:[{name:'prefers-reduced-motion', value}]});
    media.attach();
    try {
      for (const [index, preference] of [[0,'no-preference'],[1,'reduce']]) {
        await setMotion(preference);
        await waitFor('.activity-bar-layer:only-of-type');
        const transition = await evaluate(`(async () => {
          const table = document.querySelector('.activity-breakdown');
          const old = document.querySelector('.activity-bar-layer');
          const target = document.querySelectorAll('.activity-periods button')[${index}];
          const expected = ${index} === 0 ? 'Calls per 5 seconds' : 'Calls per 30 seconds';
          target.click();
          let blended = false;
          for (let frame = 0; frame < 180; frame++) {
            await new Promise(resolve => requestAnimationFrame(resolve));
            const layers = [...document.querySelectorAll('.activity-bar-layer')];
            if (document.querySelector('.activity-breakdown') !== table) return 'table remounted';
            if (layers.length > 1 && layers.every(layer => {
              const opacity = Number(getComputedStyle(layer).opacity);
              return opacity > 0 && opacity < 1;
            })) blended = true;
            if (!old.isConnected && layers.length === 1 && document.querySelector('.activity-chart').getAttribute('aria-label') === expected) {
              return blended ? 'blended' : 'instant';
            }
          }
          return 'timed out';
        })()`);
        assert.equal(transition, preference === 'reduce' ? 'instant' : 'blended');
      }
    } finally { media.detach(); }
    await waitFor('.activity-chart[aria-label="Calls per 30 seconds"]');
    await verifyBreakdown(47, 'Juniper & Kite35');
    await verifyBars('.activity-bar');
    await click(bars + ':last-child');
    await verifyBreakdown(4, 'Paper Moon Journal4', true);
    await click(pressedBar);
    await verifyBreakdown(47, 'Juniper & Kite35');
    await click('.activity-periods button:last-child');
    await waitFor('.activity-chart[aria-label="Calls per minute"]');
    await verifyBreakdown(179, 'Last 15 minutes');
    await verifyDesktopRate();
    await verifyModalControls();
    await verify("document.querySelector('[role=dialog] .activity-columns') && document.querySelector('main .project-row').getClientRects().length > 0", 'activity opens over the project list');
    await verifyTypography(false);
    await verifyBars('.activity-bar');
    await verifyDayContrast();
    await verifyDialogEdges();
    await click(bars + '[aria-label$="24 calls"]');
    await verifyBreakdown(24, 'Juniper & Kite16', true);
    await saveView('minutes');
    await evaluate(`(() => {
      const area = document.querySelector('.activity-page');
      const row = area.querySelector('.activity-source');
      area.scrollTop += row.getBoundingClientRect().top - area.getBoundingClientRect().top + 3;
    })()`);
    await saveView('scroll-rules');
    await evaluate("document.querySelector('.activity-page').scrollTop = 0");
    await click(bars + ':last-child');
    await verifyBreakdown(12, 'Juniper & Kite8', true);
    activity.begin('studio', 'demo-project-0')(true);
    await waitFor('.activity-pulse[aria-label*="13 calls per minute"]');
    await verifyBreakdown(12, 'Juniper & Kite8', true);
    await click(pressedBar);
    await waitFor('.activity-columns button:last-child[aria-label$="13 calls"]');
    await verifyBreakdown(180, 'Last 15 minutes');
    await waitFor('.rhythm-grid');
    const scrollToWeek = () => evaluate("document.querySelector('.activity-weekly').scrollIntoView({block:'start'})");
    await scrollToWeek();
    await verify("document.querySelector('.activity-page').scrollTop > 0 && document.querySelectorAll('.rhythm-grid tbody tr').length === 4 && document.querySelector('.activity-weekly .activity-subtitle').textContent.includes('4 weeks')", 'scroll to weekly calendar and streak');
    await click('.rhythm-grid tbody tr:first-child td button');
    await verify("document.querySelector('.activity-weekly .activity-card-head').textContent.includes('3 calls')", 'selecting a day');
    await saveView('weeks');
    nativeTheme.themeSource = 'dark';
    await resize(400,560);
    await waitFor('html.dark');
    await verifyModalControls();
    await verifyTypography(true);
    await verifyBars('.activity-bar');
    await verifyDayContrast();
    await verifyDialogEdges();
    await scrollToWeek();
    await verify("document.querySelector('.rhythm-grid').getBoundingClientRect().right <= innerWidth", 'compact calendar fits');
    // Exercise a first-use week on any weekday, including a Sunday demo run.
    const tileBoxes = await evaluate(`(() => {
      const calendar = document.querySelector('.rhythm-grid').cloneNode(true);
      document.querySelector('.rhythm-grid').after(calendar);
      try {
        const buttons = [...calendar.tBodies[0].rows[3].querySelectorAll('button')];
        buttons.forEach((button, i) => {
          button.textContent = i === 0 ? '—' : i === 1 ? '9' : '';
          button.disabled = i !== 1;
          button.setAttribute('aria-pressed', String(i === 1));
          button.dataset.future = String(i > 1);
        });
        return buttons.map(button => {
          const {top, bottom} = button.getBoundingClientRect();
          return [top, bottom];
        });
      } finally { calendar.remove(); }
    })()`);
    if (tileBoxes.some(([top, bottom]) => Math.abs(top - tileBoxes[1][0]) > 0.5 || Math.abs(bottom - tileBoxes[1][1]) > 0.5)) {
      throw new Error('Activity UI: weekly tiles have different vertical bounds: ' + JSON.stringify(tileBoxes));
    }
    await saveView('weeks-compact-dark');
    await evaluate("document.querySelector('.activity-page').scrollTop = 0");
    await saveView('minutes-compact-dark');
    await click('.activity-dialog [data-slot="dialog-close"]');
    await waitFor('body:not(:has(.activity-dialog))');
    await nextPaint();
    await verify("document.activeElement.matches('.activity-pulse:enabled')", 'closing Activity restores focus to its toolbar button');
    await verify("[...document.querySelectorAll('.app-header-actions button')].every(button => !button.disabled)", 'toolbar controls remain available after closing Activity');
    await waitFor('.app-header-actions .activity-pulse[aria-label*="13 calls per minute"]');
    await verifyHeader();
    await verifySwitchColors();
    await verify(`(() => {
      const pulse = document.querySelector('.activity-pulse');
      const visible = [...pulse.children].filter(child => child.getClientRects().length);
      return pulse.innerText.trim() === ''
        && visible.length === 2 && visible[0].matches('.activity-spark') && visible[1].matches('svg.lucide-chevron-down')
        && visible[0].children.length === 7 && [...visible[0].children].every(bar => bar.getBoundingClientRect().height >= 3)
        && visible[0].getBoundingClientRect().left >= pulse.getBoundingClientRect().left + 7
        && visible[1].getBoundingClientRect().right <= pulse.getBoundingClientRect().right - 7
        && visible[1].getBoundingClientRect().left >= visible[0].getBoundingClientRect().right + 4
        && pulse.title === 'Router activity: 13 calls per minute' && pulse.getAttribute('aria-label') === pulse.title;
    })()`, 'compact graph and chevron with an accessible rate');
    await verify("document.querySelector('.app-publisher').getBoundingClientRect().top < document.querySelector('.app-header h1').getBoundingClientRect().bottom", 'compact title and byline fit on one line');
    await verify("document.querySelector('[aria-label=\"Collapse Example Studio\"]') !== null", 'expanded projects survive navigation');
    await evaluate('document.activeElement.blur()');
    await saveView('header-compact-dark');
    await click('.activity-pulse');
    await waitFor('.activity-dialog .activity-chart[aria-label="Calls per 5 seconds"]');
    await verifyBreakdown(13, 'Juniper & Kite9');
    await click('.activity-periods button:nth-child(2)');
    await waitFor('.activity-chart[aria-label="Calls per 30 seconds"]');
    await verifyBreakdown(48, 'Juniper & Kite36');
    await verify("document.querySelector('.activity-periods').getBoundingClientRect().right < document.querySelector('.activity-dialog [data-slot=dialog-close]').getBoundingClientRect().left", 'compact range picker fits beside close');
    await evaluate('document.activeElement.blur()');
    await saveView('period-compact-dark');
    await click('.activity-pulse');
    await waitFor('body:not(:has(.activity-dialog))');
    nativeTheme.themeSource = 'light';
    await resize(860,640);
    await waitFor('html:not(.dark)');
    await evaluate('document.activeElement.blur()');
    advanceTime(60000);
    await waitFor('.activity-pulse[aria-label="Router activity: Idle"]');
    await evaluate('document.activeElement.blur()');
    for (const width of [860, 640, 400]) {
      await resize(width, 560);
      await verifyHeader();
      await verify(`(async () => {
        const button = document.querySelector('.activity-pulse');
        const plot = [...button.querySelectorAll('.activity-spark')].find(el => el.getClientRects().length);
        await Promise.all(plot.getAnimations({subtree:true}).map(animation => animation.finished));
        const dots = [...plot.children].map(dot => dot.getBoundingClientRect());
        const chevron = button.querySelector('svg').getBoundingClientRect();
        const box = button.getBoundingClientRect(), center = box.top + box.height / 2;
        return plot.hasAttribute('data-empty') && getComputedStyle(plot).borderBottomWidth === '0px'
          && dots.length === ${width > 780 ? 13 : 7} && dots.every((dot, i) => dot.width === 3 && dot.height === 3
            && Math.abs(dot.top + dot.height / 2 - center) < .6 && (!i || Math.abs(dot.left - dots[i-1].right - 2) < .1))
          && dots[0].left >= box.left + 7 && chevron.left >= dots.at(-1).right + 4 && chevron.right <= box.right - 7;
      })()`, 'idle dots, spacing and chevron at width ' + width);
      if (width !== 640) await saveView(width === 400 ? 'idle-compact' : 'idle-desktop');
    }
    advanceTime(1000); // The fixture clock is now on an exact minute boundary.
    const finishFirst = activity.begin('studio', 'demo-project-0');
    await waitFor('.activity-pulse[data-running][title="Router activity: 0 calls per minute · 1 in progress"]');
    await verify("document.querySelector('.activity-pulse').innerText.trim() === ''", 'compact running state stays bars-only');
    await resize(860,560);
    await verify("document.querySelector('.activity-pulse').innerText.trim() === '0/min'", 'running count stays in the tooltip');
    const runningWidth = await evaluate(`(async () => {
      const button = document.querySelector('.activity-pulse');
      await Promise.all(button.getAnimations().map(animation => animation.finished));
      return button.getBoundingClientRect().width;
    })()`);
    media.attach();
    try {
      for (const preference of ['no-preference','reduce']) {
        await setMotion(preference);
        await nextPaint();
        const cue = await evaluate(`(() => {
          const bars = [...document.querySelectorAll('.activity-spark-toolbar i')];
          const last = getComputedStyle(bars.pop());
          return [bars.every(b => getComputedStyle(b).animationName === 'none'), last.animationName, last.boxShadow !== 'none'];
        })()`);
        assert.deepEqual(cue, [true, preference === 'reduce' ? 'none' : 'activity-running', true]);
      }
    } finally { media.detach(); }
    finishFirst(true);
    await waitFor('.activity-pulse[aria-label="Router activity: 1 call per minute"] .activity-spark-compact:not([data-empty])');
    assert.equal(await evaluate("document.querySelector('.activity-pulse').getBoundingClientRect().width"), runningWidth);
    await resize(400,560);
    // Completions at :00, :02, :09 and :12. Both plots must preserve these
    // bursts while the desktop crosses a boundary ahead of the compact plot.
    for (const delay of [2000, 7000, 3000]) {
      advanceTime(delay);
      activity.begin('studio', 'demo-project-0')(true);
    }
    await waitFor('.activity-pulse[aria-label="Router activity: 4 calls per minute"]');
    const activeHeights = () => evaluate(`Array.from(document.querySelectorAll('.activity-pulse .activity-spark'),
      plot => Array.from(plot.children, bar => parseFloat(bar.style.height)).filter(height => height > 0))`);
    const before = await activeHeights();
    const single = before[0].at(-1);
    assert.deepEqual(before.map(bars => bars.length), [3,2]);
    assert.ok(before[1][0] > before[0][0] && before[0][0] > single && single > 0);
    assert.equal(before[0][1], single);
    assert.equal(before[1][1], single);
    await evaluate(`document.querySelectorAll('.activity-pulse .activity-spark').forEach(plot => {
      plot.lastElementChild.dataset.testInterval = 'marked';
    })`);
    advanceTime(4000);
    await waitFor('.activity-spark-toolbar [data-test-interval]:nth-last-child(2)');
    await verify("!!document.querySelector('.activity-spark-compact [data-test-interval]:last-child')", 'compact interval stays put across a five-second tick');
    assert.deepEqual(await activeHeights(), before);
    advanceTime(53000);
    await waitFor('.activity-pulse[aria-label="Router activity: 1 call per minute"]');
    assert.deepEqual(await activeHeights(), [[single],[single]], 'expiring a larger burst must not inflate a surviving bar');
    advanceTime(3000);
    await waitFor('.activity-pulse[aria-label="Router activity: Idle"]');
    await resize(860,640);
    console.log('Verified direct toolbar entry, all period totals and sources, hover and keyboard focus, click-to-filter and clear, compact layout, weekly rhythm and return to projects.');
  }
  await click('[aria-label="Settings for Juniper & Kite"]');
  await waitFor('.permission-dialog [data-slot="dialog-footer"] button:last-child');
  await verifyDialogAlignment();
  await capture('project-permissions.png');
  if (verifyDirect) {
    const read = '[aria-label="Read Library data"]', manage = '[aria-label="Share, install and manage Libraries"]';
    const before = await evaluate(`[document.querySelector('${read}').ariaChecked,document.querySelector('${manage}').ariaChecked]`);
    await click(manage);
    assert.ok(await evaluate("document.querySelector('.permission-scroll').scrollWidth <= document.querySelector('.permission-scroll').clientWidth + 1"), 'Library explanations fit the permissions list');
    assert.deepEqual(await evaluate(`[document.querySelector('${read}').ariaChecked,document.querySelector('${manage}').ariaChecked]`),[before[0],String(before[1] !== 'true')]);
    await click(manage);
  }
  if (verifyActivity) {
    await verifyModalControls();
    async function verifyDialogActions() {
      const result = await evaluate(`(async () => {
        const dialog = document.querySelector('.permission-dialog');
        const save = dialog.querySelector('[data-slot="dialog-footer"] button:last-child');
        await Promise.all(save.getAnimations().map(animation => animation.finished));
        const menus = dialog.querySelectorAll('button[aria-haspopup="menu"]');
        const primary = getComputedStyle(save);
        const cancel = getComputedStyle(save.previousElementSibling);
        if (getComputedStyle(save.closest('[data-slot="dialog-footer"]')).borderTopWidth !== '0px') return 'extra separator above the permission actions';
        const dark = document.documentElement.classList.contains('dark');
        if (primary.backgroundColor !== (dark ? 'rgb(69, 58, 82)' : 'rgb(215, 201, 244)')
            || primary.color !== (dark ? 'rgb(244, 238, 251)' : 'rgb(63, 50, 77)')
            || primary.borderTop !== '1px solid rgba(0, 0, 0, 0.08)' || primary.backgroundClip !== 'border-box')
          return 'primary button appearance: ' + [primary.backgroundColor, primary.color, primary.borderTop, primary.backgroundClip].join(' / ');
        if (primary.boxShadow === 'none' || primary.boxShadow !== cancel.boxShadow || primary.height !== cancel.height) return 'button elevation or height differs: ' + [primary.boxShadow, cancel.boxShadow, primary.height, cancel.height].join(' / ');
        return menus.length === 2 && [...menus].every(b => !b.disabled) ? 'ok' : 'dialog dropdown unavailable';
      })()`);
      if (result !== 'ok') throw new Error('Dialog actions: ' + result);
    }
    await verifyDialogActions();
    await saveView('permissions');
    nativeTheme.themeSource = 'dark';
    await waitFor('html.dark');
    await verifyDialogActions();
    await saveView('permissions-dark');
    nativeTheme.themeSource = 'light';
    await waitFor('html:not(.dark)');
  }
  if (attentionPreview) {
    const assertUI = async (expression, message) => {
      if (!await evaluate(expression)) throw new Error(`Access UI regression: ${message}`);
    };
    const loadDemo = async () => { await window.loadURL(origin); await waitFor('[aria-label="Expand Example Studio"]'); };
    const projectBadge = '[aria-label="Access needs attention for Paper Moon Journal"]';
    const connectionBadge = '[aria-label="Access needs attention for Example Studio"]';
    const dismiss = async () => { await click('[data-slot="dialog-close"]'); await new Promise(resolve=>setTimeout(resolve,250)); };
    if (verifyDirect) {
      const input = window.webContents.debugger;
      input.attach();
      try {
        const waitForVisit = async (read, before, message) => {
          for (let i=0; i<50 && read() === before; i++) await new Promise(resolve => setTimeout(resolve,20));
          if (read() !== before + 1) throw new Error(message);
        };
        const press = async (key, code) => {
          for (const type of ['keyDown','keyUp']) await input.sendCommand('Input.dispatchKeyEvent',{type,key,code:key,windowsVirtualKeyCode:code});
        };
        const hit = async selector => {
          const point = await evaluate(`(async () => {
            for (let i=0; i<60; i++) {
              await new Promise(resolve => requestAnimationFrame(resolve));
              const control = [...document.querySelectorAll(${JSON.stringify(selector)})].find(el => el.checkVisibility());
              if (!control) continue;
              const r = control.getBoundingClientRect(), x = r.x + r.width/2, y = r.y + r.height/2;
              if (control.contains(document.elementFromPoint(x,y))) return {x,y};
            }
            return null;
          })()`);
          if (!point) throw new Error('Covered toolbar or dialog control: ' + selector);
          for (const type of ['mousePressed','mouseReleased']) await input.sendCommand('Input.dispatchMouseEvent',{type,...point,button:'left',clickCount:1});
        };
        const draft = '.permission-dialog .permission-scroll [role="switch"]';
        const original = await evaluate(`document.querySelector('${draft}').getAttribute('aria-checked')`);
        await hit(draft);
        for (const width of [860,400]) {
          window.setContentSize(width,560);
          await evaluate('new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)))');
          await verifyModalControls();
          const visits = publisherVisits;
          await hit('.app-publisher a');
          await waitForVisit(() => publisherVisits, visits, 'Kvalifik link did not reach the desktop bridge');
          verificationMenuSelection='copy-standard';
          await hit('.app-client-menu');
          await waitFor('[aria-label="Dismiss notification"]');
          await hit('[aria-label="Dismiss notification"]');
          await hit('.activity-pulse');
          await waitFor('.activity-dialog .activity-columns');
          if (width === 860) {
            const corner = await evaluate("document.querySelector('.router-workspace').getBoundingClientRect().top + 5");
            for (const type of ['mousePressed','mouseReleased']) await input.sendCommand('Input.dispatchMouseEvent',{type,x:5,y:corner,button:'left',clickCount:1});
          } else {
            await press('Escape',27);
          }
          await waitFor('body:not(:has(.activity-dialog))');
          await assertUI("document.querySelector('.permission-dialog')?.checkVisibility()", 'closing Activity returns to the unsaved form');
          verificationMenuSelection='about';
          await hit('.app-settings-menu');
          await waitFor('.dialog-scroll [href*="github.com"]');
          await press('Escape',27);
          await waitFor('body:not(:has(.dialog-scroll [href*="github.com"]))');
          if (width === 400) {
            const visits = mainWindowVisits;
            await hit('[aria-label="Open main window"]');
            await waitForVisit(() => mainWindowVisits, visits, 'Compact expand did not open the main window');
          }
          await assertUI(`document.querySelector('${draft}').checkVisibility() && document.querySelector('${draft}').getAttribute('aria-checked') !== '${original}'`,
            'returning from Activity, About, and toolbar actions must preserve the pending permission change');
          await evaluate(`document.querySelector('.permission-dialog [data-slot="dialog-footer"] button:last-child').focus()`);
          for (let i=0; i<14 && !await evaluate(`document.activeElement.matches('.app-publisher a')`); i++) {
            await press('Tab',9);
            await assertUI(`!document.activeElement.closest('main')`, 'keyboard skips the project list while a dialog is open');
          }
          await assertUI(`document.activeElement.matches('.app-publisher a')`, 'keyboard reaches the toolbar without closing the dialog');
        }
        window.setContentSize(860,640);
      } finally { input.detach(); }
    }
    await dismiss();
    if (verifyDirect) {
      verificationMenuSelection='copy-standard';
      await click('.app-client-menu');
      await waitFor('[aria-label="Dismiss notification"]');
      if (lastMenuItems.map(item => item.label || '|').join('/') !== 'Codex/VS Code/|/Not installed/Copy configuration'
          || lastMenuItems[0].icon !== 'Check' || lastMenuItems[1].icon !== 'TriangleAlert'
          || lastMenuItems[1].children[0].label !== 'Can’t read configuration') throw new Error('Unexpected Apps menu structure or setup status');
      verificationMenuSelection='about';
      await click('.app-settings-menu');
      await waitFor('.dialog-shell .dialog-scroll');
      const sections = lastMenuItems.map(item => item.id || item.label || '|').join('/').split('/|/');
      if (!sections.some(group => group.includes('defaults/Default MCP version/read-code/disabled-project-discovery'))
          || !sections.some(group => group.startsWith('Appearance/') && group.endsWith('order'))
          || !sections.includes('diagnostics/updates/feedback/about')) throw new Error('Unexpected Settings menu groups');
      const notifications = '.router-shell > .toolbar-notifications';
      const checkForUpdate = () => evaluate(`[...document.querySelectorAll('[role="dialog"] button')].find(button => button.textContent === 'Check for updates').click()`);
      const layout = () => evaluate(`(async () => {
        await new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)));
        const notices = document.querySelector('${notifications}');
        await Promise.all(notices.getAnimations({subtree:true}).map(a => a.finished.catch(() => {})));
        const bar = notices.getBoundingClientRect(), panel = document.querySelector('.dialog-shell').getBoundingClientRect();
        const toolbar = document.querySelector('.app-header').getBoundingClientRect();
        if (Math.abs(bar.top-toolbar.bottom) > 1 || bar.left !== 0 || bar.right !== innerWidth || panel.top < bar.bottom-1 || panel.bottom > innerHeight+1) {
          throw new Error('The notification strip and the popup overlap or leave the window');
        }
        return {height:panel.height, strip:bar.height};
      })()`);
      const noticeClose = notifications + ' [aria-label="Dismiss notification"]';
      await waitFor(noticeClose);
      await checkForUpdate();
      const updateClose = notifications + ' [aria-label="Dismiss update notification"]';
      await waitFor(updateClose);
      if ((await layout()).strip < 70) throw new Error('Both notifications should stack beneath the toolbar');
      await click(noticeClose);
      await assertUI(`document.querySelector('.router-shell > .toolbar-notifications [role="status"]').textContent === 'You’re up to date.' && document.querySelectorAll('.toolbar-notifications').length === 1`, 'one notification strip remains available above the dialog');
      await saveView('about-update');
      const input = window.webContents.debugger;
      input.attach();
      try {
        const press = async (key, keyCode) => {
          const args = {key, code:key, windowsVirtualKeyCode:keyCode};
          await input.sendCommand('Input.dispatchKeyEvent', {type:'keyDown', ...args, ...(key === 'Enter' ? {text:'\r'} : {})});
          await input.sendCommand('Input.dispatchKeyEvent', {type:'keyUp', ...args});
        };
        await evaluate(`[...document.querySelectorAll('[role="dialog"] button')].find(button => button.textContent === 'Check for updates').focus()`);
        for (let i=0; i<20 && !await evaluate(`document.activeElement.matches('${updateClose}')`); i++) await press('Tab',9);
        await assertUI(`document.activeElement.matches('${updateClose}')`, 'keyboard focus reaches the update notification');
        await press('Enter',13);
        await waitFor('.router-shell > .toolbar-notifications:not(:has([data-open="true"]))');
        await assertUI(`!document.querySelector('.router-shell > .toolbar-notifications [data-open="true"]') && !!document.querySelector('[role="dialog"]')`, 'dismissing an update keeps the dialog open');
        demoUpdate = {state:'available',version:'0.99.0'};
        await checkForUpdate();
        const notes = notifications + ' [aria-label="Release notes for 0.99.0"]';
        await waitFor(notes);
        await evaluate('new Promise(resolve => setTimeout(resolve,250))');
        const point = await evaluate(`(() => {
          const button = document.querySelector('${notes}'), rect = button.getBoundingClientRect();
          const point = {x:rect.x + rect.width/2, y:rect.y + rect.height/2};
          return button.contains(document.elementFromPoint(point.x,point.y)) && point;
        })()`);
        if (!point) throw new Error('Dialog overlay covers the release notes');
        for (const type of ['mousePressed','mouseReleased']) await input.sendCommand('Input.dispatchMouseEvent',{type,...point,button:'left',clickCount:1});
        if (openedNotes !== demoUpdate.version) throw new Error('Release notes did not receive the click');
      } finally { input.detach(); }
      demoUpdate = {state:'current'};
      await checkForUpdate();
      await waitFor(updateClose);
      await click(updateClose);
      for (const [width,height] of [[680,385],[400,420]]) {
        window.setContentSize(width,height);
        await waitFor('.dialog-scroll[data-scrollable]');
        const idle = await layout();
        await checkForUpdate();
        await waitFor(updateClose);
        const active = await layout();
        if (idle.strip !== 0 || active.strip < 35 || Math.abs(idle.height - active.height - active.strip) > 1) {
          throw new Error('The open popup must shrink by the height of the toolbar notification');
        }
        if (width === 400) await saveView('compact-update');
        await click(updateClose);
        const restored = await layout();
        if (Math.abs(idle.height - restored.height) > 1) throw new Error('The popup must regain its height after dismissal');
        const point = await evaluate(`(() => {
          const area = document.querySelector('.dialog-scroll');
          area.scrollTop = 0;
          const rect = area.getBoundingClientRect();
          return {x:rect.x+rect.width/2, y:rect.y+rect.height/2};
        })()`);
        const input = window.webContents.debugger;
        input.attach();
        try { await input.sendCommand('Input.dispatchMouseEvent', {type:'mouseWheel', ...point, deltaX:0, deltaY:1200}); }
        finally { input.detach(); }
        await assertUI(`(async () => {
          const area = document.querySelector('.dialog-scroll'), rect = area.getBoundingClientRect();
          for (let i = 0; i < 90 && area.scrollHeight - area.clientHeight - area.scrollTop > 1; i++) {
            await new Promise(resolve => requestAnimationFrame(resolve));
          }
          const bottom = area.closest('.dialog-shell').getBoundingClientRect().bottom;
          return Math.abs(rect.bottom-bottom)<2 && area.lastElementChild.textContent.includes('Version')
            && area.lastElementChild.textContent.includes('© ' + new Date().getFullYear())
            && area.scrollHeight - area.clientHeight - area.scrollTop <= 1 && area.lastElementChild.getBoundingClientRect().bottom <= rect.bottom - 8;
        })()`, 'About allows wheel scrolling through the version line all the way to the window edge');
        await verifyDialogEdges();
      }
      await saveView('about-short');
      window.setContentSize(860,640);
      await checkForUpdate();
      await waitFor(updateClose);
      await layout();
      const backdrop = await evaluate(`(() => {
        const y = document.querySelector('.dialog-viewport').getBoundingClientRect().top + 5;
        return document.elementFromPoint(5,y)?.matches('[data-slot="dialog-overlay"]') && {x:5,y};
      })()`);
      if (!backdrop) throw new Error('The backdrop must receive clicks outside the popup');
      input.attach();
      try {
        for (const type of ['mousePressed','mouseReleased']) await input.sendCommand('Input.dispatchMouseEvent',{type,...backdrop,button:'left',clickCount:1});
      } finally { input.detach(); }
      const dashboardUpdate = '.router-shell > .toolbar-notifications [aria-label="Dismiss update notification"]';
      await waitFor(dashboardUpdate);
      await waitFor('body:not(:has([role="dialog"]))');
      await click(dashboardUpdate);
      verificationMenuSelection='order';
      await click('.app-settings-menu');
      await waitFor('[aria-label="Move Example Studio down"]');
      await verifyDialogEdges();
      await dismiss();
    }
    const projectPermissionsBefore=JSON.stringify(demo.state.projects.map(project=>project.permissions));
    verificationMenuSelection='workspace';
    await click('[aria-label="More options for Example Studio"]');
    const membersRead = '[id="workspace-demo-workspace-studio-workspace_members:read"]';
    const aeoWrite = '[id="workspace-demo-workspace-studio-workspace_aeo:write"]';
    await waitFor(membersRead);
    await assertUI(`document.querySelector('[data-slot="dialog-title"]').textContent === 'Connection permissions'
      && document.querySelector('[data-slot="dialog-description"]').textContent.includes('through Example Studio')
      && document.querySelector('[data-slot="dialog-description"]').textContent.includes('access from Webflow')`, 'dialog title and description match its scope');
    await assertUI(`[...document.querySelectorAll('[role="dialog"] legend')].map(el => el.textContent).join('|') === 'Discovery and app creation|Workspace actions'`, 'permission groups describe the actions they control');
    const scopedOperations = CATALOG.filter(op => op.scope === 'connection' || op.scope === 'workspace');
    const betaOnly = [...new Set(scopedOperations.map(op => op.permission))]
      .filter(key => !scopedOperations.some(op => op.permission === key && op.channels.includes('stable')));
    for (const [width,height] of [[400,560],[860,740]]) {
      window.setContentSize(width,height);
      await evaluate('new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)))');
      await verifyModalControls();
      const result = await evaluate(`(async () => {
        const panel = document.querySelector('.dialog-shell');
        await Promise.all(panel.getAnimations().map(animation => animation.finished.catch(() => {})));
        const form = panel.querySelector('form'), groups = [...form.querySelectorAll('fieldset')];
        const gaps = groups.map(group => group.querySelector(':scope > p').getBoundingClientRect().top - group.querySelector('legend').getBoundingClientRect().bottom);
        const controls = [...form.querySelectorAll('[role="switch"]')];
        if (gaps.length !== 2 || gaps[0] <= 0 || Math.abs(gaps[0] - gaps[1]) >= .5) return 'description gaps ' + gaps.join(', ');
        for (const control of controls) {
          const marked = ${JSON.stringify(betaOnly)}.some(key => control.id === key || control.id.endsWith('-' + key));
          const badge = control.previousElementSibling;
          if (!marked) {
            if (badge?.matches('.beta-badge') || control.hasAttribute('aria-describedby')) return 'unexpected Beta indicator on ' + control.id;
            continue;
          }
          if (!badge?.matches('.beta-badge') || document.getElementById(control.getAttribute('aria-describedby'))?.textContent !== 'Requires Beta') return 'missing Beta indicator on ' + control.id;
          const dot = badge.getBoundingClientRect(), toggle = control.getBoundingClientRect();
          if (Math.abs(dot.width - dot.height) > .1 || dot.right >= toggle.left || Math.abs(dot.top + dot.height/2 - toggle.top - toggle.height/2) >= .5
                || toggle.right > innerWidth || control.getAttribute('aria-label').includes('Beta')) return 'misaligned ' + control.id + ' ' + JSON.stringify([dot,toggle]);
        }
        return 'ok';
      })()`);
      if (result !== 'ok') throw new Error('Connection permission layout at ' + width + ': ' + result);
    }
    const betaSwitch = '[id="workspace_discovery:read"]';
    const targets = await evaluate(`(() => {
      const control = document.querySelector('${betaSwitch}'), badge = control.previousElementSibling;
      document.activeElement.blur();
      badge.scrollIntoView({block:'nearest'});
      const center = rect => ({x:rect.x + rect.width/2, y:rect.y + rect.height/2});
      return {badge:center(badge.getBoundingClientRect()), toggle:center(control.getBoundingClientRect())};
    })()`);
    const pointer = window.webContents.debugger;
    pointer.attach();
    try {
      await pointer.sendCommand('Input.dispatchMouseEvent',{type:'mouseMoved', ...targets.badge});
      await waitFor('[role="tooltip"]');
      const hint = await evaluate(`(() => {
        const popup = document.querySelector('[role="tooltip"]');
        const hit = document.elementFromPoint(${targets.toggle.x},${targets.toggle.y});
        return {text:popup?.textContent, switchId:hit?.closest('[role="switch"]')?.id};
      })()`);
      if (hint.text !== 'Requires Beta' || hint.switchId !== 'workspace_discovery:read') throw new Error('Beta badge hit target: ' + JSON.stringify(hint));
      if (!verifyDirect) await saveView('beta-permissions');
      await pointer.sendCommand('Input.dispatchMouseEvent',{type:'mouseMoved',...targets.toggle});
      await waitFor('body:not(:has([role="tooltip"]))');
      for (const type of ['mousePressed','mouseReleased']) await pointer.sendCommand('Input.dispatchMouseEvent',{type,...targets.toggle,button:'left',clickCount:1});
      await waitFor(betaSwitch + '[aria-checked="true"]');
      if (!verifyDirect) await saveView('beta-switch');
      await evaluate(`document.querySelector('[data-slot="dialog-close"]').focus()`);
      for (const type of ['keyDown','keyUp']) await pointer.sendCommand('Input.dispatchKeyEvent',{type,key:'Tab',code:'Tab',windowsVirtualKeyCode:9});
      const {root} = await pointer.sendCommand('DOM.getDocument');
      const {nodeId} = await pointer.sendCommand('DOM.querySelector',{nodeId:root.nodeId,selector:betaSwitch});
      const {nodes} = await pointer.sendCommand('Accessibility.getPartialAXTree',{nodeId,fetchRelatives:false});
      if (!nodes.some(node => node.role?.value === 'switch' && node.description?.value === 'Requires Beta')) throw new Error('Screen readers must receive the Beta requirement on the switch');
      await evaluate('new Promise(resolve => setTimeout(resolve,350))');
      await assertUI(`document.activeElement.matches('${betaSwitch}') && !document.querySelector('[role="tooltip"]')`, 'hovering or focusing the switch leaves the tooltip closed');
      for (const type of ['keyDown','keyUp']) await pointer.sendCommand('Input.dispatchKeyEvent',{type,key:' ',code:'Space',windowsVirtualKeyCode:32});
      await waitFor(betaSwitch + '[aria-checked="false"]');
    } finally { pointer.detach(); }
    await evaluate(`document.querySelector('[data-slot="dialog-close"]').focus()`);
    window.setContentSize(860,640);
    if (verifyDirect) {
      await verifyDialogEdges();
      await waitFor('[role="group"][aria-label="Example Studio"]');
      await waitFor('[role="group"][aria-label="Includes Archive Concept"]');
      await assertUI(`!document.querySelector('[role="dialog"]').textContent.includes('demo-unnamed-workspace')`, 'workspace identities are readable');
      await click('[id="workspace-demo-unnamed-workspace-workspace_members:write"]');
    } else {
      await assertUI(`!document.querySelector('[role="dialog"] fieldset [role="group"]') && ![...document.querySelectorAll('[role="dialog"] fieldset')].some(group => group.textContent.includes('Example Studio'))`, 'single workspace needs only the scope heading');
      await saveView('permission-scopes');
    }
    await assertUI(`document.querySelector('[role="dialog"]').textContent.includes('including sites that are disabled') && document.querySelector('${membersRead}').getAttribute('aria-checked')==='false'`, 'workspace scope must be explicit and default off');
    await assertUI(`document.querySelector('[aria-label="List accessible workspaces"]').getAttribute('aria-checked')==='false' && document.querySelector('[aria-label="Create and deploy standalone apps and set their access"]').getAttribute('aria-checked')==='false'`, 'connection-wide grants must default off');
    await assertUI(`document.querySelector('${aeoWrite}').getAttribute('aria-checked')==='false'`, 'workspace AEO must default off');
    await click(aeoWrite);
    await click('[aria-label="List accessible workspaces"]');
    await click(membersRead);
    await evaluate(`Array.from(document.querySelectorAll('[role="dialog"] button')).find(button=>button.textContent==='Save changes').click()`);
    for(let attempt=0;attempt<50&&await evaluate(`!!document.querySelector('[role="dialog"]')`);attempt++)await new Promise(resolve=>setTimeout(resolve,100));
    if(demo.state.connections[0].workspacePermissions?.['demo-workspace-studio']?.['workspace_members:read']!==true || JSON.stringify(demo.state.projects.map(project=>project.permissions))!==projectPermissionsBefore)throw new Error('Workspace permissions must save independently of project grants');
    if(demo.state.connections[0].workspacePermissions?.['demo-workspace-studio']?.['workspace_aeo:write']!==true)throw new Error('Workspace AEO grant must save independently');
    if(verifyDirect && (demo.state.connections[0].workspacePermissions['demo-unnamed-workspace']?.['workspace_members:write']!==true || demo.state.connections[0].workspacePermissions['demo-workspace-studio']['workspace_members:write']))throw new Error('Workspace grants must stay assigned to their own workspace');
    if(demo.state.connections[0].connectionPermissions?.['workspace_discovery:read']!==true)throw new Error('Account-wide grant must save independently');
    await assertUI(`(() => {
      const strip = document.querySelector('.router-shell > .toolbar-notifications .update-banner-reveal[data-open="true"] [role="status"]');
      return strip?.textContent === 'Permissions saved.' &&
        strip.getBoundingClientRect().bottom <= document.querySelector('.router-main').getBoundingClientRect().top;
    })()`, 'save feedback must appear above the scrollable controls');
    demo.state.connections[0].connectionPermissions={};
    demo.state.connections[0].workspacePermissions={};
    const projectsBeforeDirect=JSON.stringify(demo.state.projects);
    verificationMenuSelection='access-mode';
    await click('[aria-label="More options for Example Studio"]');
    await waitFor('input[name="accessMode"][value="managed"]');
    await assertUI(`document.querySelector('input[value="managed"]').checked`, 'connections must default to Managed');
    await assertUI(`getComputedStyle(document.querySelector('input[name="accessMode"]:checked')).accentColor === getComputedStyle(document.querySelector('.activity-spark i')).backgroundColor`, 'radio uses router purple');
    if (verifyDirect) await saveView('access-mode');
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
    if (verifyDirect) {
      const personal = demo.state.connections.find(connection => connection.id === 'personal');
      const {id, name} = personal.sites[0];
      personal.sites = [{id, name}];
      for (const channel of Object.values(personal.channels)) channel.siteIds = [id];
      demo.state.projects = demo.state.projects.filter(project => project.connectionId !== personal.id || project.siteId === id);
      personal.workspacePermissions = {previous:{'workspace_members:read':true}};
      await loadDemo();
      verificationMenuSelection = 'workspace';
      await click('[aria-label="More options for Personal Projects"]');
      await waitFor('[aria-label="List accessible workspaces"]');
      await assertUI(`document.querySelector('[role="dialog"]').innerText.includes('Webflow hasn’t identified a workspace for this connection')
        && !document.querySelector('[role="dialog"] [id^="workspace-"]')`, 'a site without workspace metadata shows only applicable controls');
      await saveView('single-site');
      await click('[aria-label="List accessible workspaces"]');
      await evaluate(`[...document.querySelectorAll('[role="dialog"] button')].find(button => button.textContent === 'Save changes').click()`);
      await waitFor('.router-shell > .toolbar-notifications .update-banner-reveal[data-open="true"]');
      if (!personal.connectionPermissions?.['workspace_discovery:read'] || !personal.workspacePermissions.previous?.['workspace_members:read']) {
        throw new Error('Saving a site-only connection changed unrelated permissions');
      }
      await window.loadURL(origin + '/?web');
      await waitFor('[aria-label="Expand Example Studio"]');
      await assertUI('!window.routerDesktop', 'browser dashboard uses its web menu');
      await click('[aria-label="Expand Example Studio"]');
      await waitFor('[aria-label="Settings for Juniper & Kite"]');
      await evaluate(`document.querySelector('[aria-label="Settings for Juniper & Kite"]').focus()`);
      await click('[aria-label="Settings for Juniper & Kite"]');
      await waitFor('.permission-dialog');
      await evaluate("document.querySelector('.app-settings-menu').focus()");
      const webInput = window.webContents.debugger;
      webInput.attach();
      try {
        for (const type of ['keyDown','keyUp']) await webInput.sendCommand('Input.dispatchKeyEvent',{type,key:'ArrowDown',code:'ArrowDown',windowsVirtualKeyCode:40});
        await waitFor('[role="menu"]');
        await evaluate(`[...document.querySelectorAll('[role="menuitem"]')].find(item => item.textContent.includes('Default permissions…')).click()`);
        await waitFor('.workspace-overlay + .workspace-overlay .permission-dialog');
        await evaluate('new Promise(resolve => setTimeout(resolve,250))');
        await assertUI(`[...document.querySelectorAll('.dialog-shell')].some(panel => panel.checkVisibility() && panel.textContent.includes('Default permissions')) && document.activeElement.closest('[data-slot="dialog-workarea"]')`, 'web menu selection focuses the new dialog');
        for (const type of ['keyDown','keyUp']) await webInput.sendCommand('Input.dispatchKeyEvent',{type,key:'Escape',code:'Escape',windowsVirtualKeyCode:27});
        await waitFor('body:not(:has(.workspace-overlay + .workspace-overlay))');
        await assertUI(`document.querySelector('.permission-dialog [aria-label="Rename project"]').checkVisibility()`, 'closing a web toolbar dialog restores the project form');
      } finally { webInput.detach(); }
      console.log('Verified desktop and browser toolbar actions, draft restoration, individual-site permissions, accessible notifications and popup resizing, scroll boundaries and Managed/Direct mode.');
      return;
    }

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
  clearInterval(activityTimer);
  tray?.destroy();
  await server?.close();
  // Normal captures follow Electron's graceful window/application lifecycle.
  // Retain a nonzero exit status for failed automation.
  if(process.exitCode)app.exit(process.exitCode);
  else app.quit();
}
}
main().catch(error => { console.error(error); app.exit(1); });
