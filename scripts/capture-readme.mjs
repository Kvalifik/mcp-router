// Run with: npx electron scripts/capture-readme.mjs
// Renders the current UI against fictional data, never the router or saved accounts.
import { app, BrowserWindow, nativeTheme } from 'electron';
import { createServer } from 'vite';
import { writeFile, mkdir, rm } from 'node:fs/promises';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { GROUPS } from '../src/permissions.js';
import { presetGrants } from '../ui/permission-presets.js';

async function main() {
const root = fileURLToPath(new URL('../', import.meta.url));
const temporary = mkdtempSync(join(tmpdir(), 'mcp-router-screenshots-'));
app.setPath('userData', join(temporary, 'profile'));
nativeTheme.themeSource = 'light';
const keys = GROUPS.flatMap(group => group.modes.map(mode => `${group.area}:${mode}`));
const projects = [
  ['studio', 'Juniper & Kite', 'read', true, true],
  ['studio', 'Paper Moon Journal', 'no-publishing', true, true],
  ['studio', 'Studio Sandbox', 'all', true, false],
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
let server;
let window;
try {
  await app.whenReady();
  const preload = join(temporary, 'preload.cjs');
  await writeFile(preload, `require('electron').contextBridge.exposeInMainWorld('routerDesktop', {
    integratedTitleBar: true,
    clientStatus: async () => [],
    setTheme: async () => {},
    onShowAbout: () => {},
  });`);
  server = await createServer({
    configFile: join(root, 'vite.config.js'),
    server: { host: '127.0.0.1', port: 0 },
    plugins: [{ name: 'fictional-screenshot-data', configureServer(server) {
      server.middlewares.use('/api', (request, response) => {
        response.setHeader('Content-Type', 'application/json');
        if (request.method === 'GET' && request.url === '/state') response.end(JSON.stringify(data));
        else { response.statusCode = 403; response.end('{"error":"Screenshot mode is read-only"}'); }
      });
    } }],
  });
  await server.listen();
  const origin = `http://127.0.0.1:${server.httpServer.address().port}`;
  window = new BrowserWindow({ width: 860, height: 640, show: false,
    titleBarStyle: 'hidden', trafficLightPosition: { x: 16, y: 25 },
    webPreferences: { preload, contextIsolation: true, nodeIntegration: false, partition: 'screenshot-demo' } });
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
  await capture('project-overview.png');
  await click('[aria-label="Settings for Juniper & Kite"]');
  await waitFor('[role="dialog"]');
  await capture('project-permissions.png');
} finally {
  window?.destroy();
  await server?.close();
  await rm(temporary, { recursive: true, force: true });
  app.quit();
}
}
main().catch(error => { console.error(error); app.exit(1); });
