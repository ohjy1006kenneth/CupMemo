"""Behavioral fixtures for the actual Docker-save transfer validator (no Docker/DB)."""
import copy
import gzip
import hashlib
import importlib.util
import io
import json
from pathlib import Path
import tarfile
import tempfile
import unittest
from unittest.mock import Mock, patch

SPEC = importlib.util.spec_from_file_location(
    'transfer', Path(__file__).resolve().parents[1] / 'scripts/application-image-transfer.py')
assert SPEC is not None and SPEC.loader is not None
transfer = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(transfer)


def encoded(value):
    return json.dumps(value, separators=(',', ':')).encode()


def digest(value):
    return 'sha256:' + hashlib.sha256(value).hexdigest()


class TransferTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        self.path = Path(self.temp.name) / 'application-images.tar.gz'
        self.members = {}
        self.images = {}
        self.manifest = []
        shared = b'shared layer tar bytes'
        self.members['blobs/sha256/' + digest(shared)[7:]] = shared
        for kind in ('web', 'api'):
            layer = gzip.compress((kind + ' layer tar bytes').encode())
            layer_name = 'blobs/sha256/' + digest(layer)[7:]
            self.members[layer_name] = layer
            diffs = [digest(shared), digest(gzip.decompress(layer))]
            config = {'os': 'linux', 'architecture': 'arm64', 'config': {'User': 'node', 'Cmd': ['node', kind]},
                      'rootfs': {'type': 'layers', 'diff_ids': diffs}}
            raw = encoded(config)
            config_name = 'blobs/sha256/' + digest(raw)[7:]
            self.members[config_name] = raw
            self.images[kind] = {'Id': digest(raw), 'ConfigId': digest(raw), 'Os': 'linux', 'Architecture': 'arm64', 'SaveMetadata': {},
                                 'Config': config['config'], 'RootFS': {'Type': 'layers', 'Layers': diffs}}
            self.manifest.append({'Config': config_name, 'RepoTags': None,
                                  'Layers': ['blobs/sha256/' + digest(shared)[7:], layer_name]})
        self.identity = {'commit': 'a' * 40, 'tree': 'b' * 40, 'run_id': '123', 'attempt': '1'}

    def write(self, extra=None):
        members = {**self.members, 'manifest.json': encoded(self.manifest)}
        if extra:
            members.update(extra)
        with tarfile.open(self.path, 'w:gz') as archive:
            for name, raw in members.items():
                member = tarfile.TarInfo(name)
                member.size = len(raw)
                archive.addfile(member, io.BytesIO(raw))

    def receipt(self):
        return transfer.build_receipt(self.path, self.images, self.identity)

    def test_two_images_ordered_layers_and_shared_member(self):
        self.write()
        receipt = self.receipt()
        self.assertEqual(receipt['schema_version'], 1)
        self.assertEqual(set(receipt['images']), {'web', 'api'})
        self.assertEqual(receipt['images']['web']['layers'][0], receipt['images']['api']['layers'][0])
        self.assertEqual(len(receipt['members']), 6)
        transfer.verify_receipt(self.path, receipt)

    def test_corrupt_archive_checksum(self):
        self.write()
        receipt = self.receipt()
        receipt['archive']['sha256'] = '0' * 64
        with self.assertRaises(ValueError):
            transfer.verify_receipt(self.path, receipt)

    def test_platform_and_saved_config_refusal(self):
        self.write()
        self.images['web']['Architecture'] = 'amd64'
        with self.assertRaises(ValueError):
            self.receipt()
        self.images['web']['Architecture'] = 'arm64'
        self.images['web']['ConfigId'] = 'sha256:' + '0' * 64
        with self.assertRaises(ValueError):
            self.receipt()

    def test_export_exact_ids_and_failure_never_writes_ready_receipt(self):
        self.write()
        raw_tar = gzip.decompress(self.path.read_bytes())
        output = self.path.parent / 'export.tar.gz'
        receipt_path = self.path.parent / 'receipt.json'
        for code in (1, 0):
            producer = Mock(stdout=io.BytesIO(raw_tar))
            producer.wait.return_value = code
            with patch.object(transfer.resource, 'setrlimit') as bound, \
                    patch.object(transfer.shutil, 'disk_usage', return_value=Mock(free=4 * transfer.GIB)), \
                    patch.object(transfer.subprocess, 'Popen', return_value=producer) as save:
                if code:
                    with self.assertRaises(ValueError):
                        transfer.export_images(output, receipt_path, {'images': self.images, 'identity': self.identity})
                    self.assertFalse(receipt_path.exists())
                    output.unlink()
                else:
                    transfer.export_images(output, receipt_path, {'images': self.images, 'identity': self.identity})
                    transfer.verify_receipt(output, json.loads(receipt_path.read_text()))
                self.assertEqual(save.call_args.args[0], ['timeout', '180', 'docker', 'image', 'save',
                                 self.images['web']['Id'], self.images['api']['Id']])
                bound.assert_called_once_with(transfer.resource.RLIMIT_FSIZE,
                                               (transfer.GIB, transfer.GIB))

    def test_corrupt_receipt_layer(self):
        self.write()
        receipt = self.receipt()
        receipt['images']['web']['layers'][0]['sha256'] = '0' * 64
        with self.assertRaises(ValueError):
            transfer.verify_receipt(self.path, receipt)

    def test_config_byte_identity(self):
        name = self.manifest[0]['Config']
        self.members[name] += b' '
        self.write()
        with self.assertRaises(ValueError):
            self.receipt()

    def test_audited_runtime_config_identity(self):
        self.images['api']['Config']['User'] = 'root'
        self.write()
        with self.assertRaises(ValueError):
            self.receipt()

    def test_only_absent_inspect_zero_defaults_are_equivalent(self):
        self.write()
        self.images['api']['Config'].update({'Hostname': '', 'AttachStdin': False, 'OnBuild': None})
        self.receipt()
        self.images['api']['Config']['Hostname'] = 'changed'
        with self.assertRaises(ValueError):
            self.receipt()

    def test_audited_diff_id_order(self):
        self.images['api']['RootFS']['Layers'].reverse()
        self.write()
        with self.assertRaises(ValueError):
            self.receipt()

    def test_layer_byte_corruption(self):
        name = self.manifest[0]['Layers'][1]
        self.members[name] = gzip.compress(b'corrupt layer')
        self.write()
        with self.assertRaises(ValueError):
            self.receipt()

    def test_missing_extra_traversal_absolute_and_malformed(self):
        for extra in ({'extra.txt': b'no'}, {'../escape': b'no'}, {'/absolute': b'no'},
                      {'blobs/sha256/not-a-digest': b'no'}, {'manifest.json': b'{'}):
            with self.subTest(extra=list(extra)):
                self.write(extra)
                with self.assertRaises((ValueError, json.JSONDecodeError)):
                    self.receipt()
        del self.members[self.manifest[0]['Layers'][0]]
        self.write()
        with self.assertRaises(ValueError):
            self.receipt()

    def test_unknown_or_duplicate_image(self):
        self.manifest[1] = copy.deepcopy(self.manifest[0])
        self.write()
        with self.assertRaises(ValueError):
            self.receipt()

    def test_symlink_duplicate_and_oversize_refused(self):
        self.write()
        with tarfile.open(self.path, 'w:gz') as archive:
            member = tarfile.TarInfo('manifest.json')
            member.type = tarfile.SYMTYPE
            member.linkname = '/etc/passwd'
            archive.addfile(member)
        with self.assertRaises(ValueError):
            self.receipt()
        with tarfile.open(self.path, 'w:gz') as archive:
            for _ in range(2):
                member = tarfile.TarInfo('manifest.json')
                member.size = 2
                archive.addfile(member, io.BytesIO(b'[]'))
        with self.assertRaises(ValueError):
            self.receipt()
        self.write()
        with self.assertRaises(ValueError):
            transfer.build_receipt(self.path, self.images, self.identity, max_compressed=1)

    def test_oci_metadata_is_reachable_hashed_and_bounded(self):
        descriptors = []
        for entry in self.manifest:
            def descriptor(name, media):
                return {'mediaType': media, 'digest': digest(self.members[name]), 'size': len(self.members[name])}
            manifest = {'schemaVersion': 2,
                        'mediaType': 'application/vnd.oci.image.manifest.v1+json',
                        'config': descriptor(entry['Config'], 'application/vnd.oci.image.config.v1+json'),
                        'layers': [descriptor(name, 'application/vnd.oci.image.layer.v1.tar') for name in entry['Layers']]}
            raw = encoded(manifest)
            name = 'blobs/sha256/' + digest(raw)[7:]
            self.members[name] = raw
            descriptors.append(descriptor(name, manifest['mediaType']))
            self.images['web' if entry is self.manifest[0] else 'api']['Id'] = digest(raw)
        metadata = {'oci-layout': encoded({'imageLayoutVersion': '1.0.0'}),
                    'index.json': encoded({'schemaVersion': 2, 'manifests': descriptors})}
        self.write(metadata)
        self.receipt()
        legacy = encoded({'id': 'c' * 64, 'created': '1970-01-01T00:00:00Z', 'os': 'linux'})
        legacy_name = 'blobs/sha256/' + digest(legacy)[7:]
        self.members[legacy_name] = legacy
        self.write(metadata)
        with self.assertRaises(ValueError):
            self.receipt()  # Not an arbitrary allowlist of legacy-shaped JSON.
        self.images['web']['SaveMetadata'][legacy_name] = {'sha256': digest(legacy)[7:], 'bytes': len(legacy)}
        self.receipt()
        self.images['web']['SaveMetadata'][legacy_name]['bytes'] += 1
        with self.assertRaises(ValueError):
            self.receipt()
        self.images['web']['SaveMetadata'][legacy_name]['bytes'] -= 1
        # Moby28.0.4 indexes only the first of two untagged selected IDs,
        # while both hashed OCI roots and Docker-save images are present.
        metadata['index.json'] = encoded({'schemaVersion': 2, 'manifests': descriptors[:1]})
        self.write(metadata)
        self.receipt()
        metadata['index.json'] = encoded({'schemaVersion': 2, 'manifests': descriptors})
        self.write(metadata)
        self.images['web']['Id'], self.images['api']['Id'] = self.images['api']['Id'], self.images['web']['Id']
        with self.assertRaises(ValueError):
            self.receipt()
        self.images['web']['Id'], self.images['api']['Id'] = self.images['api']['Id'], self.images['web']['Id']
        descriptors[0]['size'] += 1
        metadata['index.json'] = encoded({'schemaVersion': 2, 'manifests': descriptors})
        self.write(metadata)
        with self.assertRaises(ValueError):
            self.receipt()
        metadata['index.json'] = encoded({'schemaVersion': 2, 'manifests': []})
        self.write(metadata)
        with self.assertRaises(ValueError):
            self.receipt()


if __name__ == '__main__':
    unittest.main()
