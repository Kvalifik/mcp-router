// OS login items are the source of truth; never register development Electron.
function createStartupSettings(app, platform) {
  const supported = app.isPackaged && ['darwin', 'win32'].includes(platform);
  function read() {
    if (!supported) return {supported:false, enabled:false};
    const settings = app.getLoginItemSettings();
    return {supported:true, enabled:settings.openAtLogin === true && (platform !== 'win32' || settings.executableWillLaunchAtLogin !== false), requiresApproval:settings.status === 'requires-approval'};
  }
  function set(enabled) {
    if (!supported || typeof enabled !== 'boolean') throw new Error('Invalid startup setting');
    app.setLoginItemSettings({openAtLogin:enabled, ...(platform === 'win32' ? {enabled} : {})});
    return read();
  }
  return {read, set};
}
module.exports = {createStartupSettings};
