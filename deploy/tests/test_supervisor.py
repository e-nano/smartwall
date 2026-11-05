import importlib.util
import json
from pathlib import Path
import sqlite3
import tempfile
import unittest
from unittest.mock import patch
spec=importlib.util.spec_from_file_location('supervisor',Path(__file__).parents[1]/'supervisor/supervisor.py')
s=importlib.util.module_from_spec(spec);spec.loader.exec_module(s)
class ReleaseTests(unittest.TestCase):
    def test_only_pinned_repository_and_channel(self):
        r={'schema':1,'minimumSupervisor':1,'version':'1.2.3','channel':'stable','publishedAt':'2026-01-01T00:00:00Z','image':'ghcr.io/example/smartwall/edge@sha256:'+'a'*64}
        self.assertEqual(s.validate_release(json.dumps(r),'ghcr.io/example/smartwall/edge','stable')['version'],'1.2.3')
        with self.assertRaises(ValueError):s.validate_release(json.dumps(r),'ghcr.io/attacker/edge','stable')
        with self.assertRaises(ValueError):s.validate_release(json.dumps(r),'ghcr.io/example/smartwall/edge','beta')
        r['image']='ghcr.io/example/smartwall/edge:latest'
        with self.assertRaises(ValueError):s.validate_release(json.dumps(r),'ghcr.io/example/smartwall/edge','stable')
    def test_version_order_handles_beta_and_stable(self):
        versions=['1.2.3-beta.1','1.2.3-beta.2','1.2.3-beta.10','1.2.3','1.2.4']
        self.assertEqual(sorted(reversed(versions),key=s.version_order),versions)

    def test_snapshot_includes_wal(self):
        with tempfile.TemporaryDirectory() as directory:
            source=Path(directory)/'live.db';dest=Path(directory)/'backup.db'
            with sqlite3.connect(source) as db:
                db.execute('PRAGMA journal_mode=WAL');db.execute('CREATE TABLE stock(qty)');db.execute('INSERT INTO stock VALUES(42)');db.commit()
                self.assertTrue(s.snapshot_database(source,dest))
            with sqlite3.connect(dest) as snapshot:self.assertEqual(snapshot.execute('SELECT qty FROM stock').fetchone()[0],42)
    def test_failure_restores_database_and_old_image_before_reopening(self):
        with tempfile.TemporaryDirectory() as directory:
            root=Path(directory)
            for name in ['supervisor','runtime/control','runtime/requests','runtime/data']:(root/name).mkdir(parents=True)
            (root/'supervisor/config.json').write_text('{}')
            old='ghcr.io/example/edge@sha256:'+'a'*64;new='ghcr.io/example/edge@sha256:'+'b'*64
            (root/'.env').write_text('SMARTWALL_IMAGE='+old+'\n');agent=s.Supervisor(root)
            with sqlite3.connect(agent.db) as db:db.execute('CREATE TABLE stock(qty)');db.execute('INSERT INTO stock VALUES(42)')
            def readiness(version=None):
                if version:
                    with sqlite3.connect(agent.db) as db:db.execute('UPDATE stock SET qty=0')
                    raise RuntimeError('failed migration')
                self.assertTrue(agent.marker.exists())
            with patch.object(agent,'compose'),patch.object(agent,'healthy',side_effect=readiness),patch.object(s.subprocess,'run'),patch.object(s.os,'chown'):
                with self.assertRaisesRegex(RuntimeError,'failed migration'):agent.install({'version':'1.2.3','image':new},'c'*64)
            with sqlite3.connect(agent.db) as db:self.assertEqual(db.execute('SELECT qty FROM stock').fetchone()[0],42)
            self.assertIn(old,(root/'.env').read_text());self.assertFalse(agent.marker.exists());self.assertNotIn('transaction',agent.state)
    def test_committed_crash_recovery_preserves_success(self):
        with tempfile.TemporaryDirectory() as directory:
            root=Path(directory)
            for name in ['supervisor','runtime/control','runtime/requests']:(root/name).mkdir(parents=True)
            (root/'supervisor/config.json').write_text('{}');agent=s.Supervisor(root)
            agent.marker.touch();agent.state={'transaction':{'phase':'committed'}}
            with patch.object(agent,'compose') as compose:agent.recover();compose.assert_not_called()
            self.assertFalse(agent.marker.exists());self.assertNotIn('transaction',agent.state)
    def test_signed_descriptor_rejects_tampering(self):
        import subprocess, base64
        with tempfile.TemporaryDirectory() as directory:
            root=Path(directory);private=root/'private.pem';public=root/'publisher.pem'
            subprocess.run(['openssl','genpkey','-algorithm','RSA','-pkeyopt','rsa_keygen_bits:2048','-out',str(private)],check=True,stdout=subprocess.DEVNULL,stderr=subprocess.DEVNULL)
            subprocess.run(['openssl','pkey','-in',str(private),'-pubout','-out',str(public)],check=True,stdout=subprocess.DEVNULL,stderr=subprocess.DEVNULL)
            release={'schema':1,'minimumSupervisor':1,'version':'1.2.3','channel':'stable','publishedAt':'2026-01-01T00:00:00Z','image':'ghcr.io/example/edge@sha256:'+'a'*64}
            data=json.dumps(release).encode();(root/'release.json').write_bytes(data)
            signature=subprocess.check_output(['openssl','dgst','-sha256','-sign',str(private),str(root/'release.json')])
            config={'release_url':'https://example.test/release.json','public_key':str(public),'image_repository':'ghcr.io/example/edge'}
            with patch.object(s,'download',side_effect=[data,base64.b64encode(signature)]):
                verified,_=s.verified_release(config);self.assertEqual(verified['version'],'1.2.3')
            with patch.object(s,'download',side_effect=[data.replace(b'1.2.3',b'1.2.4'),base64.b64encode(signature)]):
                with self.assertRaises(subprocess.CalledProcessError):s.verified_release(config)

if __name__=='__main__':unittest.main()
