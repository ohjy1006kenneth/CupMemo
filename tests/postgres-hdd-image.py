"""Verify exact official ARM64 base prefix, runtime payload and package equality."""
import gzip
import hashlib
import io
import json
from pathlib import Path
import re
import subprocess
import sys
import tarfile


def run(argv):
    return subprocess.check_output(argv, text=True, timeout=180).strip()


base = re.findall(r'^FROM (\S+) AS runtime$', Path('infrastructure/docker/postgres-hdd.Dockerfile').read_text(), re.M)[0]
image = json.loads(run(['docker', 'image', 'inspect', sys.argv[1]]))[0]
original = json.loads(run(['docker', 'image', 'inspect', base]))[0]
assert image['Architecture'] == original['Architecture'] == 'arm64'
assert image['Os'] == original['Os'] == 'linux'
base_layers = original['RootFS']['Layers']
assert image['RootFS']['Layers'][:len(base_layers)] == base_layers
added_layers = image['RootFS']['Layers'][len(base_layers):]
assert len(added_layers) == 2
assert image['Config']['Entrypoint'] == ['/usr/local/bin/cupmemo-postgres-hdd']
assert image['Config']['Cmd'] == ['postgres']
assert image['Config']['Volumes'] == original['Config']['Volumes'] == {'/var/lib/postgresql/data': {}}
assert image['Config']['Env'] == original['Config']['Env']
config_delta = {k: [original['Config'].get(k), image['Config'].get(k)]
                for k in set(original['Config']) | set(image['Config'])
                if original['Config'].get(k) != image['Config'].get(k)}
# BuildKit emits ArgsEscaped=true for CMD, unlike the pinned upstream config.
# Docker uses this legacy field only on Windows, never this asserted Linux image;
# require the exact observed serialization delta, not arbitrary config changes.
assert config_delta.get('ArgsEscaped') == [None, True], config_delta
assert set(config_delta) == {'Entrypoint', 'ArgsEscaped'}, config_delta
packages = []
for ref in (base, image['Id']):
    # No entrypoint/DB/data mount; packages only, bounded and network-isolated.
    packages.append(run(['docker', 'run', '--rm', '--network', 'none', '--cap-drop', 'ALL',
                         '--security-opt', 'no-new-privileges:true', '--entrypoint', 'dpkg-query',
                         ref, '-W', '-f=${Package}\t${Version}\n']))
assert packages[0] == packages[1], 'build dependencies leaked into runtime'
payloads = {}
process = subprocess.Popen(['docker', 'image', 'save', image['Id']], stdout=subprocess.PIPE)
with tarfile.open(fileobj=process.stdout, mode='r|') as archive:
    for member in archive:
        if not member.isfile() or member.size > 1024 * 1024:
            continue
        stream = archive.extractfile(member)
        assert stream is not None
        raw = stream.read()
        if raw[:2] == b'\x1f\x8b':
            raw = gzip.decompress(raw)
        digest = 'sha256:' + hashlib.sha256(raw).hexdigest()
        if digest in added_layers:
            payloads[digest] = raw
assert process.wait(timeout=30) == 0 and set(payloads) == set(added_layers)
parent = 'var/lib/postgresql'
gate = 'usr/local/bin/cupmemo-postgres-hdd'
directories = ['var', 'var/lib', parent, 'usr', 'usr/local', 'usr/local/bin']
def metadata(ref):
    return run(['docker', 'run', '--rm', '--network', 'none', '--cap-drop', 'ALL',
                '--security-opt', 'no-new-privileges:true', '--entrypoint', 'stat',
                ref, '-c', '%n %u %g %a', *['/' + p for p in directories]])
def parse_metadata(text):
    return {parts[0].lstrip('/'): (int(parts[1]), int(parts[2]), int(parts[3], 8))
            for parts in (line.split() for line in text.splitlines())}
baseline_metadata = parse_metadata(metadata(base))
final_metadata = parse_metadata(metadata(image['Id']))
assert baseline_metadata[parent] == (999, 999, 0o1777)
assert final_metadata[parent] == (0, 0, 0o755)
assert all(final_metadata[p] == baseline_metadata[p] for p in directories if p != parent)
seen_gate = 0
seen_parent = 0
executable = b''
for digest in added_layers:
    with tarfile.open(fileobj=io.BytesIO(payloads[digest])) as layer:
        for item in layer:
            name = item.name.rstrip('/')
            if name == gate:
                seen_gate += 1
                assert item.isfile() and (item.uid, item.gid, item.mode) == (0, 0, 0o555)
                stream = layer.extractfile(item)
                assert stream is not None
                executable = stream.read()
            else:
                assert item.isdir() and name in directories, 'unexpected runtime payload'
                if name == parent:
                    seen_parent += 1
                    assert (item.uid, item.gid, item.mode) == (0, 0, 0o755)
                else:
                    assert (item.uid, item.gid, item.mode) == baseline_metadata[name]
assert seen_gate == seen_parent == 1 and executable.startswith(b'\x7fELF')
# Re-inspect the immutable original after all probes; no base mutation is permitted.
assert json.loads(run(['docker', 'image', 'inspect', base]))[0] == original
print(json.dumps({'base_reference': base, 'base_id': original['Id'], 'image_id': image['Id'],
                  'architecture': image['Architecture'], 'base_layers_unchanged': True,
                  'only_added_file': gate, 'gate_sha256': hashlib.sha256(executable).hexdigest(),
                  'image_parent_before': baseline_metadata[parent],
                  'image_parent_after': final_metadata[parent],
                  'linux_ignored_argsescaped_delta': config_delta['ArgsEscaped'],
                  'runtime_packages_unchanged': True, 'image_bytes': image['Size']}))
