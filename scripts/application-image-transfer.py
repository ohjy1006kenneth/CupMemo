"""Bounded two-image Docker-save validation; never extracts, loads or starts images.

The receipt is an integrity record, not a signature: authenticate its Actions
artifact/run/source identity independently before using the offline verify CLI.
Only Python's standard library is required. Invoke under timeout (CI: 240s).
"""
import argparse
import gzip
import hashlib
import io
import json
from pathlib import Path, PurePosixPath
import re
import resource
import shutil
import subprocess
import tarfile

GIB = 1024 ** 3
MAX_COMPRESSED = GIB
MAX_EXPANDED = 2 * GIB
MAX_JSON = 4 * 1024 ** 2
HEX = r'[0-9a-f]{64}'
# Docker inspect expands omitted legacy container.Config zero fields; OCI image
# configs can omit these. Only these exact absent zero values are equivalent.
CONFIG_DEFAULTS = {'Hostname': '', 'Domainname': '', 'User': '', 'AttachStdin': False,
                   'AttachStdout': False, 'AttachStderr': False, 'Tty': False,
                   'OpenStdin': False, 'StdinOnce': False, 'Image': '',
                   'Volumes': None, 'OnBuild': None, 'Labels': None,
                   'ExposedPorts': None, 'Env': None, 'Cmd': None, 'Entrypoint': None,
                   'WorkingDir': '', 'ArgsEscaped': False, 'StopSignal': '',
                   'StopTimeout': None, 'Healthcheck': None, 'Shell': None}


def require(condition, message):
    if not condition:
        raise ValueError(message)


def sha_file(path):
    digest = hashlib.sha256()
    with path.open('rb') as stream:
        while chunk := stream.read(1024 * 1024):
            digest.update(chunk)
    return digest.hexdigest()


class LimitedReader:
    """Bound the entire decompressed tar, including headers, padding and trailers."""
    def __init__(self, stream):
        self.stream = stream
        self.count = 0

    def read(self, size=-1):
        require(0 <= size <= MAX_EXPANDED, 'unbounded read')
        chunk = self.stream.read(size)
        self.count += len(chunk)
        require(self.count <= MAX_EXPANDED, 'expanded archive limit')
        return chunk


def scan(path, max_compressed):
    require(path.is_file() and 0 < path.stat().st_size <= max_compressed, 'compressed archive limit')
    members, small = {}, {}
    total_payload = 0
    small_bytes = 0
    with gzip.open(path, 'rb') as compressed:
        limited = LimitedReader(compressed)
        with tarfile.open(fileobj=limited, mode='r|') as archive:
            for member in archive:
                name = member.name
                require(name not in members and len(members) < 256, 'duplicate/member count limit')
                require(name and not name.startswith('/') and '\\' not in name
                        and all(p not in ('', '.', '..') for p in name.rstrip('/').split('/'))
                        and str(PurePosixPath(name)) == name.rstrip('/'), 'unsafe member path')
                require(member.isfile() or member.isdir(), 'nonregular archive member')
                # Directory entries carry no data and must be ancestors of declared files.
                if member.isdir():
                    require(member.size == 0, 'directory payload')
                    members[name] = {'directory': True}
                    continue
                require(0 <= member.size <= MAX_EXPANDED, 'member size limit')
                raw = io.BufferedReader(archive.extractfile(member))
                is_gzip = raw.peek(2)[:2] == b'\x1f\x8b'
                digest, size, data = hashlib.sha256(), 0, bytearray()
                # Hash stored bytes and uncompressed layer content without buffering layers.
                class HashReader(io.RawIOBase):
                    def readable(self):
                        return True

                    def readinto(self, buffer):
                        nonlocal size
                        chunk = raw.read(len(buffer))
                        digest.update(chunk)
                        size += len(chunk)
                        if member.size <= MAX_JSON:
                            data.extend(chunk)
                        buffer[:len(chunk)] = chunk
                        return len(chunk)
                stored = io.BufferedReader(HashReader())
                payload = gzip.GzipFile(fileobj=stored) if is_gzip else stored
                diff, expanded = hashlib.sha256(), 0
                while chunk := payload.read(1024 * 1024):
                    expanded += len(chunk)
                    require(expanded <= MAX_EXPANDED, 'expanded layer limit')
                    diff.update(chunk)
                require(size == member.size, 'truncated member')
                total_payload += expanded
                require(total_payload <= MAX_EXPANDED, 'aggregate payload limit')
                members[name] = {'sha256': digest.hexdigest(), 'bytes': size,
                                 'diff_id': 'sha256:' + diff.hexdigest(), 'uncompressed_bytes': expanded}
                if member.size <= MAX_JSON:
                    small_bytes += len(data)
                    require(small_bytes <= 16 * MAX_JSON, 'metadata memory limit')
                    small[name] = bytes(data)
            require(not any(archive.fileobj.buf), 'payload after tar terminator')
        # tarfile has consumed a small read-ahead block; remaining bytes must be padding.
        while chunk := limited.read(1024 * 1024):
            require(not any(chunk), 'unexpected trailing payload')
    return members, small


def build_receipt(path, images, identity, max_compressed=MAX_COMPRESSED):
    path = Path(path)
    require(set(images) == {'web', 'api'}, 'exactly web/api required')
    require(set(identity) == {'commit', 'tree', 'run_id', 'attempt'}, 'source identity fields')
    require(all(re.fullmatch(r'[0-9a-f]{40}', identity[k]) for k in ('commit', 'tree'))
            and all(re.fullmatch(r'[1-9][0-9]*', identity[k]) for k in ('run_id', 'attempt')), 'source identity')
    members, small = scan(path, max_compressed)

    def document(name):
        require(name in small, 'missing/oversized JSON member')
        return json.loads(small[name])

    manifest = document('manifest.json')
    require(isinstance(manifest, list) and len(manifest) == 2, 'two-image Docker-save manifest required')
    allowed = {'manifest.json'}
    results, known = {}, {}
    for kind, info in images.items():
        require(re.fullmatch('sha256:' + HEX, info['Id']) is not None, 'config ID required')
        require(re.fullmatch('sha256:' + HEX, info['ConfigId']) is not None, 'saved config ID required')
        require(info['ConfigId'] not in known, 'duplicate audited config')
        known[info['ConfigId']] = kind
    for entry in manifest:
        require(isinstance(entry, dict) and isinstance(entry.get('Layers'), list), 'malformed image manifest')
        config_name = entry['Config']
        require(config_name in members, 'missing config member')
        config_id = 'sha256:' + members[config_name]['sha256']
        require(config_id in known and known[config_id] not in results, 'unknown/duplicate config identity')
        kind = known[config_id]
        info = images[kind]
        config = document(config_name)
        require(config['os'] == info['Os'] == 'linux'
                and config['architecture'] == info['Architecture'] == 'arm64', 'platform identity')
        saved_config, inspected_config = config['config'], info['Config']
        require(all(saved_config.get(key, CONFIG_DEFAULTS.get(key, object())) ==
                    inspected_config.get(key, CONFIG_DEFAULTS.get(key, object()))
                    for key in saved_config.keys() | inspected_config.keys()), 'audited runtime Config mismatch')
        require(config['rootfs']['type'] == info['RootFS']['Type'] == 'layers', 'rootfs type')
        diffs = config['rootfs']['diff_ids']
        require(diffs == info['RootFS']['Layers'] and len(diffs) == len(entry['Layers']) and diffs,
                'ordered audited diff_ids mismatch')
        layer_records = []
        for name, diff_id in zip(entry['Layers'], diffs):
            require(name in members and 'sha256' in members[name], 'missing layer member')
            require(members[name]['diff_id'] == diff_id, 'uncompressed layer diff_id mismatch')
            allowed.add(name)
            layer_records.append({'member': name, **members[name]})
        allowed.add(config_name)
        results[kind] = {'Id': info['Id'], 'ConfigId': config_id, 'Os': 'linux', 'Architecture': 'arm64',
                         'Config': info['Config'], 'RootFS': info['RootFS'],
                         'SaveMetadata': info['SaveMetadata'],
                         'config_member': {'member': config_name, **members[config_name]},
                         'layers': layer_records}
    require(set(results) == {'web', 'api'}, 'missing image')

    # Docker's containerd store also emits an OCI index/manifest graph. Admit only
    # content-addressed reachable metadata whose config/layer edges match Docker-save.
    if 'index.json' in members or 'oci-layout' in members:
        require(document('oci-layout') == {'imageLayoutVersion': '1.0.0'}, 'OCI layout version')
        allowed.update(('index.json', 'oci-layout'))
        seen, oci_images = {}, set()

        def visit(descriptor, depth=0):
            require(depth <= 4 and isinstance(descriptor, dict), 'OCI graph depth/type')
            digest = descriptor['digest']
            require(re.fullmatch('sha256:' + HEX, digest) is not None, 'OCI digest')
            name = 'blobs/sha256/' + digest[7:]
            require(name in members and members[name].get('sha256') == digest[7:]
                    and members[name]['bytes'] == descriptor['size'], 'OCI descriptor integrity')
            allowed.add(name)
            if name in seen:
                return seen[name]
            media = descriptor['mediaType']
            value = document(name)
            require(value['schemaVersion'] == 2, 'OCI schema')
            if media in ('application/vnd.oci.image.index.v1+json', 'application/vnd.docker.distribution.manifest.list.v2+json'):
                descendants = set()
                for child in value['manifests']:
                    descendants.update(visit(child, depth + 1))
            else:
                require(media in ('application/vnd.oci.image.manifest.v1+json', 'application/vnd.docker.distribution.manifest.v2+json'), 'OCI media type')
                config_id = value['config']['digest']
                require(config_id in known and config_id not in oci_images, 'OCI unknown/duplicate image')
                oci_images.add(config_id)
                result = results[known[config_id]]
                expected = [result['config_member'], *result['layers']]
                actual = [value['config'], *value['layers']]
                require(len(actual) == len(expected), 'OCI layer count')
                for desc, record in zip(actual, expected):
                    require(desc['digest'] == 'sha256:' + record['sha256'] and desc['size'] == record['bytes'], 'OCI config/layer edge')
                descendants = {config_id}
            seen[name] = descendants
            return descendants
        index = document('index.json')
        require(index['schemaVersion'] == 2 and index['manifests'], 'OCI index schema')
        for descriptor in index['manifests']:
            visit(descriptor)
        # Moby28 classic save by two config IDs emits both OCI manifest blobs but
        # indexes only the first untagged image (save.go's global len check).
        # The Docker-save manifest still declares BOTH. Admit the other root only
        # when its hashed config/layer edges bind exactly to that declared image.
        for name, member in members.items():
            if not member.get('directory') and name.startswith('blobs/sha256/') and name not in allowed:
                value = document(name)
                declarations = [i['SaveMetadata'][name] for i in images.values() if name in i['SaveMetadata']]
                if declarations:
                    require(isinstance(value, dict) and re.fullmatch(HEX, value.get('id', ''))
                            and value.get('os') == 'linux', 'invalid legacy save metadata')
                    require(all(d == {'sha256': member['sha256'], 'bytes': member['bytes']} for d in declarations),
                            'legacy save metadata differs from audited single-image export')
                    allowed.add(name)
                    continue
                require(isinstance(value, dict) and value.get('mediaType') in
                        ('application/vnd.oci.image.manifest.v1+json', 'application/vnd.docker.distribution.manifest.v2+json'),
                        'undeclared OCI blob')
                visit({'digest': 'sha256:' + member['sha256'], 'size': member['bytes'], 'mediaType': value['mediaType']})
        require(oci_images == set(known), 'OCI image set mismatch')
        require(all(name in allowed for info in images.values() for name in info['SaveMetadata']),
                'missing declared legacy save metadata')
    for image in results.values():
        if image['Id'] != image['ConfigId']:
            require('index.json' in members and seen.get('blobs/sha256/' + image['Id'][7:]) == {image['ConfigId']},
                    'audited manifest ID must match reachable OCI graph')
    for name, member in members.items():
        if member.get('directory'):
            require(any(p.startswith(name.rstrip('/') + '/') for p in allowed), 'undeclared directory')
        else:
            require(name in allowed, 'undeclared archive member')
            if name.startswith('blobs/'):
                require(name == 'blobs/sha256/' + member['sha256'], 'blob path/content mismatch')
    return {'schema_version': 1, 'source': identity, 'platform': 'linux/arm64',
            'archive': {'sha256': sha_file(path), 'bytes': path.stat().st_size},
            'images': results, 'members': members}


def verify_receipt(path, receipt):
    require(receipt.get('schema_version') == 1, 'receipt schema version')
    path = Path(path)
    require(0 < path.stat().st_size <= MAX_COMPRESSED, 'compressed archive limit')
    require(path.stat().st_size == receipt['archive']['bytes']
            and sha_file(path) == receipt['archive']['sha256'], 'archive checksum/size mismatch')
    images = {kind: {key: image[key] for key in ('Id', 'ConfigId', 'Os', 'Architecture', 'Config', 'RootFS', 'SaveMetadata')}
              for kind, image in receipt['images'].items()}
    require(build_receipt(path, images, receipt['source']) == receipt, 'receipt identity mismatch')


def export_images(path, receipt_path, transfer_input):
    require(not path.exists() and not receipt_path.exists(), 'refuse existing output')
    images, identity = transfer_input['images'], transfer_input['identity']
    require(set(images) == {'web', 'api'} and all(re.fullmatch('sha256:' + HEX, v['Id'])
            for v in images.values()), 'immutable export IDs required')
    require(shutil.disk_usage(path.parent).free >= 3 * GIB, 'export disk admission')
    # Limit bytes written even before the final checksum/size check. The outer
    # caller runs under timeout240, and the save producer has its own180s limit.
    resource.setrlimit(resource.RLIMIT_FSIZE, (MAX_COMPRESSED, MAX_COMPRESSED))
    producer = subprocess.Popen(['timeout', '180', 'docker', 'image', 'save',
                                 images['web']['Id'], images['api']['Id']], stdout=subprocess.PIPE)
    assert producer.stdout is not None
    try:
        with path.open('xb') as output:
            with gzip.GzipFile(fileobj=output, mode='wb', compresslevel=1, mtime=0) as compressed:
                shutil.copyfileobj(producer.stdout, compressed, length=1024 * 1024)
        require(producer.wait(timeout=10) == 0, 'docker save failed')
        receipt = build_receipt(path, images, identity)
        with receipt_path.open('x') as output:
            json.dump(receipt, output, indent=2)
            output.write('\n')
    finally:
        producer.stdout.close()
        if producer.poll() is None:
            producer.terminate()
            producer.wait(timeout=10)


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('archive', type=Path)
    parser.add_argument('receipt', type=Path)
    parser.add_argument('--export-input', type=Path, help='CI-only audited image/source JSON; otherwise verify offline')
    args = parser.parse_args()
    try:
        if args.export_input:
            require(args.export_input.stat().st_size <= MAX_JSON, 'export input limit')
            export_images(args.archive, args.receipt, json.loads(args.export_input.read_text()))
        else:
            require(args.receipt.stat().st_size <= MAX_JSON, 'receipt size limit')
            verify_receipt(args.archive, json.loads(args.receipt.read_text()))
    except (ValueError, KeyError, TypeError, OSError, EOFError, tarfile.TarError) as error:
        detail = str(error) if isinstance(error, ValueError) else type(error).__name__
        raise SystemExit('Application image transfer REFUSED: ' + detail)
    print('Application image transfer integrity PASS (not activation authority).')
