// Rasterize the existing Lucide icons at 2x for native macOS template menus.
const {app,BrowserWindow}=require('electron');
const fs=require('node:fs');
const path=require('node:path');
const React=require('react');
const {renderToStaticMarkup}=require('react-dom/server');
const icons=require('lucide-react');
app.setPath('userData',fs.mkdtempSync('/tmp/router-menu-icons-'));
app.whenReady().then(async()=>{
  const window=new BrowserWindow({show:false,webPreferences:{sandbox:true,contextIsolation:true,nodeIntegration:false}});
  await window.loadURL('about:blank');
  const directory=path.join(__dirname,'../assets/icons/menu');fs.mkdirSync(directory,{recursive:true});
  for(const name of ['SunMoon','PanelTop','Monitor','Server','ArrowDownUp','ShieldCheck','Activity','RefreshCw','Info','Pencil','Trash2','MessageSquare','Code2','Terminal','Plus','Copy','Check','TriangleAlert']) {
    const svg=renderToStaticMarkup(React.createElement(icons[name],{size:16,color:'black',strokeWidth:2}));
    const png=await window.webContents.executeJavaScript(`new Promise((resolve,reject)=>{const img=new Image();img.onload=()=>{const canvas=document.createElement('canvas');canvas.width=32;canvas.height=32;canvas.getContext('2d').drawImage(img,0,0,32,32);resolve(canvas.toDataURL('image/png').split(',')[1]);};img.onerror=reject;img.src='data:image/svg+xml;base64,'+${JSON.stringify(Buffer.from(svg).toString('base64'))};})`);
    fs.writeFileSync(path.join(directory,`${name}.png`),Buffer.from(png,'base64'));
  }
  window.destroy();app.quit();
}).catch(error=>{console.error(error);app.exit(1);});
