const { contextBridge, ipcRenderer } = require('electron');
contextBridge.exposeInMainWorld('routerDesktop', {
  checkUpdates: () => ipcRenderer.invoke('check-updates'),
  downloadUpdate: () => ipcRenderer.invoke('download-update'),
  openPublisher: () => ipcRenderer.invoke('open-publisher'),
  openLicenses: () => ipcRenderer.invoke('open-licenses'),
  onShowAbout: callback => { const handler = () => callback(); ipcRenderer.on('show-about', handler); return () => ipcRenderer.removeListener('show-about', handler); },
  integratedTitleBar: ['darwin', 'win32'].includes(process.platform),
  titleBarPlatform: process.platform,
  toolbarDrag: phase => ipcRenderer.send('toolbar-drag',phase),
  openProject: (shortName,destination) => ipcRenderer.invoke('open-project',shortName,destination),
  openOAuth: url => ipcRenderer.invoke('open-oauth', url),
  setTheme: theme => ipcRenderer.invoke('set-theme',theme),
  copyClientConfig: format => ipcRenderer.invoke('copy-client-config',format),
  clientDownload: id => ipcRenderer.invoke('client-download',id),
  clientStatus: () => ipcRenderer.invoke('client-status'),
  connectClient: id => ipcRenderer.invoke('connect-client', id)
});
