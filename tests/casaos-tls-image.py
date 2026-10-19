"""Audit official-parent prefix and exactly one build-time capability removal.

python3 tests/casaos-tls-image.py <explicit-local-image>
No pull, package installation or production resource access.
"""
import gzip
import hashlib
import io
import json
from pathlib import Path
import re
import subprocess
import sys
import tarfile
import tempfile


def run(argv):
    return subprocess.check_output(argv, text=True, timeout=180).strip()


base = re.findall(r'^FROM (\S+)$', Path('infrastructure/docker/caddy-private.Dockerfile').read_text(), re.M)[0]
original = json.loads(run(['docker', 'image', 'inspect', base]))[0]
image = json.loads(run(['docker', 'image', 'inspect', sys.argv[1]]))[0]
assert image['Os'] == original['Os'] == 'linux'
assert image['Architecture'] == original['Architecture'] == 'arm64'
base_layers = original['RootFS']['Layers']
assert image['RootFS']['Layers'][:len(base_layers)] == base_layers
added = image['RootFS']['Layers'][len(base_layers):]
assert len(added) == 1
assert image['Config'] == original['Config'], 'effective runtime config changed'

# Save once: the verified prefix shares exactly the parent's diff_ids. Decode
# effective entries rather than equating tar order/timestamps with payload bytes.
with tempfile.TemporaryDirectory(prefix='cupmemo-tls-audit-') as temporary:
    save = Path(temporary) / 'image.tar'
    subprocess.run(['docker', 'image', 'save', '-o', str(save), image['Id']], check=True, timeout=180)
    layers = {}
    with tarfile.open(save) as outer:
        for member in outer:
            if not member.isfile():
                continue
            stream = outer.extractfile(member)
            assert stream is not None
            # Docker29 OCI blobs may be gzip; legacy save layer.tar is plain.
            with tempfile.TemporaryFile() as raw:
                first = stream.read(2)
                if first == b'\x1f\x8b':
                    stream = gzip.GzipFile(fileobj=io.BytesIO(first + stream.read()))
                    first = b''
                digest = hashlib.sha256()
                digest.update(first); raw.write(first)
                while chunk := stream.read(1024 * 1024):
                    digest.update(chunk); raw.write(chunk)
                identity = 'sha256:' + digest.hexdigest()
                if identity not in image['RootFS']['Layers']:
                    continue
                raw.seek(0)
                entries = {}
                with tarfile.open(fileobj=raw) as layer:
                    for item in layer:
                        name = item.name.rstrip('/')
                        assert '/.wh.' not in '/' + name, 'unexpected whiteout'
                        content = None
                        if item.isfile():
                            payload = layer.extractfile(item)
                            assert payload is not None
                            hasher = hashlib.sha256()
                            while chunk := payload.read(1024 * 1024):
                                hasher.update(chunk)
                            content = hasher.hexdigest()
                        entries[name] = {
                            'type': item.type.decode('ascii'), 'mode': item.mode,
                            'uid': item.uid, 'gid': item.gid, 'link': item.linkname,
                            'size': item.size, 'content_sha256': content,
                            'mtime': item.mtime, 'pax': item.pax_headers,
                        }
                layers[identity] = entries
    assert set(layers) == set(image['RootFS']['Layers'])
    effective = {}
    for identity in base_layers:
        effective.update(layers[identity])
    delta = layers[added[0]]
    assert 'usr/bin/caddy' in delta
    assert set(delta) <= {'usr', 'usr/bin', 'usr/bin/caddy'}
    representation = {}
    for name, after in delta.items():
        before = effective[name]
        expected = dict(before)
        expected['pax'] = dict(before['pax'])
        if name == 'usr/bin/caddy':
            assert expected['pax'].pop('SCHILY.xattr.security.capability', None), 'parent capability absent'
            assert 'SCHILY.xattr.security.capability' not in after['pax']
        # BuildKit may encode fractional mtime differently. Accept only equal
        # numeric instant, retaining the exact representation delta in receipt.
        bp = expected['pax'].pop('mtime', str(expected['mtime']))
        ap = dict(after['pax']); aq = ap.pop('mtime', str(after['mtime']))
        from decimal import Decimal
        assert Decimal(bp) == Decimal(aq), ('mtime changed', name, bp, aq)
        compared = dict(after); compared['pax'] = ap
        expected['mtime'] = after['mtime']
        assert compared == expected, ('unrelated effective metadata/payload delta', name, before, after)
        if bp != aq:
            representation[name] = {'parent_mtime_encoding': bp, 'final_mtime_encoding': aq}

# Probe package list and xattr without invoking the parent's capable executable.
packages = []
caps = []
for ref in [original['Id'], image['Id']]:
    prefix = ['docker', 'run', '--rm', '--pull', 'never', '--network', 'none',
              '--user', '12346', '--read-only', '--cap-drop', 'ALL',
              '--security-opt', 'no-new-privileges:true', '--entrypoint']
    packages.append(run(prefix + ['apk', ref, '--no-network', 'info', '-v']))
    caps.append(run(prefix + ['getcap', ref, '/usr/bin/caddy']))
assert packages[0] == packages[1]
assert caps == ['/usr/bin/caddy cap_net_bind_service=ep', '']
version = run(['docker', 'run', '--rm', '--pull', 'never', '--network', 'none',
               '--user', '12346', '--read-only', '--cap-drop', 'ALL',
               '--security-opt', 'no-new-privileges:true', image['Id'], 'caddy', 'version'])
assert version.startswith('v2.11.7 ')
assert json.loads(run(['docker', 'image', 'inspect', base]))[0] == original
print(json.dumps({'base_reference': base, 'base_id': original['Id'], 'image_id': image['Id'],
                  'base_layers_unchanged': True, 'runtime_config_identical': True,
                  'packages_identical': True, 'changed_layer_paths': sorted(delta),
                  'caddy_sha256': delta['usr/bin/caddy']['content_sha256'],
                  'only_effective_delta': 'remove /usr/bin/caddy security.capability',
                  'mtime_representation_delta': representation, 'capability_probes': caps,
                  'version_under_nonroot_ALL_drop_NNP_readonly': version}, indent=2))
