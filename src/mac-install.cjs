const fs = require('node:fs');
const path = require('node:path');

// Kept outside the router store because this prompt runs before the server starts.
// Returns true when Electron has taken over quitting/relaunching the app.
async function offerApplicationMove({ app, dialog, platform = process.platform }) {
  if (platform !== 'darwin' || !app.isPackaged || app.isInApplicationsFolder()) return false;
  const preferenceFile = path.join(app.getPath('userData'), 'mac-install-prompt.json');
  try {
    if (JSON.parse(fs.readFileSync(preferenceFile, 'utf8')).dontAskAgain === true) return false;
  } catch { /* Missing or unreadable preferences must not prevent startup. */ }
  const { response, checkboxChecked } = await dialog.showMessageBox({
    type: 'question',
    message: 'Move MCP Router to Applications?',
    detail: 'Keep MCP Router in your Applications folder so it’s easy to find. The app will restart after moving.',
    buttons: ['Move to Applications', 'Not Now'],
    defaultId: 0,
    cancelId: 1,
    checkboxLabel: 'Don’t ask again',
    checkboxChecked: false,
    noLink: true,
  });
  if (checkboxChecked) {
    try {
      fs.mkdirSync(app.getPath('userData'), { recursive: true, mode: 0o700 });
      fs.writeFileSync(preferenceFile, JSON.stringify({ dontAskAgain: true }) + '\n', { mode: 0o600 });
    } catch {
      dialog.showErrorBox('Could not save your preference', 'MCP Router may ask again next time you open it. You can continue using the app.');
    }
  }
  if (response !== 0) return false;
  let conflict = false;
  try {
    const moved = app.moveToApplicationsFolder({
      // Never silently replace another installation or switch to an older copy.
      conflictHandler: () => { conflict = true; return false; },
    });
    if (moved) return true;
  } catch {
    dialog.showErrorBox('Could not move MCP Router', 'You can keep using the app here. To install it manually, quit MCP Router and drag it into Applications in Finder, or contact your IT administrator.');
    return false;
  }
  if (conflict) {
    await dialog.showMessageBox({
      type: 'info',
      message: 'MCP Router is already in Applications',
      detail: 'No apps were replaced. You can keep using this copy. To replace the installed copy, quit MCP Router and move this copy into Applications using Finder.',
      buttons: ['Continue'],
      noLink: true,
    });
  }
  // Cancellation (including a macOS authorization dialog) keeps startup usable.
  return false;
}

module.exports = { offerApplicationMove };
