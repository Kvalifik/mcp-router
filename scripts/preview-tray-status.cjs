// Native macOS menu bar design preview. Uses no router state or update services.
// Run: npx electron scripts/preview-tray-status.cjs
const { app, BrowserWindow, Menu, Tray, nativeImage } = require('electron');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'router-status-preview-'));
app.setPath('userData', profile);
app.setName('MCP Router icon preview');
let tray;
app.whenReady().then(async () => {
  app.dock?.hide();
  const root = path.join(__dirname, '..');
  const render = new BrowserWindow({ show: false, webPreferences: { sandbox: true, contextIsolation: true, nodeIntegration: false } });
  await render.loadURL('about:blank');
  const mark = fs.readFileSync(path.join(root, 'assets/icons/mark-black.svg'), 'utf8').replace('<svg ', '<svg x="2" y="2" ').replace('width="672" height="672"', 'width="18" height="18"');
  const arrow = '<circle cx="17" cy="16.5" r="5.5" fill="none" stroke="black" stroke-width="1.35"/><path d="M17 19.5v-6m-2.5 2.5 2.5-2.5 2.5 2.5" fill="none" stroke="black" stroke-width="1.35" stroke-linecap="round" stroke-linejoin="round"/>';
  const updateSvg = `<svg xmlns="http://www.w3.org/2000/svg" width="25" height="24"><defs><mask id="gap"><rect width="25" height="24" fill="white"/><circle cx="17" cy="16.5" r="7.3" fill="black"/></mask></defs><g mask="url(#gap)">${mark}</g>${arrow}</svg>`;
  async function imageFromSvg(svg, width) {
    const icon = nativeImage.createEmpty();
    for (const scale of [1, 2, 3]) {
      const data = await render.webContents.executeJavaScript(`new Promise((resolve,reject)=>{const img=new Image();img.onload=()=>{const c=document.createElement('canvas');c.width=${width * scale};c.height=${24 * scale};c.getContext('2d').drawImage(img,0,0,c.width,c.height);resolve(c.toDataURL('image/png').split(',')[1]);};img.onerror=()=>reject(new Error('Image failed'));img.src=${JSON.stringify('data:image/svg+xml;base64,' + Buffer.from(svg).toString('base64'))};})`);
      icon.addRepresentation({ scaleFactor: scale, buffer: Buffer.from(data, 'base64') });
    }
    icon.setTemplateImage(true);
    return icon;
  }
  const icons = {};
  for (const [key, name] of [['normal', 'MCPRouterTemplate'], ['warning', 'MCPRouterWarningTemplate']]) {
    icons[key] = nativeImage.createFromPath(path.join(root, `assets/icons/menubar/${name}.png`));
    icons[key].setTemplateImage(true);
  }
  icons.update = await imageFromSvg(updateSvg, 25);
  const warningData = fs.readFileSync(path.join(root, 'assets/icons/menubar/MCPRouterWarningTemplate@3x.png')).toString('base64');
  icons.both = await imageFromSvg(`<svg xmlns="http://www.w3.org/2000/svg" width="40" height="24"><image href="data:image/png;base64,${warningData}" width="25" height="24"/><g transform="translate(16,-4.5)">${arrow}</g></svg>`, 40);
  render.destroy();
  const states = [
    { label: 'Normal', icon: 'normal', detail: 'All connections ready' },
    { label: 'Update ready', icon: 'update', detail: 'Update ready to install' },
    { label: 'Warning', icon: 'warning', detail: 'Access needs attention' },
    { label: 'Both — warning takes priority (recommended)', icon: 'warning', detail: 'Access needs attention · Update ready to install' },
    { label: 'Both — show two symbols (alternative)', icon: 'both', detail: 'Access needs attention · Update ready to install' },
  ];
  let selected = 1;
  function select(index) {
    selected = index;
    tray.setImage(icons[states[index].icon]);
    tray.setToolTip(`MCP Router preview · ${states[index].detail}`);
  }
  tray = new Tray(icons.update);
  tray.setTitle('Preview');
  const showMenu = () => tray.popUpContextMenu(Menu.buildFromTemplate([
    { label: 'MCP Router — live icon preview', enabled: false },
    { label: states[selected].detail, enabled: false },
    { type: 'separator' },
    ...states.map((state, index) => ({ label: state.label, type: 'radio', checked: selected === index, click: () => select(index) })),
    { type: 'separator' },
    { label: 'Close preview', click: () => app.quit() },
  ]));
  tray.on('click', showMenu);
  tray.on('right-click', showMenu);
  select(selected);
  console.log('Native menu bar preview running. Click Preview in the menu bar to switch states.');
});
app.on('window-all-closed', () => {});
app.on('before-quit', () => tray?.destroy());
app.on('will-quit', () => fs.rmSync(profile, { recursive: true, force: true }));
