import { packager } from '@electron/packager';
import { excludeFromPackage } from './packaging.mjs';
import { fileURLToPath } from 'node:url';
import fs from 'node:fs/promises';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
const dir = fileURLToPath(new URL('.', import.meta.url));
const { version } = JSON.parse(await fs.readFile(path.join(dir, 'package.json'), 'utf8'));
const platform = process.env.BUILD_PLATFORM || process.platform;
const arch = process.env.BUILD_ARCH || process.arch;
if (!['darwin:arm64', 'darwin:x64', 'win32:x64'].includes(`${platform}:${arch}`)) throw new Error('Unsupported release target');
if (platform === 'darwin' && process.platform !== 'darwin') throw new Error('Mac builds require macOS for ad-hoc signing');
const resourcesFor = output => path.join(output, platform === 'darwin' ? 'MCP Router.app/Contents/Resources' : 'resources');
const paths = await packager({
  icon: platform === 'darwin' ? `${dir}/assets/icons/MCPRouter.icns` : `${dir}/assets/icons/MCPRouter.ico`,
  dir, name: 'MCP Router', executableName: 'MCP Router', appBundleId: 'dk.kvalifik.mcp-router',
  appVersion: version, platform, arch, out: `${dir}/dist`,
  overwrite: true, prune: true, asar: false,
  electronZipDir: process.env.ELECTRON_ZIP_DIR,
  ignore: excludeFromPackage,
  usageDescription: {},
});
// Keep runtime notices inside the app when users distribute only the .app bundle.
for (const output of paths) {
  const notices = path.join(resourcesFor(output), 'runtime-notices');
  await fs.mkdir(notices, { recursive: true });
  for (const file of ['LICENSE', 'LICENSES.chromium.html']) await fs.copyFile(path.join(output, file), path.join(notices, file));
}
const escapeHtml = value => value.replace(/[&<>"']/g, char => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[char]));
for (const output of paths) {
  const resources = resourcesFor(output);
  const dependencies = await fs.readFile(path.join(dir, 'THIRD_PARTY_NOTICES.md'), 'utf8');
  const electron = await fs.readFile(path.join(resources, 'runtime-notices/LICENSE'), 'utf8');
  await fs.writeFile(path.join(resources, 'legal.html'), `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'; frame-src file:"><title>Third-party licenses — MCP Router</title><style>:root{color-scheme:light dark}body{font:14px/1.6 system-ui;margin:32px;max-width:1000px}h1{font-size:24px;margin-bottom:4px}p{opacity:.75}details{border:1px solid #8886;border-radius:8px;margin:16px 0;padding:16px}summary{cursor:pointer;font-weight:600}pre{white-space:pre-wrap;overflow-wrap:anywhere;font:12px/1.6 ui-monospace,monospace}iframe{border:0;width:100%;height:65vh;margin-top:16px}</style></head><body><h1>Third-party licenses</h1><p>MCP Router · Kvalifik ApS<br>These components retain their original licenses.</p><details open><summary>Application dependencies and shadcn/ui</summary><pre>${escapeHtml(dependencies)}</pre></details><details><summary>Electron</summary><pre>${escapeHtml(electron)}</pre></details><details><summary>Chromium and bundled runtime components</summary><iframe title="Chromium license notices" sandbox src="runtime-notices/LICENSES.chromium.html"></iframe></details></body></html>`);
}
// Sign only after all bundle resources are final. Replace Electron's inherited
// signatures, retaining its runtime entitlements and flags on nested code.
if (platform === 'darwin') {
  for (const output of paths) {
    const app = path.join(output, 'MCP Router.app');
    execFileSync('codesign', ['--force', '--deep', '--sign', '-', '--timestamp=none',
      '--preserve-metadata=entitlements,flags,runtime', app], { stdio: 'inherit' });
    execFileSync('codesign', ['--verify', '--deep', '--strict', '--verbose=2', app], { stdio: 'inherit' });
  }
}
console.log(paths.join('\n'));
