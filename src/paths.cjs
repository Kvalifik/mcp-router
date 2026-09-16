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
 const legacy = `${path.sep}WebflowRouter${path.sep}router${path.sep}router.sock`;
 return socket.endsWith(legacy) ? socket.slice(0, -legacy.length) + `${path.sep}MCPRouter${path.sep}router${path.sep}router.sock` : socket;
}
module.exports = {migrateUserData, currentSocket};
