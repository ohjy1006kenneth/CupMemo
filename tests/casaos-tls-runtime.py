"""Real isolated ARM64 TLS fixture; no app, real cert, HDD or CasaOS installation.

python3 tests/casaos-tls-runtime.py /absolute/task/evidence-directory
Requires an explicit audited derivative image already present (never pulls).
"""
import hashlib
import json
import os
import platform
import shutil
import subprocess
import sys
import tempfile
import time
from pathlib import Path

IMAGE = sys.argv[2]
ROOT = Path(__file__).resolve().parents[1]
E = Path(sys.argv[1]).resolve()
E.mkdir(mode=0o700, parents=True, exist_ok=False)
PREFIX = 'cupmemo-tls-fixture-' + str(os.getpid())
HOST = 'fixture.tailnet.ts.net'
UID = '12346'
owned = []
checks = []
sequence = 0
networks = []


def run(args, expected: int | None = 0, timeout=20):
    global sequence
    sequence += 1
    result = subprocess.run(args, capture_output=True, text=True, timeout=timeout)
    (E / f'{sequence:03d}.json').write_text(json.dumps({
        'argv': args, 'exit': result.returncode,
        'stdout': result.stdout, 'stderr': result.stderr}, indent=2) + '\n')
    if expected is not None:
        assert result.returncode == expected, f'command {sequence}: {result.stderr}'
    return result


def check(name, condition):
    assert condition, name
    checks.append(name)


def inspect(name):
    return json.loads(run(['docker', 'inspect', name]).stdout)[0]


with tempfile.TemporaryDirectory(prefix=PREFIX) as temporary:
    t = Path(temporary)
    # Docker bind access is checked on the file, not the host-only parent.
    os.chmod(t, 0o755)
    try:
        available = int(next(x.split()[1] for x in Path('/proc/meminfo').read_text().splitlines() if x.startswith('MemAvailable:'))) * 1024
        check('bounded fixture capacity', available >= 512 * 1024**2 and shutil.disk_usage(t).free >= 512 * 1024**2)
        check('native ARM64', platform.machine() == 'aarch64')
        image = json.loads(run(['docker', 'image', 'inspect', IMAGE]).stdout)[0]
        check('audited ARM64 image', image['Os'] == 'linux' and image['Architecture'] == 'arm64')
        IMAGE = image['Id']  # pin all subsequent creates, not a mutable tag
        (E / 'identity.json').write_text(json.dumps({
            'head': run(['git', 'rev-parse', 'HEAD']).stdout.strip(),
            'tree': run(['git', 'rev-parse', 'HEAD^{tree}']).stdout.strip(),
            'source_sha256': hashlib.sha256((ROOT / 'infrastructure/casaos/Caddyfile').read_bytes()).hexdigest(),
            'reference': IMAGE, 'image': image}, indent=2) + '\n')
        # Fresh synthetic CA and a CA-signed leaf; never retained in evidence.
        run(['openssl', 'req', '-x509', '-newkey', 'rsa:2048', '-nodes', '-days', '1', '-subj', '/CN=Synthetic fixture CA', '-keyout', str(t/'ca.key'), '-out', str(t/'ca.crt')])
        run(['openssl', 'req', '-newkey', 'rsa:2048', '-nodes', '-subj', '/CN='+HOST, '-keyout', str(t/'tls.key'), '-out', str(t/'tls.csr')])
        (t/'extensions').write_text('subjectAltName=DNS:'+HOST+'\nbasicConstraints=CA:FALSE\nkeyUsage=digitalSignature,keyEncipherment\nextendedKeyUsage=serverAuth\n')
        run(['openssl', 'x509', '-req', '-in', str(t/'tls.csr'), '-CA', str(t/'ca.crt'), '-CAkey', str(t/'ca.key'), '-CAcreateserial', '-days', '1', '-extfile', str(t/'extensions'), '-out', str(t/'leaf.crt')])
        (t/'tls.crt').write_bytes((t/'leaf.crt').read_bytes()+(t/'ca.crt').read_bytes())
        os.chmod(t/'tls.key', 0o644)  # synthetic only; readonly, disposable container fixture
        shutil.copyfile(ROOT/'infrastructure/casaos/Caddyfile', t/'Caddyfile')
        (t/'backend').write_text('''{
 admin off
 auto_https off
 persist_config off
 log default {
  output discard
 }
}
http://:3101 {
 header Cache-Control "no-store"
 header Set-Cookie "fixture=session; Secure; HttpOnly; SameSite=Lax"
 respond "host={http.request.hostport};uri={http.request.uri};method={http.request.method};body={http.request.body}" 200
}
''')
        run(['docker', 'network', 'create', '--internal', '--label', 'cupmemo.fixture='+PREFIX, PREFIX])
        networks.append(PREFIX)
        ingress = PREFIX+'-private-ingress'
        run(['docker', 'network', 'create', '--driver', 'bridge', '--label', 'cupmemo.fixture='+PREFIX, ingress])
        networks.append(ingress)

        def create(suffix, config='Caddyfile', cert='tls.crt', key='tls.key', publish=False, backend=False, fixed_port=''):
            name = PREFIX+'-'+suffix
            args = ['docker','create','--name',name,'--label','cupmemo.fixture='+PREFIX,
                    '--pull','never','--network',PREFIX,'--user',UID,'--read-only',
                    '--cap-drop','ALL','--security-opt','no-new-privileges:true',
                    '--memory','64m','--memory-swap','64m','--cpus','0.25','--pids-limit','64',
                    '--restart','no','--log-driver','json-file','--log-opt','max-size=10m','--log-opt','max-file=3',
                    '--env','GOMEMLIMIT=48MiB','--env','CUPMEMO_TLS_HOSTNAME='+HOST]
            for target in ['/data','/config','/tmp']:
                args += ['--tmpfs',target+':rw,noexec,nosuid,nodev,size=16m,mode=1777']
            if publish:
                # Explicit test-only ephemeral loopback bind, never production8445.
                args += ['--publish',f'127.0.0.1:{fixed_port}:8445/tcp']
            if backend:
                args += ['--network-alias','cupmemo-web']
            for source,target in [(config,'/etc/caddy/Caddyfile')]+([] if backend else [(cert,'/run/secrets/cupmemo_tls_cert'),(key,'/run/secrets/cupmemo_tls_key')]):
                args += ['--mount',f'type=bind,src={t/source},dst={target},readonly']
            args += [IMAGE,'caddy','run','--config','/etc/caddy/Caddyfile','--adapter','caddyfile']
            result = run(args, expected=None)
            if result.returncode == 0:
                owned.append(name)
                if not backend:
                    run(['docker', 'network', 'connect', ingress, name])
            return name,result

        backend,result = create('backend', config='backend', backend=True)
        check('synthetic backend create', result.returncode == 0)
        run(['docker','start',backend])
        edge,result = create('edge',publish=True)
        check('edge create', result.returncode == 0)
        info=inspect(edge); hc=info['HostConfig']
        check('nonroot readonly no capabilities', info['Config']['User']==UID and hc['ReadonlyRootfs'] and hc['CapDrop']==['ALL'] and not hc.get('CapAdd') and not hc['Privileged'])
        check('no-new-privileges', 'no-new-privileges:true' in hc['SecurityOpt'])
        check('requested CPU PID and restart bounds', hc['NanoCpus']==250000000 and hc['PidsLimit']==64 and hc['RestartPolicy']['Name']=='no')
        check('only three fixed readonly input binds', len(info['Mounts'])==3 and all(m['Type']=='bind' and not m['RW'] for m in info['Mounts']))
        check('no persistent volume', all(m['Type']!='volume' for m in info['Mounts']))
        check('edge dual-homed only frontend and private ingress', set(info['NetworkSettings']['Networks'])=={PREFIX, ingress})
        check('backend only internal frontend', list(inspect(backend)['NetworkSettings']['Networks'])==[PREFIX])
        for name, internal in [(PREFIX, True), (ingress, False)]:
            net=json.loads(run(['docker','network','inspect',name]).stdout)[0]
            check('ordinary app-owned bridge '+name, net['Internal']==internal and net['Driver']=='bridge' and net['Labels']=={'cupmemo.fixture':PREFIX})
        check('scratch bounded noexec nosuid nodev', len(hc['Tmpfs'])==3 and all('size=16m' in x and all(flag in x for flag in ['noexec','nosuid','nodev']) for x in hc['Tmpfs'].values()))
        run(['docker','start',edge])
        info=inspect(edge)
        run(['docker','logs',edge])
        check('edge stays running after start', info['State']['Running'])
        published=info['NetworkSettings']['Ports']['8445/tcp']
        # Parent EXPOSE metadata is preserved; null entries are NOT publications.
        check('sole actual loopback TCP publication', published is not None and len(published)==1 and published[0]['HostIp']=='127.0.0.1' and {key for key,value in info['NetworkSettings']['Ports'].items() if value}=={'8445/tcp'})
        assert published is not None
        port=published[0]
        address='127.0.0.1'
        host_port=port['HostPort']
        check('requested and effective publication agree', hc['PortBindings']=={'8445/tcp':[{'HostIp':address,'HostPort':''}]} and int(host_port)>0)
        check('only edge on private ingress', set(json.loads(run(['docker','network','inspect',ingress]).stdout)[0]['Containers'])=={info['Id']})
        (E/'publication.json').write_text(json.dumps({'requested':hc['PortBindings'],
            'effective':published,'verified_host_socket':True},indent=2)+'\n')
        base=['curl','--silent','--show-error','--noproxy','*','--max-time','3','--connect-to',f'{HOST}:8445:{address}:{host_port}']
        url='https://'+HOST+':8445/probe?synthetic=1'
        # Bounded readiness only; final assertions never retried.
        for attempt in range(20):
            ready=run(base+['--cacert',str(t/'ca.crt'),url],expected=None)
            if ready.returncode==0:
                break
            check('edge still running during readiness',inspect(edge)['State']['Running'])
            time.sleep(0.25)
        else:
            raise AssertionError('TLS readiness deadline')
        response=run(base+['--cacert',str(t/'ca.crt'),'-i','-X','POST','--data-binary','synthetic-body',url]).stdout
        check('verified HTTPS host path method and body', f'host={HOST}:8445;uri=/probe?synthetic=1;method=POST;body=synthetic-body' in response)
        check('Secure cookie preserved', 'fixture=session; Secure; HttpOnly; SameSite=Lax' in response)
        check('no-store preserved', 'cache-control: no-store' in response.lower())
        collision,result=create('port-conflict',publish=True,fixed_port=host_port)
        check('fixed-port conflict fixture create',result.returncode==0)
        check('fixed-port conflict refuses without relocation',run(['docker','start',collision],expected=None).returncode!=0 and not inspect(collision)['State']['Running'])
        check('existing edge unaffected by conflict',inspect(edge)['NetworkSettings']['Ports']['8445/tcp']==published and run(base+['--cacert',str(t/'ca.crt'),url]).returncode==0)
        check('untrusted chain rejected',run(base+[url],expected=None).returncode==60)
        wrong=run(['curl','--silent','--show-error','--noproxy','*','--max-time','3','--cacert',str(t/'ca.crt'),'--connect-to',f'wrong.ts.net:8445:{address}:{host_port}','https://wrong.ts.net:8445/'],expected=None)
        check('wrong hostname rejected',wrong.returncode in (35,60))
        plain=run(['curl','--include','--silent','--show-error','--noproxy','*','--max-time','3',f'http://{address}:{host_port}/'],expected=None)
        check('plain HTTP refuses app content and redirect', 'host=' not in plain.stdout and 'Location:' not in plain.stdout and ('400' in plain.stdout or plain.returncode!=0))
        # Exercise exact production healthcheck with no TLS relaxation.
        health='curl --fail --silent --output /dev/null --max-time 3 --noproxy "*" --cacert /run/secrets/cupmemo_tls_cert --resolve "$CUPMEMO_TLS_HOSTNAME:8445:127.0.0.1" "https://$CUPMEMO_TLS_HOSTNAME:8445/sign-in"'
        run(['docker','exec',edge,'sh','-c',health])
        check('verified local production healthcheck',True)
        adapted=json.loads(run(['docker','exec',edge,'caddy','adapt','--config','/etc/caddy/Caddyfile','--adapter','caddyfile']).stdout)
        server=next(iter(adapted['apps']['http']['servers'].values()))
        check('only TLS8445 h1 h2 listener',server['listen']==[':8445'] and server['protocols']==['h1','h2'] and server['automatic_https']['disable'])
        check('admin disabled no persisted config',adapted['admin']['disabled'] and adapted['admin']['config']['persist'] is False)
        check('only OCSP-disable policy, no issuance or on-demand automation',adapted['apps']['tls']['automation']['policies']==[{'disable_ocsp_stapling':True}] and adapted['apps']['tls']['disable_ocsp_stapling'])
        check('no request logging',not server.get('logs') and adapted['logging']['logs']['default']['writer']['output']=='discard')
        check('runtime no certificate or request leaks', '/probe' not in run(['docker','logs',edge]).stdout)
        for target in ['/etc/caddy/Caddyfile','/run/secrets/cupmemo_tls_cert','/run/secrets/cupmemo_tls_key']:
            check('readonly '+target,run(['docker','exec',edge,'sh','-c','test ! -w "$1"','fixture',target],expected=None).returncode==0)
        # Missing binds must refuse before start and never create host paths.
        for field in ['config','cert','key']:
            name,result=create('missing-'+field,**{field:'absent-'+field})
            check('missing '+field+' refuses no auto-create',result.returncode!=0 and not (t/('absent-'+field)).exists())
        (t/'invalid').write_text('not a valid config or certificate or key\n')
        (t/'invalid-config').write_text('{\n definitely_not_a_caddy_directive\n}\n')
        (t/'unreadable').write_text('synthetic unreadable\n'); os.chmod(t/'unreadable',0)
        for field in ['config','cert','key']:
            for kind in ['invalid','unreadable']:
                source='invalid-config' if kind=='invalid' and field=='config' else kind
                name,result=create(kind+'-'+field,**{field:source})
                check(kind+' '+field+' create',result.returncode==0)
                run(['docker','start',name])
                exited=run(['docker','wait',name],timeout=10).stdout.strip()
                check(kind+' '+field+' refuses',exited!='0' and not inspect(name)['State']['Running'])
        start=time.monotonic()
        run(['docker','kill','--signal','TERM',edge])
        check('bounded foreground SIGTERM',run(['docker','wait',edge],timeout=10).stdout.strip()=='0' and time.monotonic()-start<10)
        state=inspect(edge)['State']
        check('no OOM termination',not state['OOMKilled'])
        (E/'resources.json').write_text(json.dumps({'requested_memory_bytes':67108864,'requested_no_swap':True,'engine_memory':hc['Memory'],'engine_memory_swap':hc['MemorySwap'],'GOMEMLIMIT':'48MiB','hard_memory_enforcement_proven':hc['Memory']==67108864 and hc['MemorySwap']==67108864,'pi_capacity_acceptance':False},indent=2)+'\n')
        check('loopback test-only publication actually realized', port is not None and port['HostIp']=='127.0.0.1' and list(hc['PortBindings'])==['8445/tcp'])
    finally:
        for name in reversed(owned):
            run(['docker','logs',name],expected=None)
            run(['docker','rm','-f',name])
            check('removed exact fixture '+name,run(['docker','inspect','--type','container',name],expected=None).returncode!=0)
        for name in reversed(networks):
            run(['docker','network','rm',name])
            check('removed exact network '+name,run(['docker','network','inspect',name],expected=None).returncode!=0)
        (E/'checks.json').write_text(json.dumps({'checks':checks,'passed':len(checks)},indent=2)+'\n')
print(f'PASS {len(checks)} real immutable ARM64 TLS fixture assertions; no production app/DB/ingress actions')
