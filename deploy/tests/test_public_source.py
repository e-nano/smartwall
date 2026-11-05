import importlib.util
import sys
import tempfile
import unittest
from pathlib import Path

SCRIPTS = Path(__file__).resolve().parents[2] / 'scripts' / 'release'
sys.path.insert(0, str(SCRIPTS))
from public_source import allowed, audit

spec = importlib.util.spec_from_file_location('export_public', SCRIPTS / 'export-public.py')
exporter = importlib.util.module_from_spec(spec)
spec.loader.exec_module(exporter)


class PublicationBoundaryTests(unittest.TestCase):
    def test_private_service_and_history_are_rejected(self):
        for path in ['platform/cloud-backend/src/index.ts', 'platform/cloud-backend/public/index.html',
                     'platform/infra/gcp/main.tf', 'deploy/cloud/compose.yaml',
                     'platform/cloudbuild.mirror.yaml', 'platform/deploy/configure-invitation-email.py',
                     '.git/config', 'platform/.env', 'platform/data/smartwall.db',
                     'platform/backend/src/.secrets.ts', '../README.md', '/README.md']:
            with self.subTest(path=path):
                self.assertFalse(allowed(path))

    def test_local_client_is_public(self):
        for path in ['src/main.cpp', 'platform/backend/src/cloud-sync.ts',
                     'platform/frontend/src/components/ConnectWallModal.tsx',
                     'deploy/edge/Dockerfile', 'platform/.env.example']:
            self.assertTrue(allowed(path), path)

    def test_export_omits_private_source_even_when_present(self):
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary) / 'private'
            root.mkdir()
            for name in ['LICENSE', 'README.md', 'platform/backend/src/cloud-sync.ts',
                         'platform/cloud-backend/public/index.html', 'platform/.env', '.git/config']:
                path = root / name
                path.parent.mkdir(parents=True, exist_ok=True)
                path.write_text('fixture')
            output = Path(temporary) / 'public'
            names = exporter.export(root, output)
            self.assertEqual(set(names), {'LICENSE', 'README.md', 'platform/backend/src/cloud-sync.ts'})
            self.assertEqual(audit(output, names), [])
            self.assertFalse((output / '.git').exists())
            self.assertFalse((output / 'platform/cloud-backend').exists())
            with self.assertRaises(ValueError):
                exporter.export(root, output)

    def test_export_refuses_symlink_to_private_source(self):
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary) / 'private'
            root.mkdir()
            (root / 'LICENSE').write_text('fixture')
            source = root / 'platform/backend/src'
            source.mkdir(parents=True)
            (source / 'linked.ts').symlink_to(root / 'LICENSE')
            with self.assertRaises(ValueError):
                exporter.export(root, Path(temporary) / 'public')

    def test_license_required_except_local_preview(self):
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary) / 'private'
            root.mkdir()
            (root / 'README.md').write_text('fixture')
            with self.assertRaises(ValueError):
                exporter.export(root, Path(temporary) / 'public')
            exporter.export(root, Path(temporary) / 'preview', preview=True)

    def test_secret_in_allowed_file_is_rejected(self):
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary)
            (root / 'README.md').write_text('-----BEGIN ' + 'PRIVATE KEY-----')
            self.assertTrue(any('private key' in e for e in audit(root, ['README.md'], require_license=False)))

    def test_source_only_export_keeps_release_gate_and_private_boundary(self):
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary) / 'private'
            root.mkdir()
            (root / 'README.md').write_text('fixture')
            private = root / 'platform/cloud-backend/src/index.ts'
            private.parent.mkdir(parents=True)
            private.write_text('private server')
            output = Path(temporary) / 'public'
            names = exporter.export(root, output, source_only=True)
            self.assertEqual(names, ['README.md'])
            self.assertFalse((output / 'platform/cloud-backend').exists())
            self.assertTrue(any('LICENSE' in e for e in audit(output, names)))
            self.assertEqual(audit(output, names, require_license=False), [])
