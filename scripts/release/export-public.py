#!/usr/bin/env python3
"""Export local software and firmware without private portal code or Git history."""
import argparse
import shutil
from pathlib import Path
from public_source import audit, selected_files


def export(root, destination, preview=False, source_only=False):
    root = Path(root).resolve()
    destination = Path(destination).resolve()
    if destination.exists():
        raise ValueError('Destination must not exist; existing exports are never overwritten')
    if destination == root or root in destination.parents or destination in root.parents:
        raise ValueError('Destination must be outside the working repository')
    names = selected_files(root)
    errors = audit(root, names, require_license=not (preview or source_only))
    if errors:
        raise ValueError('\n'.join(errors))
    destination.mkdir(parents=True)
    try:
        for name in names:
            target = destination / name
            target.parent.mkdir(parents=True, exist_ok=True)
            shutil.copy2(root / name, target)
        errors = audit(destination, names, require_license=not (preview or source_only))
        if errors:
            raise ValueError('\n'.join(errors))
    except Exception:
        shutil.rmtree(destination)
        raise
    return names


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('destination', type=Path)
    modes = parser.add_mutually_exclusive_group()
    modes.add_argument('--preview', action='store_true', help='Create a local review copy before LICENSE is chosen')
    modes.add_argument('--source-only', action='store_true', help='Export source without granting a licence; official releases still require LICENSE')
    args = parser.parse_args()
    root = Path(__file__).resolve().parents[2]
    names = export(root, args.destination, args.preview, args.source_only)
    print(f'Exported {len(names)} public-source files to {args.destination}')
    if args.preview:
        print('Review preview only; official releases require an approved LICENSE.')
    if args.source_only:
        print('Source only: no open-source licence is granted; official releases remain blocked until LICENSE is approved.')
