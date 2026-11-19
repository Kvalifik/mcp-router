import fs from 'node:fs/promises';
import path from 'node:path';

// Keep release contents explicit; development files do not belong in the app.
const roots = new Set(['src', 'public', 'node_modules', 'assets', 'licenses']);
const files = new Set(['package.json', 'LICENSE', 'README.md', 'PRIVACY.md',
  'SECURITY.md', 'TERMS.md', 'BRANDING.md', 'THIRD_PARTY_NOTICES.md']);
export function excludeFromPackage(file) {
  const parts = file.replaceAll('\\', '/').replace(/^\//, '').split('/');
  if (!file || file === '/') return false;
  if (!roots.has(parts[0]) && !(parts.length === 1 && files.has(parts[0]))) return true;
  if (parts.some(part => ['.local', '.private-release', '.git'].includes(part) || part.startsWith('.env'))) return true;
  return /\.(key|pem|enc|sock|log)$/.test(file);
}

// Native version resources require a numeric marketing version. Keep the full
// release label in the application manifest that Electron reads on startup.
export function nativeVersions(version, platform) {
  const parts = /^((?:0|[1-9]\d*)\.(?:0|[1-9]\d*)\.(?:0|[1-9]\d*))(?:-rc\.([1-9]\d*))?$/.exec(version);
  if (!parts || Number(parts[2]) > 255) throw new Error('Expected a stable version or rc.1 through rc.255');
  const [, core, rc] = parts;
  const buildVersion = rc ? core + (platform === 'darwin' ? 'fc' : '.') + rc : core;
  return {appVersion:core, buildVersion};
}

export async function restoreCandidateLabel(resources, version) {
  if (!version.includes('-rc.')) return;
  const manifest = path.join(resources, 'app/package.json');
  const packaged = JSON.parse(await fs.readFile(manifest, 'utf8'));
  packaged.version = version;
  await fs.writeFile(manifest, JSON.stringify(packaged, null, 2) + '\n');
}
