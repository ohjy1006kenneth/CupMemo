// Integration check, intentionally separate from Vitest: build the pinned Go
// harness first and pass its absolute binary path. Only synthetic SSD files.
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync, readFileSync, rmSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { spawnSync } from 'node:child_process';
import path from 'node:path';
import process from 'node:process';
import { fileURLToPath, URL } from 'node:url';

const root = fileURLToPath(new URL('../../', import.meta.url));
const binary = process.argv[2];
assert.ok(binary && path.isAbsolute(binary), 'absolute offline harness binary required');
const temp = mkdtempSync(path.join(tmpdir(), 'cupmemo-importer-check-'));
function execute(command, args) {
  const result = spawnSync(command, args, {
    cwd: temp,
    env: { PATH: process.env.PATH, HOME: temp, DOCKER_HOST: `unix://${temp}/absent.sock` },
    encoding: 'utf8',
    timeout: 15000,
    maxBuffer: 1048576,
  });
  assert.equal(result.status, 0, result.stderr);
  return result.stdout;
}
try {
  const hostile =
    '  SYNTHETIC $NAME ${NAME:-default} ${NAME:?no} $$ $$$ $TZ $AppID $WEBUI_PORT # " \' \\ café 🫘 \t\n\u0085\u2028\u2029  ';
  const settings = {
    CUPMEMO_WEB_IMAGE: `sha256:${'1'.repeat(64)}`,
    CUPMEMO_API_IMAGE: `sha256:${'2'.repeat(64)}`,
    CUPMEMO_POSTGRES_IMAGE: `postgres:17-bookworm@sha256:${'3'.repeat(64)}`,
    POSTGRES_DATA_UID: '12345',
    POSTGRES_HDD_UUID: '11111111-2222-3333-4444-555555555555',
    POSTGRES_HDD_MOUNT: temp,
    POSTGRES_DB: 'offline_candidate',
    POSTGRES_USER: 'offline_operator',
    POSTGRES_DATA_DIR: path.join(temp, 'absent $DATA ${DIR:-x} " # 🫘'),
    POSTGRES_PASSWORD_FILE: path.join(temp, 'password $FILE ${NAME:-x} " # 🫘'),
    CUPMEMO_DATABASE_URL_PRODUCTION:
      'postgresql://offline:synthetic$PASSWORD@cupmemo-postgres:5432/offline_candidate',
    BETTER_AUTH_SECRET: hostile,
    BETTER_AUTH_URL: 'https://fixture.tailnet.ts.net:8445',
    CUPMEMO_TLS_IMAGE: `caddy:2.11.7-alpine@sha256:${'4'.repeat(64)}`,
    CUPMEMO_TLS_BIND_IP: '100.127.255.254',
    CUPMEMO_TLS_HOSTNAME: 'fixture.tailnet.ts.net',
    CUPMEMO_TLS_UID: '12346',
    CUPMEMO_TLS_CONFIG_FILE: path.join(temp, 'Caddyfile $CONFIG ${FILE:-x} " # 🫘'),
    CUPMEMO_TLS_CERT_FILE: path.join(temp, 'cert $CERT ${FILE:-x} " # 🫘'),
    CUPMEMO_TLS_KEY_FILE: path.join(temp, 'key $KEY ${FILE:-x} " # 🫘'),
  };
  writeFileSync(path.join(temp, 'password'), 'SYNTHETIC');
  writeFileSync(settings.POSTGRES_PASSWORD_FILE, 'SYNTHETIC', { mode: 0o600 });
  writeFileSync(path.join(temp, 'input.json'), JSON.stringify(settings), { mode: 0o600 });
  writeFileSync(path.join(temp, 'empty.env'), '');
  // Importer must not use this file or inherited interpolation settings.
  writeFileSync(path.join(temp, '.env'), 'BETTER_AUTH_SECRET=POISON\nNAME=POISON\n');
  execute(process.execPath, [
    path.join(root, 'infrastructure/scripts/casaos-app-prepare.mjs'),
    '--config',
    path.join(temp, 'input.json'),
    '--output',
    path.join(temp, 'app.yml'),
  ]);
  const result = JSON.parse(
    execute(binary, [path.join(temp, 'app.yml'), path.join(temp, 'retained.yml')]),
  );
  const model = result.reloaded;
  assert.deepEqual(Object.keys(model.services).sort(), [
    'cupmemo-api',
    'cupmemo-postgres',
    'cupmemo-tls',
    'cupmemo-web',
  ]);
  for (const key of ['BETTER_AUTH_SECRET', 'BETTER_AUTH_URL', 'CUPMEMO_DATABASE_URL_PRODUCTION']) {
    assert.equal(model.services['cupmemo-api'].environment[key], settings[key], key);
  }
  assert.equal(model.services['cupmemo-api'].environment.NODE_ENV, 'production');
  assert.equal(model.services['cupmemo-api'].environment.CUPMEMO_DB_ENV, 'production');
  assert.equal(model.services['cupmemo-api'].environment.CUPMEMO_API_HOST, '0.0.0.0');
  assert.equal(model.services['cupmemo-api'].environment.CUPMEMO_API_PORT, '4101');
  assert.equal(model.services['cupmemo-api'].env_file, undefined);
  assert.equal(model.secrets.postgres_password.file, settings.POSTGRES_PASSWORD_FILE);
  const pg = model.services['cupmemo-postgres'];
  assert.equal(pg.user, settings.POSTGRES_DATA_UID);
  assert.equal(pg.volumes[0].type, 'bind');
  assert.equal(pg.volumes[0].source, settings.POSTGRES_DATA_DIR);
  assert.equal(pg.volumes[0].target, '/var/lib/postgresql/data');
  assert.notEqual(pg.volumes[0].bind?.create_host_path, true);
  assert.equal(pg.environment.POSTGRES_PASSWORD_FILE, '/run/secrets/postgres_password');
  assert.equal(pg.environment.PGDATA, '/var/lib/postgresql/data/pgdata');
  for (const key of [
    'POSTGRES_HDD_UUID',
    'POSTGRES_HDD_MOUNT',
    'POSTGRES_DATA_DIR',
    'POSTGRES_DATA_UID',
  ])
    assert.equal(pg.environment[key], settings[key], key);
  assert.deepEqual(pg.healthcheck.test, [
    'CMD-SHELL',
    'pg_isready -h 127.0.0.1 -U "$POSTGRES_USER" -d "$POSTGRES_DB"',
  ]);
  assert.equal(pg.secrets[0].source, 'postgres_password');
  assert.equal(pg.secrets[0].target, '/run/secrets/postgres_password');
  const tls = model.services['cupmemo-tls'];
  assert.equal(tls.image, settings.CUPMEMO_TLS_IMAGE);
  assert.equal(tls.platform, 'linux/arm64');
  assert.equal(tls.user, settings.CUPMEMO_TLS_UID);
  assert.equal(tls.read_only, true);
  assert.equal(tls.restart, 'no');
  assert.equal(tls.pull_policy, 'never');
  assert.equal(Number(tls.mem_limit), 64 * 1024 * 1024);
  assert.equal(tls.memswap_limit, tls.mem_limit);
  assert.equal(Number(tls.cpus), 0.25);
  assert.equal(tls.pids_limit, 64);
  assert.deepEqual(tls.cap_drop, ['ALL']);
  assert.deepEqual(tls.security_opt, ['no-new-privileges:true']);
  assert.deepEqual(tls.logging, {
    driver: 'json-file',
    options: { 'max-size': '10m', 'max-file': '3' },
  });
  assert.deepEqual(tls.environment, {
    GOMEMLIMIT: '48MiB',
    CUPMEMO_TLS_HOSTNAME: settings.CUPMEMO_TLS_HOSTNAME,
  });
  assert.deepEqual(tls.command, [
    'caddy',
    'run',
    '--config',
    '/etc/caddy/Caddyfile',
    '--adapter',
    'caddyfile',
  ]);
  assert.deepEqual(Object.keys(tls.networks).sort(), ['frontend', 'private_ingress']);
  assert.equal(tls.depends_on['cupmemo-web'].condition, 'service_healthy');
  assert.equal(tls.ports.length, 1);
  assert.equal(tls.ports[0].host_ip, settings.CUPMEMO_TLS_BIND_IP);
  assert.equal(tls.ports[0].published, '8445');
  assert.equal(tls.ports[0].target, 8445);
  assert.equal(tls.ports[0].protocol, 'tcp');
  assert.deepEqual(
    tls.tmpfs,
    ['/data', '/config', '/tmp'].map((p) => `${p}:rw,noexec,nosuid,nodev,size=16m,mode=1777`),
  );
  assert.equal(tls.volumes.length, 3);
  for (const [index, key, target] of [
    [0, 'CUPMEMO_TLS_CONFIG_FILE', '/etc/caddy/Caddyfile'],
    [1, 'CUPMEMO_TLS_CERT_FILE', '/run/secrets/cupmemo_tls_cert'],
    [2, 'CUPMEMO_TLS_KEY_FILE', '/run/secrets/cupmemo_tls_key'],
  ]) {
    const mount = tls.volumes[index];
    assert.equal(mount.type, 'bind');
    assert.equal(mount.source, settings[key]);
    assert.equal(mount.target, target);
    assert.equal(mount.read_only, true);
    assert.notEqual(mount.bind?.create_host_path, true);
  }
  assert.deepEqual(tls.healthcheck.test, [
    'CMD-SHELL',
    'curl --fail --silent --output /dev/null --max-time 3 --noproxy "*" --cacert /run/secrets/cupmemo_tls_cert --resolve "$CUPMEMO_TLS_HOSTNAME:8445:127.0.0.1" "https://$CUPMEMO_TLS_HOSTNAME:8445/sign-in"',
  ]);
  for (const key of ['privileged', 'devices', 'build', 'network_mode', 'cap_add', 'secrets'])
    assert.equal(tls[key], undefined);
  for (const [name, image, memory] of [
    ['cupmemo-web', settings.CUPMEMO_WEB_IMAGE, 512],
    ['cupmemo-api', settings.CUPMEMO_API_IMAGE, 256],
    ['cupmemo-postgres', settings.CUPMEMO_POSTGRES_IMAGE, 512],
  ]) {
    const service = model.services[name];
    assert.equal(service.image, image);
    assert.equal(service.platform, 'linux/arm64');
    assert.equal(service.restart, 'no');
    assert.equal(service.pull_policy, 'never');
    assert.equal(Number(service.mem_limit), memory * 1024 * 1024);
    assert.equal(service.memswap_limit, service.mem_limit);
    assert.equal(Number(service.cpus), 1);
    assert.equal(service.pids_limit, 128);
    assert.deepEqual(service.cap_drop, ['ALL']);
    assert.deepEqual(service.security_opt, ['no-new-privileges:true']);
    assert.deepEqual(service.logging, {
      driver: 'json-file',
      options: { 'max-size': '10m', 'max-file': '3' },
    });
    assert.equal(service.healthcheck.interval, '10s');
    assert.equal(service.healthcheck.timeout, '5s');
    assert.equal(service.healthcheck.retries, 6);
    assert.equal(service.healthcheck.start_period, '30s');
    for (const key of ['ports', 'privileged', 'devices', 'build', 'network_mode', 'cap_add'])
      assert.equal(service[key], undefined);
    if (name !== 'cupmemo-postgres') {
      assert.equal(service.user, 'node');
      assert.equal(service.read_only, true);
      assert.deepEqual(service.tmpfs, ['/tmp:rw,noexec,nosuid,nodev,size=64m,mode=1777']);
      assert.equal(service.volumes, undefined);
    }
  }
  assert.equal(
    model.services['cupmemo-api'].depends_on['cupmemo-postgres'].condition,
    'service_healthy',
  );
  assert.equal(
    model.services['cupmemo-web'].depends_on['cupmemo-api'].condition,
    'service_healthy',
  );
  assert.deepEqual(Object.keys(pg.networks), ['backend']);
  assert.deepEqual(Object.keys(model.services['cupmemo-web'].networks), ['frontend']);
  assert.deepEqual(Object.keys(model.services['cupmemo-api'].networks).sort(), [
    'backend',
    'frontend',
  ]);
  assert.deepEqual(Object.keys(model.networks).sort(), ['backend', 'frontend', 'private_ingress']);
  for (const [name, network] of Object.entries(model.networks)) {
    assert.equal(
      Boolean(network.internal),
      name !== 'private_ingress',
      JSON.stringify(model.networks),
    );
    assert.notEqual(network.external, true);
    assert.deepEqual(network.ipam ?? {}, {});
    if (name === 'private_ingress') assert.equal(network.driver, 'bridge');
  }
  assert.equal(model['x-casaos'].main, 'cupmemo-web');
  assert.equal(model['x-casaos'].title.en_US, 'CupMemo');
  assert.deepEqual(model['x-casaos'].architectures, ['arm64']);
  assert.equal(model['x-casaos'].port_map, undefined);
  assert.equal(existsSync(settings.POSTGRES_DATA_DIR), false);
  // Validate the retained install artifact with modern Compose as an additional,
  // independent schema check; no daemon, PGDATA or real credential is accessed.
  execute('docker', [
    'compose',
    '--env-file',
    path.join(temp, 'empty.env'),
    '-f',
    path.join(temp, 'retained.yml'),
    'config',
    '--quiet',
  ]);
  // A single interpolation escape is insufficient across install+reload.
  const negative = readFileSync(path.join(temp, 'app.yml'), 'utf8').replaceAll('$$$$', () => '$$');
  writeFileSync(path.join(temp, 'unsafe.yml'), negative, { mode: 0o600 });
  const bad = spawnSync(
    binary,
    [path.join(temp, 'unsafe.yml'), path.join(temp, 'unsafe-retained.yml')],
    { cwd: temp, env: { PATH: process.env.PATH }, encoding: 'utf8', timeout: 15000 },
  );
  assert.ok(
    bad.status !== 0 ||
      JSON.parse(bad.stdout).reloaded.services['cupmemo-api'].environment.BETTER_AUTH_SECRET !==
        hostile,
    'unsafe single-pass escaping must not satisfy literal-value control',
  );
  process.stdout.write(
    'PASS compose-go v1.20.2 stock import + marshal/reload: exact literals, complete runtime/security/storage, modern retained config and negative escape control; no live actions\n',
  );
} finally {
  rmSync(temp, { recursive: true, force: true });
}
