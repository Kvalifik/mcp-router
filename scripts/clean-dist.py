"""Remove recognized obsolete distribution outputs; preserve unknown files/backups."""
import json
from pathlib import Path
import re
import shutil


def clean_dist(root):
    current = json.loads((root / 'package.json').read_text())['version']
    version_tuple = lambda value: tuple(map(int, value.split('.')))
    older = lambda value: version_tuple(value) < version_tuple(current)
    dist = root / 'dist'
    if not dist.exists() or dist.is_symlink():
        return

    def remove(item):
        if item.is_symlink():
            return
        if item.is_dir():
            shutil.rmtree(item)
        else:
            item.unlink()
        print(f'Removed {item.relative_to(root)}')

    for folder in [dist, dist / 'release']:
        if not folder.is_dir() or folder.is_symlink():
            continue
        for item in list(folder.iterdir()):
            if item.is_symlink():
                continue
            match = re.fullmatch(r'(?:MCP-Router-|Webflow-Router-|mcp-router-(?:source-)?)(\d+\.\d+\.\d+)-?.*\.zip', item.name)
            ci = re.fullmatch(r'ci-release-(\d+\.\d+\.\d+)', item.name)
            if match and older(match[1]) or ci and older(ci[1]):
                remove(item)
            elif item.name == '.DS_Store':
                remove(item)
            elif re.fullmatch(r'(?:MCP|Webflow) Router-(?:darwin-(?:arm64|x64)|win32-x64)', item.name):
                manifest = item / ('resources/app/package.json' if 'win32' in item.name else f'{item.name.split("-darwin")[0]}.app/Contents/Resources/app/package.json')
                try:
                    obsolete = older(json.loads(manifest.read_text())['version'])
                except (OSError, ValueError, KeyError):
                    obsolete = False
                if obsolete:
                    remove(item)
        # Retain only checksum entries for archives that still exist.
        for checksum in folder.glob('SHA256SUMS*.txt'):
            if checksum.is_symlink():
                continue
            lines = [line for line in checksum.read_text().splitlines()
                     if re.fullmatch(r'[a-fA-F0-9]{64}  [^/\\]+', line)
                     and (folder / line[66:]).is_file()]
            if lines:
                checksum.write_text('\n'.join(lines) + '\n', encoding='utf-8', newline='\n')
            else:
                remove(checksum)
        for feed in folder.glob('update-mac-*.json'):
            if feed.is_symlink():
                continue
            try:
                if older(json.loads(feed.read_text())['currentRelease']):
                    remove(feed)
            except (ValueError, KeyError):
                pass
        notes = folder / 'release-notes.md'
        if notes.is_file() and not list(folder.glob('MCP-Router-*.zip')):
            remove(notes)


if __name__ == '__main__':
    clean_dist(Path(__file__).resolve().parents[1])
