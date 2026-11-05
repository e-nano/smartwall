"""Shared publication boundary for the local SmartWall community project."""
import json
import re
from pathlib import Path, PurePosixPath

POLICY = json.loads(Path(__file__).with_name('public-source.json').read_text())
PRIVATE_TREES = ('platform/cloud-backend', 'platform/infra/gcp', 'deploy/cloud', 'assets')


def allowed(name):
    path = PurePosixPath(name)
    if path.is_absolute() or '..' in path.parts:
        return False
    if any(name == root or name.startswith(root + '/') for root in PRIVATE_TREES):
        return False
    if name in POLICY['files']:
        return True
    if any(part.startswith('.') or part in ('node_modules', 'dist', '__pycache__', 'runtime')
           for part in path.parts):
        return False
    return any(name.startswith(root + '/') and
               (path.suffix in extensions or path.name in extensions)
               for root, extensions in POLICY['trees'].items())


def selected_files(root):
    """Select reviewed source roots only; never traverse the private service."""
    root = Path(root)
    names = {name for name in POLICY['files'] if (root / name).exists() or (root / name).is_symlink()}
    for directory in POLICY['trees']:
        base = root / directory
        if base.is_symlink():
            raise ValueError(f'{directory}: symbolic link source root is forbidden')
        for path in base.rglob('*'):
            name = path.relative_to(root).as_posix()
            if path.is_symlink():
                raise ValueError(f'{name}: symbolic links are forbidden in public source')
            if path.is_file() and allowed(name):
                names.add(name)
    return sorted(names)


def audit(root, names, require_license=True):
    root = Path(root).resolve()
    errors = []
    for name in names:
        if not allowed(name):
            errors.append(f'{name}: outside the public source allowlist')
            continue
        path = root / name
        if any(parent.is_symlink() for parent in [path, *path.parents] if parent != root):
            errors.append(f'{name}: symbolic links are forbidden')
            continue
        if not path.is_file():
            errors.append(f'{name}: source file is missing')
            continue
        content = path.read_bytes()
        if re.search(rb'-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----|\b(?:ghp_|github_pat_)[A-Za-z0-9_]{30,}', content):
            errors.append(f'{name}: probable private key or access token')
    if require_license and ('LICENSE' not in names or not (root / 'LICENSE').is_file()):
        errors.append('LICENSE: choose and add a licence before public release')
    return errors
