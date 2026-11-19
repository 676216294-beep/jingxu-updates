"""Build existing updater-compatible assets from repository text files."""
import hashlib
import json
import os
from pathlib import Path
import re
import zipfile

def build(root):
    root = Path(root).resolve()
    release = json.loads((root / 'updates/release.json').read_text('utf-8-sig'))
    version = release['version']
    if not re.fullmatch(r'\d+\.\d+\.\d+', version):
        raise ValueError('Invalid release version')
    payload = root / 'payload'
    manifest = json.loads((payload / 'release-manifest.json').read_text('utf-8-sig'))
    if manifest['version'] != version or manifest['format'] != 'jingxu-update-v1':
        raise ValueError('Manifest mismatch')
    files = []
    for entry in manifest['files']:
        name = entry['path']
        parts = name.replace('\\', '/').split('/')
        if '\\' in name or ':' in name or any(p in ('', '.', '..') for p in parts) or parts[0] in ('data', '.updates', '.git', 'distribution-subscription.json', 'startup.log'):
            raise ValueError('Unsafe payload path')
        file = payload / name
        if not file.resolve().is_relative_to(payload.resolve()) or file.is_symlink():
            raise ValueError('Payload outside root')
        content = file.read_bytes()
        if name.lower().endswith('.ps1') and any(b > 127 for b in content) and not content.startswith(b'\xef\xbb\xbf'):
            raise ValueError('Non-ASCII PowerShell script requires UTF-8 BOM: ' + name)
        if hashlib.sha256(content).hexdigest() != entry['sha256']:
            raise ValueError('File checksum mismatch: ' + name)
        if re.search(rb'hm_live_[a-zA-Z0-9_-]{12,}', content):
            raise ValueError('Potential credential in payload')
        files.append((name, content))
    dist = root / 'dist'
    dist.mkdir(exist_ok=True)
    name = f'jingxu-update-{version}.zip'
    with zipfile.ZipFile(dist / name, 'w', compression=zipfile.ZIP_DEFLATED) as z:
        for file, content in files:
            z.writestr(file, content)
        z.write(payload / 'release-manifest.json', 'release-manifest.json')
    digest = hashlib.sha256((dist / name).read_bytes()).hexdigest()
    (dist / 'SHA256SUMS.txt').write_text(f'{digest}  {name}\n', 'utf-8')
    (dist / 'NOTES.md').write_text(release['notes'], 'utf-8')
    return version

if __name__ == '__main__':
    version = build(Path.cwd())
    if os.environ.get('GITHUB_OUTPUT'):
        with open(os.environ['GITHUB_OUTPUT'], 'a', encoding='utf-8') as f:
            f.write(f'version={version}\n')
    print('Built version ' + version)
