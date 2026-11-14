const fs = require('node:fs');
const path = require('node:path');

// Kept outside the router store because this prompt runs before the server starts.
// Returns true when Electron has taken over quitting/relaunching the app.
async function offerApplicationMove({ app, dialog, platform = process.platform, applicationsDirectory = '/Applications' }) {
  if (platform !== 'darwin' || !app.isPackaged || app.isInApplicationsFolder()) return false;
  const preferenceFile = path.join(app.getPath('userData'), 'mac-install-prompt.json');
  try {
    if (JSON.parse(fs.readFileSync(preferenceFile, 'utf8')).dontAskAgain === true) return false;
  } catch { /* Missing or unreadable preferences must not prevent startup. */ }
  // Electron targets the local Applications directory using the current bundle name.
  const bundle = path.dirname(path.dirname(path.dirname(app.getPath('exe'))));
  const destination = path.join(applicationsDirectory, path.basename(bundle));
  const installedVersion = () => {
    if (!fs.existsSync(destination)) return null;
    const manifest = JSON.parse(fs.readFileSync(path.join(destination, 'Contents/Resources/app/package.json'), 'utf8'));
    if (manifest.name !== 'mcp-router' || typeof manifest.version !== 'string' ||
        !/^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$/.test(manifest.version)) throw new Error('Unknown installation');
    return manifest.version;
  };
  let existing;
  try { existing = installedVersion(); } catch {
    dialog.showErrorBox('Could not identify the installed app', 'No apps were replaced. Check the copy in Applications before trying again.');
    return false;
  }
  const replacing = existing !== null;
  const current = app.getVersion();
  const { response, checkboxChecked } = await dialog.showMessageBox({
    type: 'question',
    message: replacing ? 'Replace installed app and relaunch?' : 'Move MCP Router to Applications?',
    detail: replacing ? `Installed version: ${existing}\nThis copy: ${current}\n\nReplace the installed app with this copy and relaunch it from Applications. Connections and settings will be kept. Only continue if you want to install this version, including if it is older.` : 'Keep MCP Router in your Applications folder so it’s easy to find. The app will restart after moving.',
    buttons: [replacing ? 'Replace and Relaunch' : 'Move to Applications', 'Not Now'],
    defaultId: replacing ? 1 : 0,
    cancelId: 1,
    ...(replacing ? {} : { checkboxLabel: 'Don’t ask again' }),
    checkboxChecked: false,
    noLink: true,
  });
  if (!replacing && checkboxChecked) {
    try {
      fs.mkdirSync(app.getPath('userData'), { recursive: true, mode: 0o700 });
      fs.writeFileSync(preferenceFile, JSON.stringify({ dontAskAgain: true }) + '\n', { mode: 0o600 });
    } catch {
      dialog.showErrorBox('Could not save your preference', 'MCP Router may ask again next time you open it. You can continue using the app.');
    }
  }
  if (response !== 0) return false;
  let conflict = null;
  // Recheck after the asynchronous prompt, including the authorization-only path
  // in Electron, which does not invoke its conflict handler.
  try {
    if (installedVersion() !== existing) throw new Error('Installation changed');
  } catch {
    dialog.showErrorBox('The installed app changed', 'No apps were replaced. Open this copy again to review the current versions.');
    return false;
  }
  try {
    const moved = app.moveToApplicationsFolder({
      conflictHandler: type => {
        // Electron's running-copy behavior merely focuses that copy; it does not
        // replace it. Never report that as a successful installation.
        if (type === 'exists' && replacing) {
          try { if (installedVersion() === existing) return true; } catch {}
        }
        conflict = type;
        return false;
      },
    });
    if (moved) return true;
  } catch {
    dialog.showErrorBox('Could not move MCP Router', 'You can keep using the app here. To install it manually, quit MCP Router and drag it into Applications in Finder, or contact your IT administrator.');
    return false;
  }
  if (conflict) {
    await dialog.showMessageBox({
      type: 'info',
      message: conflict === 'existsAndRunning' ? 'Quit the installed app to replace it' : 'The installed app changed',
      detail: conflict === 'existsAndRunning' ? 'No apps were replaced. Quit MCP Router using its Quit command, then open this copy again and choose Replace and Relaunch.' : 'No apps were replaced. Open this copy again to review the current versions.',
      buttons: ['Continue'],
      noLink: true,
    });
  }
  // Cancellation (including a macOS authorization dialog) keeps startup usable.
  return false;
}

module.exports = { offerApplicationMove };
