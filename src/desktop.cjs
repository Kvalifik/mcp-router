const { app, BrowserWindow, ipcMain, shell, dialog, Menu, nativeTheme, screen, clipboard, Tray, nativeImage } = require('electron');
const path = require('node:path');
const { execFile } = require('node:child_process');
const { promisify } = require('node:util');
const run = promisify(execFile);
const origin = 'http://127.0.0.1:43127';
let win, popover, tray, openingPopover = false;
app.setName('MCP Router');
const { migrateUserData } = require('./paths.cjs');
app.setPath('userData', migrateUserData(app.getPath('appData')));
process.env.ROUTER_DATA_DIR = path.join(app.getPath('userData'), 'router');
process.env.ROUTER_PORT = '43127';
if (!app.requestSingleInstanceLock()) app.quit();
else {
  app.on('second-instance', () => { win?.show(); win?.focus(); });
  app.whenReady().then(async () => {
    app.setAboutPanelOptions({ applicationName: 'MCP Router', applicationVersion: app.getVersion(), copyright: 'Copyright © 2026 Kvalifik ApS', credits: 'Connect multiple Webflow workspaces to your AI tools through one MCP connection. Independent software; not affiliated with or endorsed by Webflow or connected AI providers. contact@kvalifik.dk' });
    const { main } = await import('./server.js');
    const { managementToken, router } = await main();
    const allowed = event => [win, popover].some(window => window && !window.isDestroyed() && event.sender === window.webContents && event.senderFrame === window.webContents.mainFrame) && event.senderFrame?.url === origin + '/';
    const { MODES, menuBarMode, menuBarStatus, menuBarTitle, popoverBounds, createTrayTextUpdater } = require('./menu-bar.cjs');
    const updateTrayText = createTrayTextUpdater();
    const showMain = () => { popover?.hide(); if(win.isMinimized())win.restore(); win.show(); win.focus(); };
    const mode = () => menuBarMode(router.store.data.settings?.menuBar);
    ipcMain.handle('menu-bar-mode', event => { if(!allowed(event))throw new Error('Denied'); return mode(); });
    ipcMain.handle('set-menu-bar-mode', (event, value) => {
      if(!allowed(event) || process.platform !== 'darwin' || !MODES.includes(value))throw new Error('Denied');
      router.store.data.settings ||= {}; router.store.data.settings.menuBar = value; router.store.save(); return value;
    });
    ipcMain.handle('open-main-window', event => { if(!allowed(event))throw new Error('Denied'); showMain(); });
    const nativeMenuIcons = Object.fromEntries(['SunMoon','PanelTop','Monitor','Server','ArrowDownUp','ShieldCheck','Activity','RefreshCw','Info','Pencil','Trash2','MessageSquare','Code2','Terminal','Plus','Copy','Check','TriangleAlert'].map(name=>{
      const icon=nativeImage.createEmpty();
      icon.addRepresentation({scaleFactor:2,buffer:require('node:fs').readFileSync(path.join(__dirname,`../assets/icons/menu/${name}.png`))});
      icon.setTemplateImage(true);
      return [name,icon];
    }));
    const nativeMenus = new Set();
    ipcMain.handle('show-native-menu', (event, request) => {
      if(!allowed(event) || !request || !Number.isFinite(request.x) || !Number.isFinite(request.y))throw new Error('Denied');
      const owner=BrowserWindow.fromWebContents(event.sender);
      if(nativeMenus.has(owner))throw new Error('Menu already open');
      const {menuTemplate}=require('./native-menu.cjs');
      let selection=null;
      const menu=Menu.buildFromTemplate(menuTemplate(request.items,id=>{selection=id;},nativeMenuIcons));
      const [width,height]=owner.getContentSize();
      nativeMenus.add(owner);
      return new Promise((resolve,reject)=>{
        try { menu.popup({window:owner,x:Math.max(0,Math.min(width,Math.round(request.x))),y:Math.max(0,Math.min(height,Math.round(request.y))),callback:()=>{
          nativeMenus.delete(owner);
          if(!owner.isDestroyed()) {
            if(selection){owner.show();owner.focus();}
            else if(owner===popover&&!owner.isFocused())owner.hide();
          }
          resolve(selection);
        }}); } catch(error){nativeMenus.delete(owner);reject(error);}
      });
    });
    async function togglePopover() {
      if(popover?.isVisible()){popover.hide();return;}
      openingPopover = true;
      try {
      if(!popover) {
        popover = new BrowserWindow({width:400,height:560,show:false,frame:false,...(process.platform==='darwin'?{type:'panel'}:{}),resizable:false,fullscreenable:false,minimizable:false,maximizable:false,skipTaskbar:true,alwaysOnTop:true,
          webPreferences:{preload:path.join(__dirname,'preload.cjs'),nodeIntegration:false,contextIsolation:true,sandbox:true}});
        popover.webContents.setWindowOpenHandler(()=>({action:'deny'}));
        popover.webContents.on('will-navigate',(event,url)=>{if(url!==origin+'/')event.preventDefault();});
        popover.on('blur',()=>{if(!nativeMenus.has(popover))popover?.hide();});
        popover.webContents.on('before-input-event',(event,input)=>{if(input.key==='Escape'&&input.type==='keyDown'){popover.hide();event.preventDefault();}});
        popover.on('closed',()=>{popover=null;});
        try { await popover.loadURL(origin); } catch { popover?.destroy(); return; }
      }
      if(!tray || mode()==='off')return;
      const anchor=tray.getBounds();
      popover.setBounds(popoverBounds(anchor,screen.getDisplayMatching(anchor).workArea));
      popover.show();popover.focus();
      popover.webContents.send('focus-popover');
      } finally { openingPopover = false; }
    }
    function updateTray() {
      if(process.platform!=='darwin')return;
      if(mode()==='off'){tray?.destroy();tray=null;popover?.hide();return;}
      if(!tray) {
        const icon=nativeImage.createFromPath(path.join(__dirname,'../assets/icons/menubar/MCPRouterTemplate.png'));
        icon.setTemplateImage(true);tray=new Tray(icon);
        tray.on('click',()=>{togglePopover().catch(()=>{});});
        tray.on('right-click',()=>tray.popUpContextMenu(Menu.buildFromTemplate([{label:'Open MCP Router',click:showMain},{type:'separator'},{role:'quit'}])));
      }
      const status=menuBarStatus(router.store.summary());
      updateTrayText(tray, mode(), status);
    }
    ipcMain.handle('open-oauth', async (event, url) => {
      if (!allowed(event) || typeof url !== 'string') throw new Error('Denied');
      const u = new URL(url);
      if (u.origin !== origin || !/^\/oauth\/launch\/[A-Za-z0-9_-]{43}$/.test(u.pathname) || u.search || u.hash) throw new Error('Denied');
      await shell.openExternal(u.href);
    });
    const { createIntegrations } = require('./integrations.cjs');
    const integrations = createIntegrations({ home:app.getPath('home'), appData:app.getPath('appData'), executable:process.execPath, script:path.join(__dirname,'stdio.js'), socket:path.join(process.env.ROUTER_DATA_DIR,'router.sock'), run });
    try { integrations.migrateLegacy(); } catch { console.warn('Some legacy app registrations need review in Apps before reconnecting.'); }
    const openPublisher = () => shell.openExternal('https://kvalifik.dk');
    const { createUpdateChecker } = require('./updates.cjs');
    const updates = createUpdateChecker({repository:require('../package.json').updateRepository,currentVersion:app.getVersion()});
    ipcMain.handle('check-updates', event => {if(!allowed(event))throw new Error('Denied');return updates.check();});
    ipcMain.handle('download-update', async event => {if(!allowed(event)||!updates.releaseUrl())throw new Error('No verified release');await shell.openExternal(updates.releaseUrl());});

    let licensesWindow;
    const openLicenses = async () => {
      if (licensesWindow && !licensesWindow.isDestroyed()) { licensesWindow.show(); licensesWindow.focus(); return; }
      const fs = require('node:fs');
      const file = app.isPackaged ? path.join(process.resourcesPath, 'legal.html') : path.join(__dirname, `../dist/MCP Router-${process.platform}-${process.arch}/${process.platform === 'darwin' ? 'MCP Router.app/Contents/Resources' : 'resources'}/legal.html`);
      if (!fs.existsSync(file)) throw new Error('License viewer is missing. Run npm run build:desktop.');
      licensesWindow = new BrowserWindow({ title: 'Third-party licenses — MCP Router', width: 780, height: 680, parent: win,
        webPreferences: { nodeIntegration: false, contextIsolation: true, sandbox: true, javascript: false, partition: 'licenses' } });
      licensesWindow.webContents.session.webRequest.onBeforeRequest((details, callback) => callback({ cancel: !details.url.startsWith('file:') && details.url !== 'about:blank' }));
      licensesWindow.webContents.session.setPermissionRequestHandler((_contents, _permission, callback) => callback(false));
      licensesWindow.webContents.setWindowOpenHandler(({ url }) => {
        if (url === 'https://kvalifik.dk' || url === 'https://kvalifik.dk/') {
          openPublisher().catch(() => dialog.showErrorBox('Could not open website', 'Open https://kvalifik.dk in your browser.'));
        }
        return { action: 'deny' };
      });
      licensesWindow.webContents.on('will-navigate', event => event.preventDefault());
      await licensesWindow.loadFile(file);
    };
    ipcMain.handle('open-publisher', async event => { if (!allowed(event)) throw new Error('Denied'); await openPublisher(); });
    ipcMain.handle('open-licenses', async event => { if (!allowed(event)) throw new Error('Denied'); await openLicenses(); });
    ipcMain.handle('set-theme', (event,theme) => { if(allowed(event) && ['system','light','dark'].includes(theme)) nativeTheme.themeSource=theme; });
    const { projectUrl } = require('./project-links.cjs');
    ipcMain.handle('open-project', async (event, shortName, destination) => {
      if (!allowed(event)) throw new Error('Denied');
      await shell.openExternal(projectUrl(shortName, destination));
    });
    let toolbarDrag = null;
    ipcMain.on('toolbar-drag', (event, phase) => {
      if (!allowed(event) || event.sender !== win?.webContents || !win || win.isMaximized() || win.isFullScreen()) return;
      if (phase === 'start') toolbarDrag = { cursor:screen.getCursorScreenPoint(), position:win.getPosition() };
      else if (phase === 'end') toolbarDrag = null;
      else if (phase === 'move' && toolbarDrag) {
        const cursor=screen.getCursorScreenPoint();
        win.setPosition(toolbarDrag.position[0]+cursor.x-toolbarDrag.cursor.x, toolbarDrag.position[1]+cursor.y-toolbarDrag.cursor.y);
      }
    });
    ipcMain.handle('client-status', async event => allowed(event) ? integrations.status() : []);
    ipcMain.handle('copy-client-config', (event,format) => {
      if(!allowed(event)) throw new Error('Denied');
      clipboard.writeText(integrations.configuration(format));
    });
    ipcMain.handle('client-download', async (event,id) => {
      if(!allowed(event)) throw new Error('Denied');
      const url=integrations.download(id);if(!url)throw new Error('Unknown app');
      await shell.openExternal(url);
    });
    let connecting = false;
    ipcMain.handle('connect-client', async (event,id) => {
      if(!allowed(event) || connecting) return {ok:false,error:'Connection unavailable. Try again.'};
      connecting = true;
      try { return await integrations.connect(id); } finally { connecting = false; }
    });
    win = new BrowserWindow({ width: 860, height: 640, minWidth: 640, minHeight: 440, title: 'MCP Router', backgroundColor: '#f6f7f9',
      ...(process.platform === 'darwin' ? { titleBarStyle: 'hidden', trafficLightPosition: { x: 16, y: 25 } } : {}),
      ...(process.platform === 'win32' ? { titleBarStyle: 'hidden', autoHideMenuBar: true, titleBarOverlay: { color: '#00000000', symbolColor: nativeTheme.shouldUseDarkColors ? '#fafafa' : '#18181b', height: 64 } } : {}),
      webPreferences: { preload: path.join(__dirname, 'preload.cjs'), nodeIntegration: false, contextIsolation: true, sandbox: true }
    });
    if (process.platform === 'win32') {
      nativeTheme.on('updated', () => {
        if (!win.isDestroyed()) win.setTitleBarOverlay({ symbolColor: nativeTheme.shouldUseDarkColors ? '#fafafa' : '#18181b' });
      });
    }
    win.webContents.session.setPermissionRequestHandler((_contents, _permission, callback) => callback(false));
    win.webContents.session.setPermissionCheckHandler(() => false);
    win.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
    win.webContents.on('will-navigate', (event, url) => { if (new URL(url).origin !== origin) event.preventDefault(); });
    win.on('close', event => { if (!app.isQuitting) { event.preventDefault(); win.hide(); } });
    Menu.setApplicationMenu(Menu.buildFromTemplate([
      { label: 'MCP Router', submenu: [{ label: 'About MCP Router', click: () => { win.show(); win.webContents.send('show-about'); } }, { label: 'Third-party licenses', click: () => openLicenses().catch(() => dialog.showErrorBox('Could not open licenses', 'Reinstall the app to restore its license documents.')) }, { label: 'Kvalifik ↗', click: openPublisher }, { type: 'separator' }, { label: 'Show connections', click: () => win.show() }, { type: 'separator' }, { role: 'quit' }] },
      { role: 'editMenu' }, { role: 'windowMenu' }
    ]));
    await win.webContents.session.cookies.set({url:origin, name:'router_session', value:managementToken, httpOnly:true, sameSite:'strict', path:'/'});
    await win.loadURL(origin);
    updateTray();
    router.store.on('change', updateTray);
    app.once('before-quit',()=>{router.store.off('change', updateTray);tray?.destroy();});
  }).catch(error => {
    dialog.showErrorBox('MCP Router could not start', error.code === 'EADDRINUSE' ? 'Port 43127 is in use. Quit the browser POC or another router instance, then reopen this app.' : 'Another router may be running, or its data directory is unavailable. Quit the other router and try again.');
    app.quit();
  });
  app.on('before-quit', () => { app.isQuitting = true; });
  app.on('activate', (_event, hasVisibleWindows) => {
    // Activating the menu bar panel must not also reveal the main window.
    if(hasVisibleWindows || openingPopover || popover?.isVisible())return;
    if(win?.isMinimized())win.restore();
    win?.show();
  });
}
