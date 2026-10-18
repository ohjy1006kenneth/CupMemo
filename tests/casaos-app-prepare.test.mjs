import { expect, test } from 'vitest';
import { spawnSync } from 'node:child_process';
import {
  mkdtempSync,
  writeFileSync,
  readFileSync,
  statSync,
  rmSync,
  existsSync,
  chmodSync,
  symlinkSync,
  linkSync,
  mkdirSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import process from 'node:process';
import { fileURLToPath, URL } from 'node:url';

const helper = fileURLToPath(
  new URL('../infrastructure/scripts/casaos-app-prepare.mjs', import.meta.url),
);

export function fixture(temp) {
  return {
    CUPMEMO_WEB_IMAGE: `sha256:${'1'.repeat(64)}`,
    CUPMEMO_API_IMAGE: `sha256:${'2'.repeat(64)}`,
    CUPMEMO_POSTGRES_IMAGE: `postgres:17-bookworm@sha256:${'3'.repeat(64)}`,
    POSTGRES_DATA_UID: '12345',
    POSTGRES_HDD_UUID: '11111111-2222-3333-4444-555555555555',
    POSTGRES_HDD_MOUNT: temp,
    POSTGRES_DB: 'offline_candidate',
    POSTGRES_USER: 'offline_operator',
    POSTGRES_DATA_DIR: path.join(temp, 'absent-data'),
    POSTGRES_PASSWORD_FILE: path.join(temp, 'password'),
    CUPMEMO_DATABASE_URL_PRODUCTION:
      'postgresql://offline:synthetic@cupmemo-postgres:5432/offline_candidate',
    BETTER_AUTH_SECRET:
      '  SYNTHETIC ONLY $NAME ${NAME:-default} $$ # " \\ café 🫘 \t\n\u0085\u2028\u2029  ',
    BETTER_AUTH_URL: 'https://fixture.tailnet.ts.net:8445',
    CUPMEMO_TLS_IMAGE: `caddy:2.11.7-alpine@sha256:${'4'.repeat(64)}`,
    CUPMEMO_TLS_BIND_IP: '100.64.0.1',
    CUPMEMO_TLS_HOSTNAME: 'fixture.tailnet.ts.net',
    CUPMEMO_TLS_UID: '12346',
    CUPMEMO_TLS_CONFIG_FILE: path.join(temp, 'Caddyfile'),
    CUPMEMO_TLS_CERT_FILE: path.join(temp, 'cert'),
    CUPMEMO_TLS_KEY_FILE: path.join(temp, 'key'),
  };
}

function run(config, output) {
  return spawnSync(process.execPath, [helper, '--config', config, '--output', output], {
    encoding: 'utf8',
    timeout: 10000,
    env: { PATH: process.env.PATH, BETTER_AUTH_SECRET: 'POISON_INHERITED' },
  });
}

test('prepares a new private stock Compose without exposing values or provisioning data', () => {
  const temp = mkdtempSync(path.join(tmpdir(), 'cupmemo-prepare-'));
  try {
    const config = path.join(temp, 'input.json'),
      output = path.join(temp, 'app.yml');
    const values = fixture(temp);
    writeFileSync(config, JSON.stringify(values), { mode: 0o600 });
    const result = run(config, output);
    expect(result.status, result.stderr).toBe(0);
    expect(result.stdout).toBe('');
    expect(result.stderr).toBe('CasaOS app: private configuration prepared\n');
    expect(statSync(output).mode & 0o777).toBe(0o600);
    const bytes = readFileSync(output);
    expect(bytes.length).toBeGreaterThan(0);
    expect(existsSync(values.POSTGRES_DATA_DIR)).toBe(false);
    expect(run(config, output).status).toBe(1);
    expect(readFileSync(output)).toEqual(bytes);
  } finally {
    rmSync(temp, { recursive: true, force: true });
  }
});

// Keep the same negative matrix in small independent cases, not 100+ Node
// subprocesses behind a single Vitest deadline on a concurrent hosted runner.
test.each([null, ...Object.keys(fixture('/synthetic'))])(
  'refuses invalid %s with fixed diagnostics and no output',
  (key) => {
    const temp = mkdtempSync(path.join(tmpdir(), 'cupmemo-prepare-negative-'));
    try {
      const config = path.join(temp, 'input.json'),
        output = path.join(temp, 'app.yml');
      const base = fixture(temp);
      const invalid =
        key === null ? [null, [], 'SYNTHETIC_SECRET', { ...base, extra: 'SECRET' }] : [];
      if (key !== null) {
        const omitted = { ...base };
        delete omitted[key];
        invalid.push(omitted);
        for (const value of ['', ' ', null, 1, {}, ['SECRET'], 'SECRET\0'])
          invalid.push({ ...base, [key]: value });
      }
      if (
        [
          'CUPMEMO_WEB_IMAGE',
          'CUPMEMO_API_IMAGE',
          'CUPMEMO_POSTGRES_IMAGE',
          'CUPMEMO_TLS_IMAGE',
        ].includes(key)
      ) {
        for (const value of ['latest', 'postgres:17', '--option', `sha256:${'A'.repeat(64)}`])
          invalid.push({ ...base, [key]: value });
      }
      if (['POSTGRES_DATA_UID', 'CUPMEMO_TLS_UID'].includes(key)) {
        for (const value of ['0', '-1', '001', '1.5', '4294967295'])
          invalid.push({ ...base, [key]: value });
      }
      if (key === 'POSTGRES_HDD_UUID') {
        for (const value of ['not-a-uuid', '11111111-2222-3333-4444-AAAAAAAAAAAA'])
          invalid.push({ ...base, [key]: value });
      }
      if (key === 'POSTGRES_HDD_MOUNT') {
        for (const value of [base.POSTGRES_DATA_DIR, `${temp}-other`, `${temp}/absent-data/child`])
          invalid.push({ ...base, [key]: value });
      }
      if (
        [
          'POSTGRES_DATA_DIR',
          'POSTGRES_PASSWORD_FILE',
          'POSTGRES_HDD_MOUNT',
          'CUPMEMO_TLS_CONFIG_FILE',
          'CUPMEMO_TLS_CERT_FILE',
          'CUPMEMO_TLS_KEY_FILE',
        ].includes(key)
      ) {
        for (const value of ['/', './relative', '/a/../b', '/a/', '/a//b', '/a\nb'])
          invalid.push({ ...base, [key]: value });
      }
      if (key === 'CUPMEMO_TLS_BIND_IP') {
        for (const value of [
          '0.0.0.0',
          '::',
          '127.0.0.1',
          '192.168.1.1',
          '8.8.8.8',
          '100.63.255.255',
          '100.128.0.0',
          '100.064.0.1',
          '100.64.0.256',
          '100.64.0.1:8445',
          ' 100.64.0.1',
        ])
          invalid.push({ ...base, [key]: value });
      }
      if (key === 'CUPMEMO_TLS_HOSTNAME') {
        for (const value of [
          'ts.net',
          '*.ts.net',
          'example.com',
          'UPPER.ts.net',
          '-bad.ts.net',
          'bad-.ts.net',
          'bad..ts.net',
          'host.ts.net.',
          'host.ts.net:8445',
          'host.ts.net\n',
        ])
          invalid.push({ ...base, [key]: value });
      }
      if (key === 'BETTER_AUTH_URL') {
        for (const value of [
          'http://fixture.tailnet.ts.net:8445',
          'https://other.ts.net:8445',
          'https://fixture.tailnet.ts.net',
          'https://fixture.tailnet.ts.net:8445/',
          'https://fixture.tailnet.ts.net:8445?q=x',
          'https://user@fixture.tailnet.ts.net:8445',
          'https://fixture.tailnet.ts.net:8444',
        ])
          invalid.push({ ...base, [key]: value });
      }
      for (const values of invalid) {
        writeFileSync(config, JSON.stringify(values), { mode: 0o600 });
        const result = run(config, output);
        expect(result.status).toBe(1);
        expect(result.stdout).toBe('');
        expect(result.stderr).toBe('CasaOS app: preparation refused\n');
        expect(existsSync(output)).toBe(false);
      }
      if (key === null) {
        writeFileSync(config, '{SYNTHETIC_SECRET', { mode: 0o600 });
        expect(run(config, output).stderr).toBe('CasaOS app: preparation refused\n');
      }
    } finally {
      rmSync(temp, { recursive: true, force: true });
    }
  },
);

test('rejects unsafe files, symlink parents, hardlinks and existing outputs without clobber', () => {
  const temp = mkdtempSync(path.join(tmpdir(), 'cupmemo-prepare-files-'));
  try {
    const config = path.join(temp, 'input.json'),
      output = path.join(temp, 'app.yml');
    writeFileSync(config, JSON.stringify(fixture(temp)), { mode: 0o600 });
    chmodSync(config, 0o644);
    expect(run(config, output).status).toBe(1);
    chmodSync(config, 0o600);
    const alias = path.join(temp, 'alias');
    symlinkSync(config, alias);
    expect(run(alias, output).status).toBe(1);
    const hardlink = path.join(temp, 'hardlink');
    linkSync(config, hardlink);
    expect(run(config, output).status).toBe(1);
    rmSync(hardlink);
    const parentAlias = path.join(temp, 'parent');
    symlinkSync(temp, parentAlias);
    expect(run(config, path.join(parentAlias, 'app.yml')).status).toBe(1);
    const publicParent = path.join(temp, 'public');
    mkdirSync(publicParent, { mode: 0o755 });
    expect(run(config, path.join(publicParent, 'app.yml')).status).toBe(1);
    symlinkSync(config, output);
    const before = readFileSync(config);
    expect(run(config, output).status).toBe(1);
    expect(readFileSync(config)).toEqual(before);
    rmSync(output);
    expect(run('relative.json', output).status).toBe(1);
    expect(run(config, 'relative.yml').status).toBe(1);
    expect(existsSync(output)).toBe(false);
  } finally {
    rmSync(temp, { recursive: true, force: true });
  }
});
