import importlib.util
import os
from pathlib import Path
import tempfile
import unittest
from unittest.mock import patch

spec = importlib.util.spec_from_file_location('prepare_source',
    Path(__file__).resolve().parents[1] / 'edge/prepare-source.py')
installer = importlib.util.module_from_spec(spec)
spec.loader.exec_module(installer)


class SourcePreparationTests(unittest.TestCase):
    def test_fresh_private_installation_without_update_authority(self):
        with tempfile.TemporaryDirectory() as temporary, patch.object(os, 'geteuid', return_value=0), patch.object(os, 'chown'):
            root = installer.prepare(Path(temporary) / 'wall', '192.168.1.10', 'smartwall-edge:source-trial')
            values = []
            for name in ('admin_password', 'mqtt_password', 'ota_secret'):
                secret = root / 'runtime/secrets' / name
                values.append(secret.read_text().strip())
                self.assertEqual(secret.stat().st_mode & 0o777, 0o400)
            self.assertEqual(len(set(values)), 3)
            self.assertTrue(all(len(value) == 64 for value in values))
            self.assertEqual((root / '.env').stat().st_mode & 0o777, 0o600)
            self.assertIn('HTTP_HOST=127.0.0.1', (root / '.env').read_text())
            override = (root / 'compose.override.yaml').read_text()
            for variable in ('FIRMWARE_PUBLIC_KEY_FILE', 'SMARTWALL_RELEASE_URL', 'RELEASE_REQUEST_DIR'):
                self.assertIn(f'{variable}: ""', override)
            self.assertFalse((root / 'runtime/secrets/publisher.pem').exists())
            self.assertFalse((root / 'runtime/data/cloud-connection.json').exists())

    def test_existing_wall_and_symlink_are_never_overwritten(self):
        with tempfile.TemporaryDirectory() as temporary, patch.object(os, 'geteuid', return_value=0):
            root = Path(temporary)
            marker = root / 'inventory'
            marker.write_text('keep')
            with self.assertRaises(FileExistsError):
                installer.prepare(root, '192.168.1.10', 'smartwall-edge:source-trial')
            link = root / 'link'
            link.symlink_to(root, target_is_directory=True)
            with self.assertRaises(FileExistsError):
                installer.prepare(link, '192.168.1.10', 'smartwall-edge:source-trial')
            self.assertEqual(marker.read_text(), 'keep')

    def test_invalid_network_or_image_is_rejected_before_writes(self):
        with tempfile.TemporaryDirectory() as temporary, patch.object(os, 'geteuid', return_value=0):
            root = Path(temporary) / 'wall'
            for address in ('127.0.0.1', '0.0.0.0', '224.0.0.1', '255.255.255.255', 'bad\nIP'):
                with self.assertRaises(ValueError):
                    installer.prepare(root, address, 'smartwall-edge:source-trial')
            with self.assertRaises(ValueError):
                installer.prepare(root, '192.168.1.10', 'smartwall-edge:trial\nHTTP_HOST=0.0.0.0')
            self.assertFalse(root.exists())

    def test_requires_root_for_volume_ownership(self):
        with patch.object(os, 'geteuid', return_value=1000):
            with self.assertRaises(ValueError):
                installer.prepare('/not-created', '192.168.1.10', 'smartwall-edge:source-trial')
