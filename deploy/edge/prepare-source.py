#!/usr/bin/env python3
"""Prepare a fresh source-build trial. Official releases use supervisor/install.py."""
import argparse
import ipaddress
import os
from pathlib import Path
import re
import secrets
import shutil


def prepare(directory, lan_ip, image):
    address = ipaddress.IPv4Address(lan_ip)
    if address.is_loopback or address.is_unspecified or address.is_multicast or int(address) == 0xffffffff:
        raise ValueError('Use the workshop host LAN IPv4 address')
    if not re.fullmatch(r'smartwall-edge:[a-zA-Z0-9_][a-zA-Z0-9_.-]{0,127}', image):
        raise ValueError('Use a local image tag such as smartwall-edge:source-trial')
    if os.geteuid() != 0:
        raise ValueError('Run with sudo to assign persistent files to container user 1000')
    root = Path(directory).absolute()
    # mkdir without exist_ok also rejects symlinks and prevents overwriting a wall.
    root.mkdir(parents=True, mode=0o755)
    for name in ('compose.yaml', 'broker.sh'):
        shutil.copyfile(Path(__file__).with_name(name), root / name)
    for name in ('data', 'data/mqtt', 'firmware', 'requests', 'control', 'secrets'):
        path = root / 'runtime' / name
        path.mkdir(parents=True, exist_ok=True)
        path.chmod(0o755 if name == 'control' else 0o700)
        if name != 'control':
            os.chown(path, 1000, 1000)
    for name in ('admin_password', 'mqtt_password', 'ota_secret'):
        path = root / 'runtime/secrets' / name
        path.write_text(secrets.token_hex(32) + '\n')
        path.chmod(0o400)
        os.chown(path, 1000, 1000)
    (root / '.env').write_text(
        f'SMARTWALL_IMAGE={image}\nLAN_IP={address}\nHTTP_HOST=127.0.0.1\nAUTO_UPDATE_FIRMWARE=false\n')
    (root / '.env').chmod(0o600)
    # No publisher key or signed release is claimed by a source build. Disable
    # update requests as well as automatic installation until explicitly enrolled.
    (root / 'compose.override.yaml').write_text(
        'services:\n  smartwall:\n    environment:\n'
        '      FIRMWARE_PUBLIC_KEY_FILE: ""\n'
        '      SMARTWALL_RELEASE_URL: ""\n'
        '      RELEASE_REQUEST_DIR: ""\n')
    return root


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--directory', type=Path, default=Path('/opt/smartwall-preview'))
    parser.add_argument('--lan-ip', required=True)
    parser.add_argument('--image', default='smartwall-edge:source-trial')
    args = parser.parse_args()
    try:
        root = prepare(args.directory, args.lan_ip, args.image)
    except (ValueError, OSError) as error:
        parser.exit(1, f'Cannot prepare installation: {error}\n')
    print(f'Prepared source trial at {root}; software and firmware updates are disabled.')
    print(f'Start: sudo docker compose --project-directory {root} up -d')
    print('Open http://127.0.0.1:8080 and choose your username and password.')
    print(f'One-time setup code: sudo cat {root}/runtime/secrets/admin_password')


if __name__ == '__main__':
    main()
