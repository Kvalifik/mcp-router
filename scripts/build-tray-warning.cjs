// Rebuild the approved masked warning badge at each macOS scale.
const {app,BrowserWindow}=require('electron');
const fs=require('node:fs');
const path=require('node:path');
app.setPath('userData',fs.mkdtempSync('/tmp/router-tray-icons-'));
app.whenReady().then(async()=>{
  const window=new BrowserWindow({show:false,webPreferences:{sandbox:true,contextIsolation:true,nodeIntegration:false}});
  await window.loadURL('about:blank');
  const mark=fs.readFileSync(path.join(__dirname,'../assets/icons/mark-black.svg'),'utf8').replace('<svg ','<svg x="2" y="2" ').replace('width="672" height="672"','width="18" height="18"');
  const triangle='M 17 10.5 L 23 20.5 Q 23.5 21.5 22.3 21.5 L 11.7 21.5 Q 10.5 21.5 11.2 20.3 L 16 10.5 Q 16.5 9.6 17 10.5 Z';
  const svg=`<svg xmlns="http://www.w3.org/2000/svg" width="25" height="24" viewBox="0 0 25 24"><defs><mask id="gap"><rect width="25" height="24" fill="white"/><path d="${triangle}" fill="black" stroke="black" stroke-width="3.8" stroke-linejoin="round"/></mask></defs><g mask="url(#gap)">${mark}</g><path d="${triangle}" fill="none" stroke="black" stroke-width="1.35" stroke-linejoin="round"/><path d="M16.6 14.1v3.2" stroke="black" stroke-width="1.3" stroke-linecap="round"/><circle cx="16.6" cy="19.2" r=".75"/></svg>`;
  for(const scale of [1,2,3]) {
    const png=await window.webContents.executeJavaScript(`new Promise((resolve,reject)=>{const img=new Image();img.onload=()=>{const c=document.createElement('canvas');c.width=25*${scale};c.height=24*${scale};c.getContext('2d').drawImage(img,0,0,c.width,c.height);resolve(c.toDataURL('image/png').split(',')[1]);};img.onerror=reject;img.src='data:image/svg+xml;base64,${Buffer.from(svg).toString('base64')}';})`);
    fs.writeFileSync(path.join(__dirname,`../assets/icons/menubar/MCPRouterWarningTemplate${scale>1?`@${scale}x`:''}.png`),Buffer.from(png,'base64'));
  }
  window.destroy();app.quit();
}).catch(error=>{console.error(error);app.exit(1);});
