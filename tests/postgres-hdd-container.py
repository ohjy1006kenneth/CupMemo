"""Actual production-gate container behavior. Never selects a live data path.

Default: disposable ARM64 Actions runner ONLY, with one owned loopback ext4 mount.
--negative-only: task-owned SSD fixture, no mounts/DB startup; optional host-compiled
--gate is bound read-only over the gate executable in an existing PG image.
No injection interface exists in the production binary.
"""
import argparse
import fcntl

import json
import os
from pathlib import Path
import platform
import shutil
import struct
import subprocess
import tempfile
import time
import uuid

parser = argparse.ArgumentParser()
parser.add_argument('--image', required=True)
parser.add_argument('--negative-only', action='store_true')
parser.add_argument('--gate', type=Path)
args = parser.parse_args()
if args.gate:
    assert args.negative_only and args.gate.is_absolute() and args.gate.is_file()
if not args.negative_only:
    assert os.environ.get('GITHUB_ACTIONS') == 'true'
    assert platform.machine() == 'aarch64'
    assert Path(os.environ['RUNNER_TEMP']).is_dir()

owned = []
checks = []
resource_limits = []
base = Path(tempfile.mkdtemp(prefix='cupmemo-hdd-', dir=(
    os.environ['RUNNER_TEMP'] if not args.negative_only else Path.cwd())))
volume = base / 'volume'
volume.mkdir()
source = volume / 'owned fixture' / 'data'
mounted = False
uid = os.getuid()
assert uid > 0
prefix = base.name


def run(command, expected=0, timeout=45):
    result = subprocess.run(command, capture_output=True, text=True, timeout=timeout)
    assert result.returncode == expected, (command[:3], result.returncode, result.stdout, result.stderr)
    return result.stdout.strip()


def root_uuid(directory):
    fd = os.open(directory, os.O_RDONLY | os.O_DIRECTORY)
    try:
        payload = bytearray(struct.pack('II16s', 16, 0, b'\0' * 16))
        fcntl.ioctl(fd, 0x8008662c, payload, True)
        length, flags, value = struct.unpack('II16s', payload)
        assert length == 16 and flags == 0
        return str(uuid.UUID(bytes=value))
    finally:
        os.close(fd)


def state():
    # Bounded fixture only; do not traverse PGDATA after positive database init.
    result = []
    for root in (volume, base / 'ssd-data'):
        if not root.exists():
            continue
        for p in [root, *root.rglob('*')]:
            st = p.lstat()
            content = os.readlink(p) if p.is_symlink() else (
                p.read_bytes().hex() if p.is_file() else None)
            result.append((p.relative_to(base).as_posix(), st.st_mode, st.st_uid,
                           st.st_gid, st.st_ino, st.st_mtime_ns, st.st_ctime_ns, content))
    return sorted(result)


def create(label, source, changes=None, command=None, user=None, extra=None, marker=False, tmpfs=False):
    name = prefix + '-' + label
    owned.append(name)  # Reconcile even a partially successful create.
    environment = {
        'POSTGRES_DATA_UID': str(uid), 'PGDATA': '/var/lib/postgresql/data/pgdata',
        'POSTGRES_HDD_UUID': actual_uuid, 'POSTGRES_HDD_MOUNT': str(volume),
        'POSTGRES_DATA_DIR': str(source), 'POSTGRES_DB': 'cupmemo_fixture',
        'POSTGRES_USER': 'fixture', 'POSTGRES_PASSWORD': 'SYNTHETIC-fixture-only-3413',
    }
    environment.update(changes or {})
    options = ['docker', 'create', '--name', name, '--label', 'cupmemo.hdd.fixture=' + prefix,
               '--user', str(uid if user is None else user), '--network', 'none',
               '--cap-drop', 'ALL', '--security-opt', 'no-new-privileges:true',
               '--memory', '512m', '--memory-swap', '512m', '--cpus', '1',
               '--pids-limit', '128', '--restart', 'no']
    if tmpfs:
        options += ['--tmpfs', f'/var/lib/postgresql/data:rw,nosuid,nodev,uid={uid},gid={uid},mode=0700,size=1m']
    else:
        options += ['--mount', f'type=bind,source={source},target=/var/lib/postgresql/data']
    for key, value in environment.items():
        if value is not None:
            options += ['--env', key + '=' + value]
    if args.gate:
        options += ['--entrypoint', '/usr/local/bin/cupmemo-postgres-hdd', '--mount',
                    f'type=bind,source={args.gate},target=/usr/local/bin/cupmemo-postgres-hdd,readonly']
    if marker:
        options += ['--mount', f'type=bind,source={base / "marker.sh"},target=/usr/local/bin/docker-entrypoint.sh,readonly']
    options += extra or []
    run(options + [args.image] + (command or ['postgres']))
    config = json.loads(run(['docker', 'inspect', name]))[0]
    host = config['HostConfig']
    assert not host['Privileged'] and host['CapDrop'] == ['ALL']
    assert not host['PortBindings'] and host['NetworkMode'] == 'none'
    resource_limits.append({'memory': host['Memory'], 'swap': host['MemorySwap'],
                            'pids': host['PidsLimit'], 'nano_cpus': host['NanoCpus']})
    if not args.negative_only:
        assert host['MemorySwap'] == host['Memory'] == 512 * 1024**2
        assert host['PidsLimit'] == 128 and host['NanoCpus'] == 1000000000
    assert host['RestartPolicy']['Name'] == 'no'
    assert all(m['Type'] == 'bind' or (tmpfs and m['Type'] == 'tmpfs' and
               m['Destination'] == '/var/lib/postgresql/data') for m in config['Mounts']), 'anonymous persistence'
    return name


def refusal(label, source, **kwargs):
    before = state()
    name = create(label, source, marker=True, **kwargs)
    run(['docker', 'start', name])
    assert run(['docker', 'wait', name]) == '1'
    assert run(['docker', 'logs', name]) == ''  # fixed diagnostic is on stderr
    logs = subprocess.run(['docker', 'logs', name], capture_output=True, text=True, check=True)
    assert logs.stderr == 'CupMemo PostgreSQL: storage admission refused\n'
    assert state() == before, 'refused gate mutated fixture/reached marker'
    checks.append(label)


try:
    if not args.negative_only:
        image = base / 'owned.ext4'
        run(['truncate', '-s', '384M', str(image)])
        run(['mkfs.ext4', '-q', '-F', str(image)])
        run(['sudo', 'mount', '-o', 'loop,nosuid,nodev', str(image), str(volume)])
        mounted = True
    if args.negative_only:
        source.mkdir(parents=True, mode=0o700)
    else:
        run(['sudo', 'mkdir', '-p', str(source)])
        run(['sudo', 'chown', str(uid), str(source)])
        run(['sudo', 'chmod', '0700', str(source)])
    actual_uuid = root_uuid(source)
    marker = base / 'marker.sh'
    marker.write_text('#!/bin/sh\n[ "$#" = 1 ] && [ "$1" = postgres ] || exit 42\nprintf reached > /var/lib/postgresql/data/EXEC_REACHED\nexit 0\n')
    marker.chmod(0o555)
    if not args.negative_only:
        # Establish actual final-image nonroot admission before negatives, so an
        # unsafe image ancestor cannot mask UUID/mount refusal coverage.
        name = create('baseline-check', source, command=['--check'])
        run(['docker', 'start', name])
        assert run(['docker', 'wait', name]) == '0'
        checks.append('final-image-nonroot-baseline')
    refusal('wrong-uuid', source, changes={'POSTGRES_HDD_UUID': str(uuid.uuid4())})
    refusal('missing-uuid', source, changes={'POSTGRES_HDD_UUID': None})
    refusal('malformed-uuid', source, changes={'POSTGRES_HDD_UUID': 'SECRET-invalid'})
    refusal('uppercase-uuid', source, changes={'POSTGRES_HDD_UUID': 'AAAAAAAA-2222-3333-4444-555555555555'})
    refusal('root', source, user=0)
    refusal('wrong-uid', source, changes={'POSTGRES_DATA_UID': str(uid + 1)})
    refusal('bad-uid', source, changes={'POSTGRES_DATA_UID': '0'})
    refusal('bad-path', source, changes={'POSTGRES_DATA_DIR': '/bad/../SECRET'})
    refusal('not-descendant', source, changes={'POSTGRES_HDD_MOUNT': str(source)})
    refusal('wrong-pgdata', source, changes={'PGDATA': '/tmp/SECRET'})
    refusal('arbitrary-command', source, command=['sh', '-c', 'echo SECRET'])
    refusal('postgres-option', source, command=['postgres', '-c', 'data_directory=/tmp'])
    refusal('wrong-root', source, changes={'POSTGRES_DATA_DIR': str(volume / 'other')})
    # Actual SSD UUID match must still fail on filesystem-root mismatch.
    if args.negative_only:
        refusal('ssd-root-mismatch', source)
    else:
        # Explicitly denied ioctl with the unmodified production binary.
        refusal('wrong-filesystem-tmpfs', source, tmpfs=True)
        ssd = base / 'ssd-data'
        ssd.mkdir(mode=0o700)
        ssd_uuid = root_uuid(ssd)
        assert ssd_uuid != actual_uuid
        refusal('ssd-wrong-uuid', ssd, changes={'POSTGRES_DATA_DIR': str(source)})
        unsafe_parent = base / 'unsafe-parent'
        unsafe_parent.mkdir(mode=0o755)
        (unsafe_parent / 'data').mkdir()
        run(['sudo', 'chown', '0:0', str(unsafe_parent)])
        run(['sudo', 'chmod', '1777', str(unsafe_parent)])
        refusal('unsafe-image-parent-1777', source, extra=['--mount',
                f'type=bind,source={unsafe_parent},target=/var/lib/postgresql'])
        seccomp = base / 'deny-ioctl.json'
        seccomp.write_text(json.dumps({'defaultAction': 'SCMP_ACT_ALLOW', 'syscalls': [
            {'names': ['ioctl'], 'action': 'SCMP_ACT_ERRNO', 'errnoRet': 1}]}))
        refusal('ioctl-denied', source, extra=['--security-opt', 'seccomp=' + str(seccomp)])
        for mode in ('0777', '02700'):
            run(['sudo', 'chmod', mode, str(source)])
            refusal('mode-' + mode, source)
        # GNU chmod preserves directory setgid with four-digit modes. Explicitly
        # clear special bits before later positive admission (never relax gate).
        run(['sudo', 'chmod', '00700', str(source)])
        assert source.stat().st_mode & 0o7777 == 0o700
        run(['sudo', 'ln', '-s', '/tmp', str(source / 'pgdata')])
        # Existing unsafe child is rejected before any official mutation.
        refusal('symlink-child', source)
        run(['sudo', 'rm', str(source / 'pgdata')])
        run(['sudo', 'chown', str(uid + 1), str(source)])
        refusal('wrong-data-owner', source)
        run(['sudo', 'chown', str(uid), str(source)])
        run(['sudo', 'mkdir', str(source / 'pgdata')])
        run(['sudo', 'chmod', '0777', str(source / 'pgdata')])
        refusal('unsafe-child', source)
        run(['sudo', 'rmdir', str(source / 'pgdata')])
        # The exact missing bind fails in Docker before any gate/official process.
        missing = volume / 'absent'
        result = subprocess.run(['docker', 'run', '--rm', '--network', 'none', '--mount',
                                 f'type=bind,source={missing},target=/var/lib/postgresql/data',
                                 args.image, '--check'], capture_output=True, text=True)
        assert result.returncode != 0 and not missing.exists()
        checks.append('missing-bind-no-create')
        before = state()
        for sequence in (1, 2):
            name = create('check-' + str(sequence), source, command=['--check'])
            run(['docker', 'start', name])
            assert run(['docker', 'wait', name]) == '0'
            assert state() == before
        refusal('fresh-check-after-success', source, changes={'POSTGRES_HDD_UUID': str(uuid.uuid4())})
        # A marker at the FIXED official path proves only admitted execution reaches it.
        name = create('fixed-exec', source, marker=True)
        run(['docker', 'start', name])
        assert run(['docker', 'wait', name]) == '0'
        assert run(['sudo', 'cat', str(source / 'EXEC_REACHED')]) == 'reached'
        run(['sudo', 'rm', str(source / 'EXEC_REACHED')])
        name = create('database', source)
        run(['docker', 'start', name])
        deadline = time.monotonic() + 60
        while True:
            ready = subprocess.run(['docker', 'exec', name, 'pg_isready', '-U', 'fixture', '-d', 'cupmemo_fixture'], capture_output=True)
            if ready.returncode == 0 and run(['docker', 'exec', name, 'cat', '/proc/1/comm']) == 'postgres':
                break
            assert time.monotonic() < deadline, 'bounded readiness deadline'
            assert json.loads(run(['docker', 'inspect', name]))[0]['State']['Running']
            time.sleep(0.5)
        def query(sql):
            return run(['docker', 'exec', name, 'psql', '-XAt', '-U', 'fixture', '-d', 'cupmemo_fixture', '-c', sql])
        assert query('SHOW server_version').startswith('17.11')
        query('CREATE TABLE fixture (value text); INSERT INTO fixture VALUES (\'durable\')')
        assert query('SELECT value FROM fixture') == 'durable'
        # Official script must exec postgres as foreground PID1.
        assert run(['docker', 'exec', name, 'cat', '/proc/1/comm']) == 'postgres'
        run(['docker', 'kill', '--signal', 'TERM', name])
        assert run(['docker', 'wait', name]) == '0'
        # Same retained container start invokes production gate again.
        run(['docker', 'start', name])
        deadline = time.monotonic() + 30
        while subprocess.run(['docker', 'exec', name, 'pg_isready', '-U', 'fixture', '-d', 'cupmemo_fixture'], capture_output=True).returncode:
            assert time.monotonic() < deadline
            time.sleep(0.5)
        assert query('SELECT value FROM fixture') == 'durable'
        run(['docker', 'stop', '--time', '15', name])
        assert run(['docker', 'wait', name]) == '0'
        checks += ['positive-check-twice', 'fixed-exec', 'official-init-query', 'pid1-term', 'stop-start-persistence']
    print(json.dumps({'checks': checks, 'image': args.image, 'fixture_only': True,
                      'production_binary': True, 'resource_limits': resource_limits,
                      'resource_enforcement_verified': all(r['memory'] == r['swap'] == 512 * 1024**2 and r['pids'] == 128 and r['nano_cpus'] == 1000000000 for r in resource_limits),
                      'live_HDD_or_CasaOS_acceptance': False}))
except BaseException:
    print(json.dumps({'completed_checks_before_failure': checks,
                      'source_mode': oct(source.lstat().st_mode & 0o7777) if source.exists() else None}), flush=True)
    raise
finally:
    # Exact owned resources only. Never prune, detach a live disk or delete live data.
    for name in reversed(owned):
        subprocess.run(['docker', 'rm', '-f', '-v', name], capture_output=True, timeout=30)
        assert subprocess.run(['docker', 'inspect', name], capture_output=True, timeout=10).returncode != 0, 'owned container cleanup failed'
    if mounted:
        run(['sudo', 'umount', str(volume)])
    if args.negative_only:
        shutil.rmtree(base)
    else:
        run(['sudo', 'rm', '-rf', '--', str(base)])
