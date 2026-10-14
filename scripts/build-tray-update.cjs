// Rebuild the approved update-ready badge at each macOS scale.
const {app,BrowserWindow}=require('electron');
const fs=require('node:fs');
const path=require('node:path');
app.setPath('userData',fs.mkdtempSync('/tmp/router-tray-icons-'));
app.whenReady().then(async()=>{
  const window=new BrowserWindow({show:false,webPreferences:{sandbox:true,contextIsolation:true,nodeIntegration:false}});
  await window.loadURL('about:blank');
  const mark=fs.readFileSync(path.join(__dirname,'../assets/icons/mark-black.svg'),'utf8').replace('<svg ','<svg x="2" y="2" ').replace('width="672" height="672"','width="18" height="18"');
  const svg=`<svg xmlns="http://www.w3.org/2000/svg" width="25" height="24"><defs><mask id="gap"><rect width="25" height="24" fill="white"/><circle cx="17" cy="16.5" r="7.3" fill="black"/></mask></defs><g mask="url(#gap)">${mark}</g><circle cx="17" cy="16.5" r="5.5" fill="none" stroke="black" stroke-width="1.35"/><path d="M17 19.5v-6m-2.5 2.5 2.5-2.5 2.5 2.5" fill="none" stroke="black" stroke-width="1.35" stroke-linecap="round" stroke-linejoin="round"/></svg>`;
  for(const scale of [1,2,3]) {
    const png=await window.webContents.executeJavaScript(`new Promise((resolve,reject)=>{const img=new Image();img.onload=()=>{const c=document.createElement('canvas');c.width=25*${scale};c.height=24*${scale};c.getContext('2d').drawImage(img,0,0,c.width,c.height);resolve(c.toDataURL('image/png').split(',')[1]);};img.onerror=reject;img.src='data:image/svg+xml;base64,${Buffer.from(svg).toString('base64')}';})`);
    fs.writeFileSync(path.join(__dirname,`../assets/icons/menubar/MCPRouterUpdateTemplate${scale>1?`@${scale}x`:''}.png`),Buffer.from(png,'base64'));
  }
  window.destroy();app.quit();
}).catch(error=>{console.error(error);app.exit(1);});
