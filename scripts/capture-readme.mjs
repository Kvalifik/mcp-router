// Run with: npx electron scripts/capture-readme.mjs
// Renders the current UI against fictional data, never the router or saved accounts.
import { app, BrowserWindow, nativeTheme, Tray, nativeImage, Menu, screen, ipcMain } from 'electron';
import { createServer } from 'vite';
import { writeFile, mkdir, rm, readdir, readFile } from 'node:fs/promises';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { GROUPS } from '../src/permissions.js';
import { presetGrants } from '../ui/permission-presets.js';
import menuBar from '../src/menu-bar.cjs';
import { createDemoState } from './demo-state.mjs';
import nativeMenusApi from '../src/native-menu.cjs';

async function main() {
const recording = process.argv.includes('--record');
const verifyAttention = process.argv.includes('--verify-attention');
const attentionPreview = process.argv.includes('--attention') || verifyAttention;
const root = fileURLToPath(new URL('../', import.meta.url));
const temporary = mkdtempSync(join(tmpdir(), 'mcp-router-screenshots-'));
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
    id, name, enabled: true, channel: 'stable', tokenFingerprint: 'fictional-demo',
    channels: Object.fromEntries(['stable', 'beta'].map(channel => [channel, {
      authorized: true, status: 'connected', siteIds: projects.filter(p => p.connectionId === id).map(p => p.siteId),
    }])),
  })),
};
const demo = createDemoState(data);
let server;
let window;
let tray;
let popover;
try {
  await app.whenReady();
  app.on('window-all-closed',()=>{});
  const preload = join(temporary, 'preload.cjs');
  await writeFile(preload, `const {contextBridge, ipcRenderer} = require('electron');
  contextBridge.exposeInMainWorld('routerDesktop', {
    integratedTitleBar: true,
    showNativeMenu: request => ipcRenderer.invoke('demo-native-menu', request),
    openMainWindow: () => ipcRenderer.invoke('demo-open-main-window'),
    openOAuth: async url => { if (url !== "demo:authorized") throw new Error("Only simulated demo authorization is available."); },
    clientStatus: async () => [],
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
          if ((!recording && !attentionPreview) || request.method !== 'POST' || request.headers.origin !== origin || request.headers['x-router-csrf'] !== data.csrf || !request.headers['content-type']?.startsWith('application/json')) throw new Error('Request denied');
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
  ipcMain.handle('demo-open-main-window', event => { if (!allowed(event)) throw new Error('Denied'); showMain(); });
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
  ipcMain.handle('demo-native-menu', (event, request) => {
    if (!allowed(event) || !request || !Number.isFinite(request.x) || !Number.isFinite(request.y)) throw new Error('Denied');
    const owner = BrowserWindow.fromWebContents(event.sender);
    if (nativeMenus.has(owner)) throw new Error('Menu already open');
    let selection = null;
    const menu = Menu.buildFromTemplate(nativeMenusApi.menuTemplate(request.items, id => { selection = id; }, icons));
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
    if (verifyAttention) return;
    await evaluate('document.fonts.ready');
    app.focus({ steal: true });
    window.focus();
    await new Promise(resolve => setTimeout(resolve, 1500));
    await window.webContents.capturePage();
    const path = name.startsWith('/') ? name : join(root, 'docs/images', name);
    await mkdir(dirname(path), { recursive: true });
    const windowId = window.getMediaSourceId().split(':')[1];
    await promisify(execFile)('/usr/sbin/screencapture', ['-x', '-T', '1', '-l', windowId, path]);
    await new Promise(resolve => setTimeout(resolve, 1500));
    console.log(`Saved ${path}`);
  }
  await waitFor('[aria-label="Expand Example Studio"]');
  await click('[aria-label="Expand Example Studio"]');
  await click('[aria-label="Expand Personal Projects"]');
  await evaluate('document.activeElement.blur()');
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
  popover?.destroy();
  window?.destroy();
  await server?.close();
  await rm(temporary, { recursive: true, force: true });
  app.exit(process.exitCode || 0);
}
}
main().catch(error => { console.error(error); app.exit(1); });
