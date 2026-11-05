#!/usr/bin/env python3
"""Reject private hosted-service code and obvious credentials before publication."""
import argparse
import subprocess
from pathlib import Path
from public_source import audit

parser = argparse.ArgumentParser(description=__doc__)
parser.add_argument('--directory', type=Path, help='Audit every file in an export, without Git')
parser.add_argument('--source-only', action='store_true', help='Check source boundaries without granting a licence; never use in official release jobs')
args = parser.parse_args()
root = (args.directory or Path.cwd()).resolve()
if args.directory:
    names = [p.relative_to(root).as_posix() for p in root.rglob('*') if p.is_file() or p.is_symlink()]
else:
    names = list(filter(None, subprocess.check_output(['git', 'ls-files', '-z'], cwd=root).decode().split('\0')))
errors = audit(root, names, require_license=not args.source_only)
if errors:
    raise SystemExit('\n'.join(errors))
print('Public source boundary and credential checks passed. Review contents before publishing; this is not a history audit.')

if args.source_only and not (root / 'LICENSE').exists():
    print('Licence pending: source checks passed, but official releases remain blocked.')
