import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import process from 'node:process';
import { fileURLToPath, URL } from 'node:url';

const root = fileURLToPath(new URL('../', import.meta.url));
const compose = path.join(root, 'infrastructure/docker/production.compose.yml');
const required = [
  'CUPMEMO_WEB_IMAGE',
  'CUPMEMO_API_IMAGE',
  'CUPMEMO_POSTGRES_IMAGE',
  'CUPMEMO_API_ENV_FILE',
  'POSTGRES_PASSWORD_FILE',
  'POSTGRES_DATA_DIR',
  'POSTGRES_DATA_UID',
  'POSTGRES_DB',
  'POSTGRES_USER',
];
let temp;
let settings;
let model;

function config(overrides = {}, args = ['--format', 'json']) {
  // No inherited production variables, implicit .env, or reachable Docker daemon.
  const env = {
    PATH: process.env.PATH,
    HOME: temp,
    DOCKER_HOST: `unix://${temp}/absent-docker.sock`,
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
      compose,
      'config',
      ...args,
    ],
    { cwd: temp, env, encoding: 'utf8', timeout: 10000, maxBuffer: 1024 * 1024 },
  );
}

beforeAll(() => {
  temp = mkdtempSync(path.join(tmpdir(), 'cupmemo-compose-offline-'));
  writeFileSync(path.join(temp, 'empty.env'), '');
  writeFileSync(
    path.join(temp, 'api.env'),
    'CUPMEMO_DATABASE_URL_PRODUCTION=NONSECRET_OFFLINE_PLACEHOLDER\nBETTER_AUTH_SECRET=NONSECRET_OFFLINE_PLACEHOLDER\nBETTER_AUTH_URL=https://offline.invalid\n',
  );
  writeFileSync(path.join(temp, 'pg-password'), 'NONSECRET_OFFLINE_PLACEHOLDER');
  // Deliberately hostile implicit .env: it must never contribute settings.
  writeFileSync(
    path.join(temp, '.env'),
    'COMPOSE_PROJECT_NAME=unrelated\nCUPMEMO_WEB_IMAGE=unsafe:latest\n',
  );
  settings = {
    CUPMEMO_WEB_IMAGE: `sha256:${'1'.repeat(64)}`,
    CUPMEMO_API_IMAGE: `sha256:${'2'.repeat(64)}`,
    CUPMEMO_POSTGRES_IMAGE: `postgres:17-bookworm@sha256:${'3'.repeat(64)}`,
    CUPMEMO_API_ENV_FILE: path.join(temp, 'api.env'),
    POSTGRES_PASSWORD_FILE: path.join(temp, 'pg-password'),
    POSTGRES_DATA_DIR: path.join(temp, 'never-created-pgdata'),
    POSTGRES_DATA_UID: '12345',
    POSTGRES_DB: 'offline_candidate',
    POSTGRES_USER: 'offline_operator',
  };
});
afterAll(() => {
  if (temp) rmSync(temp, { recursive: true, force: true });
});

describe('dormant private production Compose (actual offline CLI)', () => {
  it('renders without a daemon and passes actual quiet validation', () => {
    const result = config();
    expect(result.error).toBeUndefined();
    expect(result.status, result.stderr).toBe(0);
    model = JSON.parse(result.stdout);
    expect(config({}, ['--quiet']).status).toBe(0);
    expect(model.name).toBe('cupmemo-offline-test');
    expect(Object.keys(model.services).sort()).toEqual([
      'cupmemo-api',
      'cupmemo-postgres',
      'cupmemo-web',
    ]);
  });

  it.each(required)('refuses omitted or empty %s instead of development defaults', (key) => {
    for (const value of [undefined, '']) {
      const result = config({ [key]: value });
      expect(result.status).not.toBe(0);
      expect(result.stderr).toContain(key);
    }
  });

  it('requires a real external API env file, without creating it or the data path', () => {
    const missing = path.join(temp, 'never-created-api.env');
    expect(config({ CUPMEMO_API_ENV_FILE: missing }).status).not.toBe(0);
    expect(existsSync(missing)).toBe(false);
    expect(existsSync(settings.POSTGRES_DATA_DIR)).toBe(false);
  });

  it('has exactly two project-scoped internal networks with segregated membership', () => {
    expect(Object.keys(model.networks).sort()).toEqual(['backend', 'frontend']);
    for (const [key, network] of Object.entries(model.networks)) {
      expect(network.internal).toBe(true);
      expect(network.external).not.toBe(true);
      expect(network.name).toBe(`cupmemo-offline-test_${key}`);
    }
    expect(Object.keys(model.services['cupmemo-web'].networks)).toEqual(['frontend']);
    expect(Object.keys(model.services['cupmemo-api'].networks).sort()).toEqual([
      'backend',
      'frontend',
    ]);
    expect(Object.keys(model.services['cupmemo-postgres'].networks)).toEqual(['backend']);
  });

  it('is dormant, bounded, nonprivileged and has no image/build/network fallbacks', () => {
    const budgets = { 'cupmemo-web': 512, 'cupmemo-api': 256, 'cupmemo-postgres': 512 };
    for (const [name, service] of Object.entries(model.services)) {
      const imageKey =
        name === 'cupmemo-postgres'
          ? 'CUPMEMO_POSTGRES_IMAGE'
          : name === 'cupmemo-api'
            ? 'CUPMEMO_API_IMAGE'
            : 'CUPMEMO_WEB_IMAGE';
      expect(service.image).toBe(settings[imageKey]);
      expect(service.platform).toBe('linux/arm64');
      expect(service.pull_policy).toBe('never');
      expect(service.restart).toBe('no');
      // Compose versions serialize resource scalars as strings or numbers.
      expect(Number(service.mem_limit)).toBe(budgets[name] * 1024 * 1024);
      expect(Number(service.memswap_limit)).toBe(Number(service.mem_limit));
      expect(Number(service.cpus)).toBe(1);
      expect(service.pids_limit).toBe(128);
      expect(service.cap_drop).toEqual(['ALL']);
      expect(service.security_opt).toEqual(['no-new-privileges:true']);
      expect(service.logging).toEqual({
        driver: 'json-file',
        options: { 'max-size': '10m', 'max-file': '3' },
      });
      for (const forbidden of [
        'ports',
        'build',
        'container_name',
        'network_mode',
        'privileged',
        'cap_add',
        'devices',
        'pid',
        'ipc',
      ]) {
        expect(service[forbidden], `${name}.${forbidden}`).toBeUndefined();
      }
      // Compose may explicitly serialize null: it preserves the image default.
      // Empty strings/arrays would override it and must still be rejected.
      for (const key of ['entrypoint', 'command']) {
        expect(service[key] == null, `${name}.${key} must retain the image default`).toBe(true);
      }
    }
    expect(model.volumes).toBeUndefined();
  });

  it('keeps application roots read-only and provides only private bounded temporary storage', () => {
    for (const name of ['cupmemo-web', 'cupmemo-api']) {
      const service = model.services[name];
      expect(service.user).toBe('node');
      expect(service.read_only).toBe(true);
      expect(service.tmpfs).toEqual(['/tmp:rw,noexec,nosuid,nodev,size=64m,mode=1777']);
      expect(service.volumes).toBeUndefined();
      expect(service.secrets).toBeUndefined();
    }
    expect(model.services['cupmemo-web'].environment).toEqual({
      NODE_ENV: 'production',
      HOSTNAME: '0.0.0.0',
      PORT: '3101',
      CUPMEMO_API_ORIGIN: 'http://cupmemo-api:4101',
    });
    const api = model.services['cupmemo-api'].environment;
    expect(api).toMatchObject({
      NODE_ENV: 'production',
      CUPMEMO_DB_ENV: 'production',
      CUPMEMO_API_HOST: '0.0.0.0',
      CUPMEMO_API_PORT: '4101',
      BETTER_AUTH_URL: 'https://offline.invalid',
      BETTER_AUTH_SECRET: 'NONSECRET_OFFLINE_PLACEHOLDER',
      CUPMEMO_DATABASE_URL_PRODUCTION: 'NONSECRET_OFFLINE_PLACEHOLDER',
    });
    expect(api.DATABASE_URL).toBeUndefined();
  });

  it('uses an explicit numeric PG owner, non-auto-created bind and external password file', () => {
    const pg = model.services['cupmemo-postgres'];
    expect(pg.user).toBe(settings.POSTGRES_DATA_UID);
    expect(pg.volumes).toEqual([
      {
        type: 'bind',
        source: settings.POSTGRES_DATA_DIR,
        target: '/var/lib/postgresql/data',
        bind: { create_host_path: false },
      },
    ]);
    expect(pg.environment).toEqual({
      POSTGRES_DB: settings.POSTGRES_DB,
      POSTGRES_USER: settings.POSTGRES_USER,
      POSTGRES_PASSWORD_FILE: '/run/secrets/postgres_password',
      PGDATA: '/var/lib/postgresql/data/pgdata',
    });
    expect(pg.secrets).toEqual([
      { source: 'postgres_password', target: '/run/secrets/postgres_password' },
    ]);
    expect(model.secrets).toEqual({
      postgres_password: {
        name: 'cupmemo-offline-test_postgres_password',
        file: settings.POSTGRES_PASSWORD_FILE,
      },
    });
    expect(existsSync(settings.POSTGRES_DATA_DIR)).toBe(false);
  });

  it('uses installed-tool readiness checks and health-ordered dependencies without migrations', () => {
    for (const service of Object.values(model.services)) {
      expect(service.healthcheck).toMatchObject({
        interval: '10s',
        timeout: '5s',
        retries: 6,
        start_period: '30s',
      });
    }
    const web = model.services['cupmemo-web'];
    const api = model.services['cupmemo-api'];
    const pg = model.services['cupmemo-postgres'];
    expect(web.depends_on).toEqual({
      'cupmemo-api': { condition: 'service_healthy', required: true },
    });
    expect(api.depends_on).toEqual({
      'cupmemo-postgres': { condition: 'service_healthy', required: true },
    });
    for (const [service, url] of [
      [web, 'http://127.0.0.1:3101/sign-in'],
      [api, 'http://127.0.0.1:4101/ready'],
    ]) {
      expect(service.healthcheck.test.slice(0, 3)).toEqual(['CMD', 'node', '-e']);
      expect(service.healthcheck.test[3]).toContain(url);
      expect(service.healthcheck.test[3]).toContain('AbortSignal.timeout(3000)');
      expect(service.healthcheck.test[3]).toContain('r.status===200');
    }
    // config may retain $$ for round-trip Compose serialization; the engine
    // receives a single $ for container-shell environment expansion.
    expect(pg.healthcheck.test.map((arg) => arg.replaceAll('$$', '$'))).toEqual([
      'CMD-SHELL',
      'pg_isready -h 127.0.0.1 -U "$POSTGRES_USER" -d "$POSTGRES_DB"',
    ]);
    expect(pg.depends_on).toBeUndefined();
  });

  it('preserves the development Compose bytes and documents the unverified activation gates', () => {
    const dev = readFileSync(path.join(root, 'infrastructure/docker/database.compose.yml'));
    expect(createHash('sha256').update(dev).digest('hex')).toBe(
      'cf3a5884baca8e268ae17be1bcf53d9638ecd9f124315abbbcb4244dd176d000',
    );
    const docs = readFileSync(path.join(root, 'docs/PRIVATE_COMPOSE.md'), 'utf8');
    for (const phrase of [
      'UNVERIFIED',
      'Issue11',
      'Issue42',
      'create_host_path',
      'PG17',
      'ARM64',
      'UID',
      'missing-HDD',
      'coexistence',
      'restart',
      '--env-file',
      '--quiet',
    ])
      expect(docs.toLowerCase()).toContain(phrase.toLowerCase());
    expect(docs).not.toMatch(/docker compose[^\n]*\b(up|create|start|run|pull|build)\b/);
  });
});
