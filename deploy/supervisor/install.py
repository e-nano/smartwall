#!/usr/bin/env python3
"""Prepare a Linux installation; never download unsigned code or alter an existing wall."""
import argparse
import ipaddress
import json
import os
from pathlib import Path
import secrets
import shutil
import re
from supervisor import verified_release

parser=argparse.ArgumentParser()
parser.add_argument('--directory',type=Path,default=Path('/opt/smartwall'))
parser.add_argument('--lan-ip',required=True)
parser.add_argument('--release-url',required=True)
parser.add_argument('--image-repository',required=True)
parser.add_argument('--public-key',type=Path,required=True)
parser.add_argument('--channel',choices=['stable','beta'],default='stable')
args=parser.parse_args()
if os.geteuid()!=0: raise SystemExit('Run the installer with sudo to assign container volume ownership.')
address=ipaddress.IPv4Address(args.lan_ip)
if address.is_loopback or address.is_unspecified or address.is_multicast: raise SystemExit('Use the LAN IPv4 address bins can reach')
if not re.fullmatch(r'ghcr\.io/[a-z0-9._/-]+',args.image_repository): raise SystemExit('Invalid image repository')
root=args.directory.resolve()
if root.exists(): raise SystemExit('Destination already exists; installer will not overwrite it')
config={'release_url':args.release_url,'image_repository':args.image_repository,'public_key':str(args.public_key.resolve()),
        'channel':args.channel,'allow_ui_updates':True,'automatic_updates':False,'maintenance_utc_hours':[2,4]}
release,digest=verified_release(config)
root.mkdir(parents=True,mode=0o755)
source=Path(__file__).resolve().parents[1]
for name in ('compose.yaml','broker.sh'): shutil.copyfile(source/'edge'/name,root/name)
for name in ('data','data/mqtt','firmware','requests','secrets','control'):
    path=root/'runtime'/name; path.mkdir(parents=True,exist_ok=True)
    os.chmod(path,0o755 if name=='control' else 0o700)
    if name!='control': os.chown(path,1000,1000)
for name in ('admin_password','mqtt_password','ota_secret'):
    path=root/'runtime/secrets'/name; path.write_text(secrets.token_hex(32)+'\n'); os.chmod(path,0o400); os.chown(path,1000,1000)
shutil.copyfile(args.public_key,root/'runtime/secrets/publisher.pem')
private=root/'supervisor'; private.mkdir(mode=0o700)
shutil.copyfile(Path(__file__).with_name('supervisor.py'),private/'supervisor.py')
config['public_key']=str(root/'runtime/secrets/publisher.pem')
(private/'config.json').write_text(json.dumps(config,indent=2)+'\n')
(private/'state.json').write_text(json.dumps({'installed_version':release['version'],'installed_digest':digest})+'\n')
content=f'SMARTWALL_IMAGE={release["image"]}\nLAN_IP={address}\nHTTP_HOST=127.0.0.1\nSMARTWALL_RELEASE_URL={args.release_url}\nAUTO_UPDATE_FIRMWARE=false\n'
(root/'.env').write_text(content); os.chmod(root/'.env',0o600)
print(f'Installation prepared at {root}. Start with: sudo docker compose --project-directory {root} up -d')
print(f'Administrator username: admin. Password is stored in {root}/runtime/secrets/admin_password')
print('The optional supervisor timer can now be installed using the supplied systemd units.')
