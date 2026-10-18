"""Disposable hosted synthetic recovery drill; never a production launcher."""
import os
import platform
import sys

import json
from pathlib import Path
import re
import secrets
import shutil
import signal
import subprocess
import time

IMAGE = 'postgres@sha256:00bc86618629af00d2937fdc5a5d63db3ff8450acf52f0636ec813c7f4902929'
LABELS = {'cupmemo.task': 't_b2e9cc04', 'cupmemo.scope': 'synthetic-restore-drill'}


def caps_valid(host, memory, swap):
    return (host.get('Memory') == host.get('MemorySwap') == 536870912
            and host.get('NanoCpus') == 1000000000
            and host.get('PidsLimit') == 128
            and host.get('RestartPolicy', {}).get('Name') == 'no'
            and memory.strip() == '536870912' and swap.strip() == '0')


def command(argv, *, data=None, timeout=120):
    # No command line, child stderr, rows or environment is ever echoed.
    result = subprocess.run(argv, input=data, text=True, stdout=subprocess.PIPE,
                            stderr=subprocess.PIPE, timeout=timeout, check=False)
    if result.returncode:
        raise RuntimeError('child failed')
    return result.stdout.strip()


def record(root, name, value):
    with (root / name).open('x', encoding='utf-8') as file:
        json.dump(value, file, indent=2)
        file.write('\n')


def cleanup(root):
    plan = json.loads((root / 'resources.json').read_text())
    assert plan['run'] == os.environ['GITHUB_RUN_ID']
    assert plan['attempt'] == os.environ['GITHUB_RUN_ATTEMPT']
    labels = {**LABELS, 'cupmemo.run': plan['run'] + '-' + plan['attempt']}
    # Never discover a set to delete. Use only exact ids recorded after create.
    if plan.get('container'):
        obj = json.loads(command(['docker', 'container', 'inspect', plan['container']]))[0]
        assert all(obj['Config']['Labels'].get(k) == v for k, v in labels.items())
        command(['docker', 'container', 'rm', '--force', obj['Id']])
    if plan.get('volume'):
        obj = json.loads(command(['docker', 'volume', 'inspect', plan['volume']]))[0]
        assert all(obj['Labels'].get(k) == v for k, v in labels.items())
        command(['docker', 'volume', 'rm', obj['Name']])
    record(root, 'cleanup.json', {'status': 'exact_hosted_resources_removed'})


def drill():
    os.umask(0o077)
    run, attempt = os.environ['GITHUB_RUN_ID'], os.environ['GITHUB_RUN_ATTEMPT']
    assert re.fullmatch(r'[0-9]+', run) and re.fullmatch(r'[0-9]+', attempt)
    root = Path(os.environ['RUNNER_TEMP']) / ('cupmemo-recovery-' + run + '-' + attempt)
    if sys.argv[1:] == ['--cleanup']:
        if (root / 'resources.json').exists() and not (root / 'cleanup.json').exists():
            cleanup(root)
        return
    assert not sys.argv[1:]
    root.mkdir(mode=0o700)  # Refuse a rerun over unknown partial state.
    private = root / 'private'
    private.mkdir(mode=0o700)
    started, phase, status = time.monotonic(), 'identity', 'failed'
    plan = {'run': run, 'attempt': attempt, 'container': None, 'volume': None}
    plan_file = root / 'resources.json'

    def save_plan():
        plan_file.write_text(json.dumps(plan))

    def execute(*args, data=None, user=None, timeout=120):
        return command(['docker', 'exec', '--interactive', '--user', user or '0',
                        plan['container'], *args], data=data, timeout=timeout)

    def node(stage):
        try:
            execute('/usr/local/bin/node', '/candidate/infrastructure/scripts/recovery-drill.mjs',
                    stage, user=str(os.getuid()) + ':' + str(os.getgid()), timeout=600)
        finally:
            result_file = private / ('result-' + stage + '.json')
            if result_file.exists():
                result = json.loads(result_file.read_text())
                record(root, stage + '.json', result)  # Fixed-schema status-only reports.

    def caps(filename):
        obj = json.loads(command(['docker', 'container', 'inspect', plan['container']]))[0]
        memory = execute('/bin/cat', '/sys/fs/cgroup/memory.max')
        swap = execute('/bin/cat', '/sys/fs/cgroup/memory.swap.max')
        sample = {'host': {k: obj['HostConfig'][k] for k in
                          ['Memory', 'MemorySwap', 'NanoCpus', 'PidsLimit', 'RestartPolicy']},
                  'memoryMax': memory, 'swapMax': swap, 'running': obj['State']['Running']}
        record(root, filename, sample)
        assert caps_valid(sample['host'], memory, swap)
        assert sample['running'] and not obj['HostConfig']['PortBindings']
        assert all(obj['Config']['Labels'].get(k) == v for k, v in LABELS.items())

    save_plan()
    try:
        source = Path.cwd().resolve()
        sha = command(['git', 'rev-parse', 'HEAD'])
        assert sha == os.environ['DRILL_CANDIDATE']
        assert not command(['git', 'status', '--porcelain'])
        record(root, 'identity.json', {'head': sha, 'tree': command(['git', 'rev-parse', 'HEAD^{tree}']),
                                     'workflowSha': os.environ['GITHUB_SHA'], 'run': run,
                                     'attempt': attempt, 'originalImplementationRun': 3335})
        info = json.loads(command(['docker', 'info', '--format', '{{json .}}']))
        assert info['MemoryLimit'] and info['SwapLimit']
        assert shutil.disk_usage(root).free >= 5 * 1024**3
        phase = 'image'
        command(['docker', 'pull', '--platform=linux/arm64', IMAGE], timeout=300)
        image = json.loads(command(['docker', 'image', 'inspect', IMAGE]))[0]
        assert image['Architecture'] == 'arm64' and image['Os'] == 'linux'
        assert any(s.startswith('PG_VERSION=17.6') for s in image['Config']['Env'])
        record(root, 'image.json', {'reference': IMAGE, 'id': image['Id'],
                                  'repoDigests': image['RepoDigests'], 'architecture': 'arm64'})
        phase = 'resources'
        prefix = 'cupmemo-t-b2e9cc04-' + run + '-' + attempt
        labels = {**LABELS, 'cupmemo.run': run + '-' + attempt}
        label_args = [v for k, value in labels.items() for v in ['--label', k + '=' + value]]
        volume, name = prefix + '-pgdata', prefix + '-db'
        # Nonexistence, not ownership alone: never replace prior resources.
        for kind, value in [('volume', volume), ('container', name)]:
            result = subprocess.run(['docker', kind, 'inspect', value], capture_output=True)
            assert result.returncode == 1
        plan['volume'] = command(['docker', 'volume', 'create', *label_args, volume])
        save_plan()
        node_path = shutil.which('node')
        assert node_path
        node_binary = Path(node_path).resolve()
        assert command([str(node_binary), '--version']) == 'v24.15.0'
        plan['container'] = command(['docker', 'create', '--name', name, *label_args,
                                     '--memory=512m', '--memory-swap=512m', '--cpus=1',
                                     '--pids-limit=128', '--restart=no',
                                     '--mount', 'type=volume,src=' + volume + ',dst=/var/lib/postgresql/data',
                                     '--mount', 'type=bind,src=' + str(source) + ',dst=/candidate,readonly',
                                     '--mount', 'type=bind,src=' + str(private) + ',dst=/drill',
                                     '--mount', 'type=bind,src=' + str(node_binary) + ',dst=/usr/local/bin/node,readonly',
                                     '--entrypoint=/bin/sleep', IMAGE, 'infinity'])
        save_plan()
        command(['docker', 'start', plan['container']])
        phase = 'caps'
        caps('caps-before.json')
        phase = 'tools'
        # Ephemeral container only. Git is needed by the unchanged trusted release
        # validators; no fake wrappers, host packages or path exemptions.
        execute('apt-get', 'update', timeout=180)
        execute('apt-get', 'install', '--no-install-recommends', '--yes', 'git', timeout=180)
        assert execute('/usr/lib/postgresql/17/bin/pg_dump', '--version').startswith('pg_dump (PostgreSQL) 17.6')
        assert execute('/usr/lib/postgresql/17/bin/pg_restore', '--version').startswith('pg_restore (PostgreSQL) 17.6')
        phase = 'bootstrap'
        execute('chown', 'postgres:postgres', '/var/lib/postgresql/data')
        execute('/usr/lib/postgresql/17/bin/initdb', '-D', '/var/lib/postgresql/data/pgdata',
                '--auth-local=trust', '--auth-host=scram-sha-256', '--pwfile=/dev/stdin',
                data=secrets.token_hex(32) + '\n', user='postgres')

        def start_db():
            execute('/usr/lib/postgresql/17/bin/pg_ctl', '-D', '/var/lib/postgresql/data/pgdata',
                    '-l', '/var/lib/postgresql/data/pgdata/drill.log', '-o', '-h 127.0.0.1',
                    '-w', 'start', user='postgres')

        start_db()
        passwords = {k: secrets.token_hex(32) for k in ['source', 'restore']}
        fixture = {'passwords': passwords, 'accountPassword': secrets.token_hex(24),
                   'authSecret': secrets.token_hex(32)}
        (private / 'fixture.json').write_text(json.dumps(fixture))
        sql = ''
        for kind in ['source', 'restore']:
            role = 'drill_' + kind
            db = 'cupmemo_test_t_b2e9cc04_' + kind
            sql += (f"CREATE ROLE {role} LOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS PASSWORD '{passwords[kind]}';\n"
                    f'CREATE DATABASE {db} OWNER {role} TEMPLATE template0;\n')
        execute('/usr/lib/postgresql/17/bin/psql', '-X', '--no-password', '--set=ON_ERROR_STOP=1',
                '--dbname=postgres', data=sql, user='postgres')
        for stage in ['prepare', 'restore', 'application']:
            phase = stage
            node(stage)
        phase = 'restart'
        # Exactly one normal PostgreSQL stop/start within this sole owned container.
        execute('/usr/lib/postgresql/17/bin/pg_ctl', '-D', '/var/lib/postgresql/data/pgdata',
                '-m', 'fast', '-w', 'stop', user='postgres')
        command(['docker', 'container', 'restart', '--time=15', plan['container']])
        caps('caps-after.json')
        start_db()
        phase = 'persistence'
        node('persistence')
        status = 'synthetic_recovery_checks_passed'
    except Exception:
        # Intentional fixed phase only: exceptions/child output may contain rows.
        sys.stderr.write('recovery drill failed phase=' + phase + '\n')
        raise RuntimeError('sanitized drill failure') from None
    finally:
        record(root, 'summary.json', {'status': status, 'phase': phase,
                                     'durationSeconds': round(time.monotonic() - started, 3),
                                     'syntheticOnly': True, 'productionAcceptance': False})
        cleanup(root)


def hosted():
    return (os.environ.get('GITHUB_ACTIONS') == 'true'
            and os.environ.get('RUNNER_ENVIRONMENT') == 'github-hosted'
            and os.environ.get('RUNNER_OS') == 'Linux'
            and os.environ.get('RUNNER_ARCH') == 'ARM64'
            and platform.machine() == 'aarch64')


if __name__ == '__main__':
    if not hosted():
        sys.stderr.write('recovery drill refused: hosted ARM64 only\n')
        sys.exit(1)
    def interrupted(_signum, _frame):
        raise RuntimeError('interrupted')
    signal.signal(signal.SIGTERM, interrupted)
    signal.signal(signal.SIGINT, interrupted)
    try:
        drill()
    except Exception:
        sys.exit(1)
