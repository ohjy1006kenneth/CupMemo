import { afterAll, beforeAll, expect, it } from 'vitest';
import { spawnSync } from 'node:child_process';
import { existsSync, mkdtempSync, readFileSync, writeFileSync, rmSync } from 'node:fs';
import path from 'node:path';
import process from 'node:process';
import { fileURLToPath, URL } from 'node:url';

const { structuredClone } = globalThis;

const root = fileURLToPath(new URL('../', import.meta.url));
const baseFile = path.join(root, 'infrastructure/docker/production.compose.yml');
const overlayFile = path.join(root, 'infrastructure/docker/cloudflare.compose.yml');
let temp, settings, baseSettings;

beforeAll(() => {
  temp = mkdtempSync('/tmp/cupmemo-cloudflare-offline-');
  writeFileSync(path.join(temp, 'empty.env'), '');
  writeFileSync(path.join(temp, 'api.env'), 'BETTER_AUTH_SECRET=NONSECRET_OFFLINE_PLACEHOLDER\n');
  writeFileSync(
    path.join(temp, '.env'),
    'TUNNEL_TOKEN=POISON_NONSECRET\nCOMPOSE_FILE=poison.yml\n',
  );
  // Secret paths deliberately do not exist: config must not read or create them.
  settings = {
    CUPMEMO_CLOUDFLARED_IMAGE: `cloudflare/cloudflared@sha256:${'4'.repeat(64)}`,
    CUPMEMO_CLOUDFLARED_UID: '12345',
    CLOUDFLARE_TUNNEL_TOKEN_FILE: path.join(temp, 'absent-token'),
  };
  baseSettings = {
    CUPMEMO_WEB_IMAGE: `sha256:${'1'.repeat(64)}`,
    CUPMEMO_API_IMAGE: `sha256:${'2'.repeat(64)}`,
    CUPMEMO_POSTGRES_IMAGE: `postgres:17-bookworm@sha256:${'3'.repeat(64)}`,
    CUPMEMO_API_ENV_FILE: path.join(temp, 'api.env'),
    POSTGRES_PASSWORD_FILE: path.join(temp, 'absent-pg-password'),
    POSTGRES_DATA_DIR: path.join(temp, 'absent-pgdata'),
    POSTGRES_DATA_UID: '12345',
    POSTGRES_DB: 'offline_candidate',
    POSTGRES_USER: 'offline_operator',
  };
});
afterAll(() => {
  if (temp) rmSync(temp, { recursive: true, force: true });
});

function render({ overlay = true, profile = true, overrides = {}, file = overlayFile } = {}) {
  const env = {
    PATH: process.env.PATH,
    HOME: temp,
    DOCKER_CONFIG: temp,
    DOCKER_HOST: `unix://${temp}/absent-docker.sock`,
    ...baseSettings,
    ...settings,
    ...overrides,
  };
  for (const key of Object.keys(env)) if (env[key] === undefined) delete env[key];
  return spawnSync(
    'docker',
    [
      'compose',
      '--env-file',
      path.join(temp, 'empty.env'),
      '-p',
      'cupmemo-offline-test',
      '-f',
      baseFile,
      ...(overlay ? ['-f', file] : []),
      ...(profile ? ['--profile', 'tunnel'] : []),
      'config',
      '--format',
      'json',
    ],
    { cwd: temp, env, encoding: 'utf8', timeout: 10000, maxBuffer: 1024 * 1024 },
  );
}

function model(options) {
  const result = render(options);
  expect(result.error).toBeUndefined();
  expect(result.status, result.stderr).toBe(0);
  return JSON.parse(result.stdout);
}

it('renders the optional connector offline without changing base services or networks', () => {
  const base = model({ overlay: false });
  const merged = model();
  expect(Object.keys(merged.services).sort()).toEqual(
    [...Object.keys(base.services), 'cloudflared'].sort(),
  );
  for (const [name, service] of Object.entries(base.services))
    expect(merged.services[name]).toEqual(service);
  for (const [name, network] of Object.entries(base.networks))
    expect(merged.networks[name]).toEqual(network);
  const connector = merged.services.cloudflared;
  expect(connector.profiles).toEqual(['tunnel']);
  expect(connector.command).toEqual(['tunnel', 'run']);
  expect(connector.environment).toEqual({
    TUNNEL_TOKEN_FILE: '/run/secrets/cloudflare_tunnel_token',
  });
  expect(connector.user).toBe('12345:12345');
  expect(Object.keys(connector.networks).sort()).toEqual(['frontend', 'tunnel-egress']);
  expect(merged.networks['tunnel-egress'].name).toBe('cupmemo-offline-test_tunnel-egress');
  expect(merged.networks['tunnel-egress'].internal ?? false).toBe(false);
  expect(merged.networks['tunnel-egress'].external ?? false).toBe(false);
  expect(model({ profile: false }).services.cloudflared).toBeUndefined();
  for (const file of [
    settings.CLOUDFLARE_TUNNEL_TOKEN_FILE,
    baseSettings.POSTGRES_PASSWORD_FILE,
    baseSettings.POSTGRES_DATA_DIR,
  ])
    expect(existsSync(file)).toBe(false);
});

it('refuses invalid settings offline without exposing rejected values', async () => {
  const { verifyCloudflareInputs } =
    await import('../infrastructure/scripts/cloudflare-compose.mjs');
  expect(verifyCloudflareInputs(settings)).toEqual(settings);
  const invalid = {
    CUPMEMO_CLOUDFLARED_IMAGE: [
      undefined,
      '',
      'latest',
      'cloudflare/cloudflared:latest',
      `evil/cloudflared@sha256:${'4'.repeat(64)}`,
      `sha256:${'4'.repeat(64)}`,
      '--option',
      'NONSECRET_TOKEN_VALUE',
    ],
    CUPMEMO_CLOUDFLARED_UID: [undefined, '', '0', '-1', '01', '1:1', 'node', '1\n', '4294967295'],
    CLOUDFLARE_TUNNEL_TOKEN_FILE: [
      undefined,
      '',
      'NONSECRET_TOKEN_VALUE',
      'relative/token',
      '/',
      '/tmp/../token',
      '/tmp/token/',
      `${root}token`,
      '/tmp/token\n',
    ],
  };
  for (const [key, values] of Object.entries(invalid)) {
    for (const value of values)
      expect(() => verifyCloudflareInputs({ ...settings, [key]: value })).toThrow(
        'Cloudflare inputs refused',
      );
  }
  for (const key of [
    'TUNNEL_TOKEN',
    'CLOUDFLARE_TUNNEL_TOKEN',
    'TUNNEL_CRED_CONTENTS',
    'PORT',
    'COMPOSE_FILE',
    'COMPOSE_PROFILES',
  ]) {
    expect(() => verifyCloudflareInputs({ ...settings, [key]: 'NONSECRET_TOKEN_VALUE' })).toThrow(
      'Cloudflare inputs refused',
    );
  }
});

it('rejects prohibited effective-model changes, including credential-value delivery', async () => {
  const { verifyCloudflareModel } =
    await import('../infrastructure/scripts/cloudflare-compose.mjs');
  const base = model({ overlay: false });
  const merged = model();
  expect(() => verifyCloudflareModel(base, merged, settings)).not.toThrow();
  const mutations = [
    (m) => {
      m.services.cloudflared.ports = [{ target: 3101, published: '3101' }];
    },
    (m) => {
      m.services.cloudflared.network_mode = 'host';
    },
    (m) => {
      m.services.cloudflared.networks.backend = null;
    },
    (m) => {
      m.services['cupmemo-api'].networks['tunnel-egress'] = null;
    },
    (m) => {
      m.networks['tunnel-egress'].external = true;
    },
    (m) => {
      m.networks['tunnel-egress'].internal = true;
    },
    (m) => {
      m.networks.frontend.internal = false;
    },
    (m) => {
      m.services.cloudflared.restart = 'always';
    },
    (m) => {
      m.services.cloudflared.pull_policy = 'always';
    },
    (m) => {
      m.services.cloudflared.user = '0:0';
    },
    (m) => {
      m.services.cloudflared.mem_limit = '134217728';
    },
    (m) => {
      m.services.cloudflared.volumes = [
        { source: '/var/run/docker.sock', target: '/var/run/docker.sock' },
      ];
    },
    (m) => {
      m.services.cloudflared.environment.TUNNEL_TOKEN = 'NONSECRET_TOKEN_VALUE';
    },
    (m) => {
      m.services.cloudflared.command.push('--token', 'NONSECRET_TOKEN_VALUE');
    },
    (m) => {
      m.secrets.cloudflare_tunnel_token = { environment: 'CLOUDFLARE_TUNNEL_TOKEN' };
    },
    (m) => {
      m.services.cloudflared.entrypoint = ['/bin/sh'];
    },
    (m) => {
      m.services.cloudflared.healthcheck = { test: ['CMD', 'curl'] };
    },
    (m) => {
      m.services.cloudflared.profiles = [];
    },
    (m) => {
      m.services.extra = {};
    },
    (m) => {
      m.volumes = { extra: {} };
    },
  ];
  for (const mutate of mutations) {
    const unsafe = structuredClone(merged);
    mutate(unsafe);
    expect(() => verifyCloudflareModel(base, unsafe, settings)).toThrow('Cloudflare model refused');
  }
  // Actual Compose accepts schema-valid unsafe overlays: the extra validator must refuse.
  const unsafeFile = path.join(temp, 'unsafe.compose.yml');
  writeFileSync(
    unsafeFile,
    readFileSync(overlayFile, 'utf8').replace("restart: 'no'", 'restart: always'),
  );
  expect(() => verifyCloudflareModel(base, model({ file: unsafeFile }), settings)).toThrow(
    'Cloudflare model refused',
  );
});

it('Compose itself rejects missing and empty required connector inputs', () => {
  for (const key of Object.keys(settings))
    for (const value of [undefined, '']) {
      const result = render({ overrides: { [key]: value } });
      expect(result.status).not.toBe(0);
      expect(result.stderr).toContain(key);
    }
});

it('Git ignores accidental credential copies without ignoring example/source files', () => {
  const ignored = [
    '.cloudflared/cert.pem',
    '.cloudflared/credentials.json',
    'cloudflare_tunnel_token',
    'nested/cloudflare_tunnel_token',
    '.env.production',
  ];
  for (const file of ignored)
    expect(spawnSync('git', ['check-ignore', '--no-index', '-q', file], { cwd: root }).status).toBe(
      0,
    );
  for (const file of [
    '.env.example',
    'infrastructure/docker/cloudflare.compose.yml',
    'docs/CLOUDFLARE_COMPOSE.md',
  ])
    expect(spawnSync('git', ['check-ignore', '--no-index', '-q', file], { cwd: root }).status).toBe(
      1,
    );
});
