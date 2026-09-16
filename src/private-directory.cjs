const fs = require('node:fs');
const path = require('node:path');
const {execFileSync} = require('node:child_process');
function privateDirectory(dir) {
 fs.mkdirSync(dir, {recursive:true, mode:0o700});
 if (process.platform !== 'win32') { fs.chmodSync(dir,0o700); return; }
 // Set an exact protected ACL before writing credentials. Pass the path as data.
 const script = `Import-Module (Join-Path $PSHOME 'Modules/Microsoft.PowerShell.Security/Microsoft.PowerShell.Security.psd1') -ErrorAction Stop; $acl = New-Object System.Security.AccessControl.DirectorySecurity; $sid = [System.Security.Principal.WindowsIdentity]::GetCurrent().User; $acl.SetOwner($sid); $acl.SetAccessRuleProtection($true, $false); $rule = New-Object System.Security.AccessControl.FileSystemAccessRule($sid, 'FullControl', 'ContainerInherit,ObjectInherit', 'None', 'Allow'); $acl.AddAccessRule($rule); Set-Acl -LiteralPath $env:ROUTER_PRIVATE_DIRECTORY -AclObject $acl -ErrorAction Stop`;
 execFileSync(path.join(process.env.SystemRoot || 'C:/Windows','System32/WindowsPowerShell/v1.0/powershell.exe'), ['-NoProfile','-NonInteractive','-Command',script], {env:{...process.env,ROUTER_PRIVATE_DIRECTORY:path.resolve(dir)},windowsHide:true,stdio:'pipe'});
}
module.exports = {privateDirectory};
