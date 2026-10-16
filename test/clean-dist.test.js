import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';

test('distribution cleanup preserves current artifacts, backups and symlink targets', () => {
  const result = spawnSync(process.platform === 'win32' ? 'python' : 'python3', ['-c', `
import importlib.util, json, tempfile
from pathlib import Path
spec = importlib.util.spec_from_file_location('clean_dist', 'scripts/clean-dist.py')
module = importlib.util.module_from_spec(spec)
spec.loader.exec_module(module)
with tempfile.TemporaryDirectory() as temp:
    root = Path(temp)
    (root / 'package.json').write_text(json.dumps({'version': '0.8.10'}))
    dist = root / 'dist'
    release = dist / 'release'
    release.mkdir(parents=True)
    old = release / 'MCP-Router-0.8.9-mac-arm64.zip'
    current = release / 'MCP-Router-0.8.10-mac-arm64.zip'
    future = release / 'MCP-Router-0.9.0-mac-arm64.zip'
    backup = dist / 'install-backups'
    backup.mkdir()
    (backup / 'saved.zip').write_text('backup')
    for file in [old, current, future, dist / 'Webflow-Router-Icon-Assets.zip', dist / 'unknown.txt']:
        file.write_text('fixture')
    sums = release / 'SHA256SUMS.txt'
    sums.write_text('0' * 64 + '  ' + old.name + '\\n' + '1' * 64 + '  ' + current.name + '\\n')
    (release / 'update-mac-x64.json').write_text(json.dumps({'currentRelease': '0.8.9'}))
    bundle = dist / 'MCP Router-darwin-x64/MCP Router.app/Contents/Resources/app'
    bundle.mkdir(parents=True)
    (bundle / 'package.json').write_text(json.dumps({'version': '0.8.9'}))
    external = root / 'external'
    external.mkdir()
    (external / 'keep').write_text('safe')
    try:
        (dist / 'ci-release-0.1.0').symlink_to(external, target_is_directory=True)
    except OSError:
        pass  # Windows may require symlink privileges.
    module.clean_dist(root)
    assert not old.exists()
    assert current.exists() and future.exists()
    assert (backup / 'saved.zip').exists()
    assert (dist / 'Webflow-Router-Icon-Assets.zip').exists()
    assert (dist / 'unknown.txt').exists()
    assert not (dist / 'MCP Router-darwin-x64').exists()
    assert not (release / 'update-mac-x64.json').exists()
    assert (external / 'keep').exists()
    assert sums.read_text() == '1' * 64 + '  ' + current.name + '\\n'
    module.clean_dist(root)
`], { encoding: 'utf8' });
  assert.equal(result.status, 0, result.stderr || result.stdout);
});
