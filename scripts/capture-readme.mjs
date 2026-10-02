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
          if (request.method === 'GET' && request.url === '/state') { response.end(JSON.stringify(demo.state)); return; }
          if (!recording || request.method !== 'POST' || request.headers.origin !== origin || request.headers['x-router-csrf'] !== data.csrf || !request.headers['content-type']?.startsWith('application/json')) throw new Error('Request denied');
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
    await evaluate('document.fonts.ready');
    app.focus({ steal: true });
    window.focus();
    await new Promise(resolve => setTimeout(resolve, 1500));
    await window.webContents.capturePage();
    const path = join(root, 'docs/images', name);
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
} finally {
  ipcMain.removeHandler('demo-native-menu');
  ipcMain.removeHandler('demo-open-main-window');
  tray?.destroy();
  popover?.destroy();
  window?.destroy();
  await server?.close();
  await rm(temporary, { recursive: true, force: true });
  app.quit();
}
}
main().catch(error => { console.error(error); app.exit(1); });
