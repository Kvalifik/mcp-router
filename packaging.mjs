// Keep release contents explicit; development files do not belong in the app.
const roots = new Set(['src', 'public', 'node_modules', 'assets', 'licenses']);
const files = new Set(['package.json', 'LICENSE', 'README.md', 'PRIVACY.md',
  'SECURITY.md', 'TERMS.md', 'BRANDING.md', 'THIRD_PARTY_NOTICES.md']);
export function excludeFromPackage(file) {
  const parts = file.replace(/^\//, '').split('/');
  if (!file || file === '/') return false;
  if (!roots.has(parts[0]) && !(parts.length === 1 && files.has(parts[0]))) return true;
  if (parts.some(part => ['.local', '.private-release', '.git'].includes(part) || part.startsWith('.env'))) return true;
  return /\.(key|pem|enc|sock|log)$/.test(file);
}
