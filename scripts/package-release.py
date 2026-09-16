"""Verify the desktop bundle and prepare the ZIP, checksum, and release notes."""
from pathlib import Path
import hashlib
import json
import plistlib
import re
import subprocess
import os
import zipfile
import sys
import platform as host_platform

root = Path(__file__).resolve().parents[1]
version = json.loads((root / 'package.json').read_text(encoding='utf-8'))['version']
assert re.fullmatch(r'(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)', version)
platform = os.environ.get('BUILD_PLATFORM', sys.platform)
arch = os.environ.get('BUILD_ARCH', 'arm64' if host_platform.machine().lower() in {'arm64', 'aarch64'} else 'x64')
assert (platform, arch) in {('darwin', 'arm64'), ('darwin', 'x64'), ('win32', 'x64')}
output = root / f'dist/MCP Router-{platform}-{arch}'
app = output / 'MCP Router.app' if platform == 'darwin' else output
resources = app / ('Contents/Resources' if platform == 'darwin' else 'resources')
bundle = resources / 'app'
if platform == 'darwin':
    metadata = plistlib.loads((app / 'Contents/Info.plist').read_bytes())
    assert metadata['CFBundleShortVersionString'] == version, 'Bundle version mismatch'
else:
    assert (app / 'MCP Router.exe').is_file()
assert json.loads((bundle / 'package.json').read_text(encoding='utf-8'))['version'] == version
for file in app.rglob('*'):
    relative = file.relative_to(app)
    assert not any(part in {'.git', '.local', '.private-release', '.DS_Store'} or part.startswith('.env') for part in relative.parts), relative
    assert file.suffix not in {'.key', '.pem', '.enc', '.sock', '.log'}, relative
    if file.is_symlink():
        assert file.resolve().is_relative_to(app.resolve()), f'External symlink: {relative}'
for folder in ['src', 'public', 'assets', 'licenses']:
    for file in (root / folder).rglob('*'):
        if file.is_file():
            relative = file.relative_to(root)
            assert (bundle / relative).read_bytes() == file.read_bytes(), f'Bundle differs: {relative}'
for name in ['LICENSE', 'README.md', 'PRIVACY.md', 'SECURITY.md', 'TERMS.md', 'BRANDING.md', 'THIRD_PARTY_NOTICES.md']:
    assert (bundle / name).read_bytes() == (root / name).read_bytes(), name
for name in ['runtime-notices/LICENSE', 'runtime-notices/LICENSES.chromium.html', 'legal.html']:
    assert (resources / name).stat().st_size > 0, name
out = root / 'dist/release'
out.mkdir(parents=True, exist_ok=True)
target = f"{'mac' if platform == 'darwin' else 'windows'}-{arch}"
archive = out / f'MCP-Router-{version}-{target}.zip'
if platform == 'darwin':
    subprocess.run(['ditto', '-c', '-k', '--norsrc', '--keepParent', str(app), str(archive)], check=True)
else:
    with zipfile.ZipFile(archive, 'w', zipfile.ZIP_DEFLATED) as archive_file:
        for file in sorted(app.rglob('*')):
            if file.is_file():
                archive_file.write(file, Path('MCP Router') / file.relative_to(app))
(out / f'SHA256SUMS-{target}.txt').write_text(hashlib.sha256(archive.read_bytes()).hexdigest() + '  ' + archive.name + '\n', encoding='utf-8', newline='\n')
changelog = (root / 'CHANGELOG.md').read_text(encoding='utf-8')
section = re.search(r'^## ' + re.escape(version) + r' — (.*?)(?=^## |\Z)', changelog, re.M | re.S)
assert section, 'Missing changelog entry'
notes = f'''{section.group(1).strip()}

## Install

Choose the ZIP for your computer: **mac-arm64** for Apple Silicon, **mac-x64** for Intel Mac, or **windows-x64** for Windows x64.

On Mac, extract and move **MCP Router.app** to Applications. Mac builds are unsigned and unnotarized. If blocked, first attempt to open the app, then use System Settings → Privacy & Security → Open Anyway for this trusted download.

On Windows, extract the entire ZIP into a permanent folder and run **MCP Router.exe**. Keep the resources and supporting files together. The Windows build is unsigned and may show a publisher warning.

For updates, quit MCP Router before replacing the app folder. Connections and settings remain in the separate application-data folder. Reconnect AI clients if you move the app.

SHA-256 checksum is included in SHA256SUMS.txt.
'''
(out / 'release-notes.md').write_text(notes, encoding='utf-8')
print(f'Verified bundle and prepared {archive.name}')
