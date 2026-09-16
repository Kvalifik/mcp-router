"""Verify the macOS bundle and prepare the ZIP, checksum, and release notes."""
from pathlib import Path
import hashlib
import json
import plistlib
import re
import subprocess

root = Path(__file__).resolve().parents[1]
version = json.loads((root / 'package.json').read_text())['version']
assert re.fullmatch(r'(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)', version)
app = root / 'dist/MCP Router-darwin-arm64/MCP Router.app'
resources = app / 'Contents/Resources'
bundle = resources / 'app'
metadata = plistlib.loads((app / 'Contents/Info.plist').read_bytes())
assert metadata['CFBundleShortVersionString'] == version, 'Bundle version mismatch'
assert json.loads((bundle / 'package.json').read_text())['version'] == version
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
archive = out / f'MCP-Router-{version}-mac-arm64.zip'
subprocess.run(['ditto', '-c', '-k', '--norsrc', '--keepParent', str(app), str(archive)], check=True)
(out / 'SHA256SUMS.txt').write_text(hashlib.sha256(archive.read_bytes()).hexdigest() + '  ' + archive.name + '\n')
changelog = (root / 'CHANGELOG.md').read_text()
section = re.search(r'^## ' + re.escape(version) + r' — (.*?)(?=^## |\Z)', changelog, re.M | re.S)
assert section, 'Missing changelog entry'
notes = f'''{section.group(1).strip()}

## Install

Download **{archive.name}**, extract it, and move **MCP Router.app** to Applications. Requires macOS on Apple Silicon (M1 or later).

This build is unsigned and unnotarized. If macOS blocks it, first attempt to open it, then use System Settings → Privacy & Security → Open Anyway for this trusted download.

For updates, quit MCP Router before replacing the app. Connections and settings remain in the separate application-data folder.

SHA-256 checksum is included in SHA256SUMS.txt.
'''
(out / 'release-notes.md').write_text(notes)
print(f'Verified bundle and prepared {archive.name}')
