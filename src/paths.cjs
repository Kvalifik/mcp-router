const fs = require('node:fs');
const path = require('node:path');
function migrateUserData(appData) {
 const old = path.join(appData, 'WebflowRouter'), current = path.join(appData, 'MCPRouter');
 if (fs.existsSync(old) && !fs.existsSync(current)) {
  const lock = path.join(old, 'router/daemon.lock');
  if (fs.existsSync(lock)) {
   const pid = Number(fs.readFileSync(lock, 'utf8'));
   if (Number.isInteger(pid) && pid > 0) {
    try { process.kill(pid, 0); throw new Error('Quit the previous router before migration'); }
    catch (error) { if (error.code !== 'ESRCH') throw error; }
   }
  }
  fs.renameSync(old, current);
 }
 return current;
}
function currentSocket(socket) {
 return socket.replace(/([/\\])WebflowRouter([/\\]router[/\\]router\.sock)$/, '$1MCPRouter$2');
}
function ipcEndpoint(socket, platform = process.platform) {
 if (platform !== 'win32') return socket;
 const hash = require('node:crypto').createHash('sha256').update(path.win32.resolve(socket).toLowerCase()).digest('hex');
 return '\\\\.\\pipe\\mcp-router-' + hash;
}
module.exports = {migrateUserData, currentSocket, ipcEndpoint};
