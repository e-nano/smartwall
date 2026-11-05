#!/usr/bin/env python3
"""Optional Linux host updater. Fixed Compose operations, signed releases, no shell commands."""
import argparse
from contextlib import closing
import base64
import datetime as dt
import fcntl
import hashlib
import json
import os
from pathlib import Path
import re
import sqlite3
import subprocess
import tempfile
import time
import urllib.request

MAX_RELEASE_BYTES = 128 * 1024

def atomic_json(path, value):
    temporary = path.with_suffix('.tmp')
    with temporary.open('w') as stream:
        json.dump(value, stream); stream.write('\n'); stream.flush(); os.fsync(stream.fileno())
    os.chmod(temporary, 0o600 if path.name == 'state.json' else 0o644)
    os.replace(temporary, path)

def download(url, limit):
    if not url.startswith('https://'): raise ValueError('Release URLs must use HTTPS')
    with urllib.request.urlopen(url, timeout=45) as response:
        if not response.url.startswith('https://'): raise ValueError('Insecure release redirect')
        data = response.read(limit + 1)
    if len(data) > limit: raise ValueError('Release exceeds size limit')
    return data

def validate_release(data, expected_repository, channel):
    release = json.loads(data)
    if release.get('schema') != 1 or release.get('minimumSupervisor') != 1: raise ValueError('Unsupported release schema or supervisor version')
    if release.get('channel') != channel or not re.fullmatch(r'\d+\.\d+\.\d+(?:-[A-Za-z0-9.-]+)?', release.get('version', '')):
        raise ValueError('Invalid version or update channel')
    if (channel == 'stable') != ('-' not in release['version']): raise ValueError('Version/channel mismatch')
    image = release.get('image', '')
    if not re.fullmatch(re.escape(expected_repository) + r'@sha256:[a-f0-9]{64}', image): raise ValueError('Image must match the configured repository and immutable digest')
    published = dt.datetime.fromisoformat(release['publishedAt'].replace('Z', '+00:00'))
    if published.tzinfo is None or published > dt.datetime.now(dt.timezone.utc) + dt.timedelta(minutes=10): raise ValueError('Invalid publication date')
    return release

def verified_release(config):
    data = download(config['release_url'], MAX_RELEASE_BYTES)
    signature = base64.b64decode(download(config['release_url'] + '.sig', 2048).strip(), validate=True)
    with tempfile.TemporaryDirectory(prefix='smartwall-verify-') as directory:
        message, sig = Path(directory)/'release.json', Path(directory)/'signature'
        message.write_bytes(data); sig.write_bytes(signature)
        subprocess.run(['openssl', 'dgst', '-sha256', '-verify', config['public_key'], '-signature', str(sig), str(message)],
                       check=True, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL, timeout=10)
    release = validate_release(data, config['image_repository'], config.get('channel', 'stable'))
    return release, hashlib.sha256(data).hexdigest()

def snapshot_database(source, destination):
    if source.is_symlink() or source.parent.is_symlink(): raise ValueError("Database path must not be a symlink")
    for suffix in ("-wal", "-shm"):
        if Path(str(source)+suffix).is_symlink(): raise ValueError("Database sidecar must not be a symlink")
    if not source.exists(): return False
    with closing(sqlite3.connect(source)) as live, closing(sqlite3.connect(destination)) as snapshot:
        live.backup(snapshot)
        if snapshot.execute('PRAGMA integrity_check').fetchone()[0] != 'ok': raise RuntimeError('Database snapshot integrity check failed')
    os.chmod(destination, 0o600)
    return True

def version_order(version):
    main, separator, suffix = version.partition('-')
    numbers = tuple(map(int, main.split('.')))
    prerelease = tuple((0, int(value)) if value.isdigit() else (1, value) for value in suffix.split('.')) if separator else ()
    return (*numbers, 0 if separator else 1, prerelease)

class Supervisor:
    def __init__(self, directory):
        self.root = directory.resolve()
        self.private = self.root/'supervisor'
        self.control = self.root/'runtime/control'
        self.requests = self.root/'runtime/requests'
        self.config = json.loads((self.private/'config.json').read_text())
        self.state_path = self.private/'state.json'
        self.state = json.loads(self.state_path.read_text()) if self.state_path.exists() else {}
        self.env = self.root/'.env'
        self.marker = self.control/'maintenance'
        self.db = self.root/'runtime/data/smartwall.db'

    def compose(self, *args):
        subprocess.run(['docker', 'compose', '--project-directory', str(self.root), '-f', str(self.root/'compose.yaml'), *args],
                       cwd=self.root, check=True, timeout=600, stdout=subprocess.DEVNULL)

    def save(self): atomic_json(self.state_path, self.state)

    def status(self, **fields):
        atomic_json(self.control/'status.json', {'checkedAt': dt.datetime.now(dt.timezone.utc).isoformat(),
            'installedVersion': self.state.get('installed_version'), 'allowUpdates': self.config.get('allow_ui_updates', False), **fields})

    def audit(self, action, **fields):
        with (self.private/'audit.jsonl').open('a') as stream:
            stream.write(json.dumps({'at':dt.datetime.now(dt.timezone.utc).isoformat(), 'action':action, **fields})+'\n')

    def set_image(self, image):
        content = self.env.read_text()
        content, count = re.subn(r'^SMARTWALL_IMAGE=.*$', 'SMARTWALL_IMAGE='+image, content, flags=re.M)
        if count != 1: raise RuntimeError('Exactly one SMARTWALL_IMAGE setting is required')
        temporary = self.env.with_suffix('.tmp'); temporary.write_text(content); os.chmod(temporary,0o600); os.replace(temporary,self.env)

    def healthy(self, version=None):
        deadline = time.monotonic()+90
        while time.monotonic()<deadline:
            try:
                with urllib.request.urlopen('http://127.0.0.1:8080/health/ready',timeout=3) as response:
                    data=json.load(response)
                    if data.get('ok') and (version is None or data.get('version') == version): return
            except (OSError, ValueError): pass
            time.sleep(2)
        raise RuntimeError('SmartWall failed its readiness check')

    def recover(self):
        transaction = self.state.get('transaction')
        if not transaction: return
        if transaction['phase'] == 'committed':
            self.marker.unlink(missing_ok=True)
            self.state.pop('transaction'); self.save(); return
        self.compose('stop','smartwall')
        if transaction['phase'] in ('backed_up','switching'):
            if transaction['had_database']:
                snapshot=Path(transaction['backup'])
                # Restore via SQLite so WAL is reconciled, rather than copying one live file.
                with closing(sqlite3.connect(snapshot)) as source, closing(sqlite3.connect(self.db)) as dest: source.backup(dest)
                os.chown(self.db,1000,1000)
            elif self.db.exists():
                # Preserve a newly created failed database for diagnosis.
                for suffix in ('','-wal','-shm'):
                    path=Path(str(self.db)+suffix)
                    if path.exists(): os.replace(path,Path(str(path)+'.failed-'+transaction['id']))
        self.set_image(transaction['old_image'])
        self.compose('up','-d','--no-deps','smartwall')
        self.healthy()
        self.marker.unlink(missing_ok=True)
        self.state.pop('transaction'); self.save()
        self.audit('recovered', previousImage=transaction['old_image'])

    def install(self, release, digest):
        old_image = re.search(r'^SMARTWALL_IMAGE=(.+)$',self.env.read_text(),re.M).group(1)
        if old_image == release['image']: return
        previous = self.state.get('installed_version')
        if previous and version_order(release['version']) < version_order(previous):
            raise ValueError('Automatic downgrades are prohibited; use the documented recovery procedure')
        subprocess.run(['docker','pull',release['image']],check=True,timeout=900,stdout=subprocess.DEVNULL)
        identifier = str(time.time_ns())
        backup = self.private/f'backup-{identifier}.sqlite'
        self.state['transaction']={'id':identifier,'phase':'prepared','old_image':old_image,'backup':str(backup)}
        self.save()
        self.marker.touch(mode=0o644)
        try:
            self.compose('stop','smartwall')
            self.state['transaction']['had_database']=snapshot_database(self.db,backup)
            self.state['transaction']['phase']='backed_up'; self.save()
            self.set_image(release['image'])
            self.state['transaction']['phase']='switching'; self.save()
            self.compose('up','-d','--no-deps','smartwall')
            self.healthy(release['version'])
            self.state['installed_version']=release['version']
            self.state['installed_digest']=digest
            self.state['transaction']['phase']='committed'; self.save()
            self.marker.unlink(missing_ok=True)
            self.state.pop('transaction'); self.save()
            self.audit('installed',version=release['version'],image=release['image'])
        except Exception:
            self.state['failed_digest']=digest; self.save()
            self.recover()
            raise

    def in_window(self):
        hour=dt.datetime.now(dt.timezone.utc).hour
        window=self.config.get('maintenance_utc_hours',[2,4])
        start,end=window
        return start<=hour<end if start<end else hour>=start or hour<end

    def tick(self):
        self.recover()
        actions=[]
        for path in sorted(self.requests.glob('*.json'))[:20]:
            try:
                if path.is_symlink() or path.stat().st_size>4096: raise ValueError('Invalid request')
                action=json.loads(path.read_text())
                if action.get('action') not in ('check','apply'): raise ValueError('Unknown action')
                actions.append(action)
            except (OSError,ValueError): pass
            finally: path.unlink(missing_ok=True)
        pending = self.state.get('available_digest') not in (None, self.state.get('installed_digest'), self.state.get('failed_digest'))
        window_due = self.config.get('automatic_updates',False) and pending and self.in_window()
        if not actions and not window_due and time.time()-self.state.get('last_check',0)<21600: return
        release,digest=verified_release(self.config)
        self.state['last_check']=time.time(); self.state['available_digest']=digest; self.save()
        approved = self.config.get('allow_ui_updates',False) and any(a.get('action')=='apply' and a.get('manifestSha256')==digest for a in actions)
        automatic = self.config.get('automatic_updates',False) and self.in_window() and self.state.get('failed_digest')!=digest
        if approved or automatic:
            self.status(state='installing',candidate=release,manifestSha256=digest)
            self.install(release,digest)
        self.status(state='ready',candidate=release,manifestSha256=digest)

    def run(self):
        with (self.private/'lock').open('w') as lock:
            fcntl.flock(lock,fcntl.LOCK_EX|fcntl.LOCK_NB)
            try: self.tick()
            except Exception as error:
                self.audit('failed',message=str(error)); self.status(state='failed',error=str(error)); raise

if __name__ == '__main__':
    parser=argparse.ArgumentParser(); parser.add_argument('--directory',type=Path,required=True)
    args=parser.parse_args(); Supervisor(args.directory).run()
