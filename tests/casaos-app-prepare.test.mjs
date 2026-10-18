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
    POSTGRES_DB: 'offline_candidate',
    POSTGRES_USER: 'offline_operator',
    POSTGRES_DATA_DIR: path.join(temp, 'absent-data'),
    POSTGRES_PASSWORD_FILE: path.join(temp, 'password'),
    CUPMEMO_DATABASE_URL_PRODUCTION:
      'postgresql://offline:synthetic@cupmemo-postgres:5432/offline_candidate',
    BETTER_AUTH_SECRET:
      '  SYNTHETIC ONLY $NAME ${NAME:-default} $$ # " \\ café 🫘 \t\n\u0085\u2028\u2029  ',
    BETTER_AUTH_URL: 'https://offline.invalid',
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

test('refuses invalid/missing/extra inputs with fixed diagnostics and no output', () => {
  const temp = mkdtempSync(path.join(tmpdir(), 'cupmemo-prepare-negative-'));
  try {
    const config = path.join(temp, 'input.json'),
      output = path.join(temp, 'app.yml');
    const base = fixture(temp);
    const invalid = [null, [], 'SYNTHETIC_SECRET', { ...base, extra: 'SECRET' }];
    for (const key of Object.keys(base)) {
      const omitted = { ...base };
      delete omitted[key];
      invalid.push(omitted);
      for (const value of ['', ' ', null, 1, {}, ['SECRET'], 'SECRET\0'])
        invalid.push({ ...base, [key]: value });
    }
    for (const key of ['CUPMEMO_WEB_IMAGE', 'CUPMEMO_API_IMAGE', 'CUPMEMO_POSTGRES_IMAGE']) {
      for (const value of ['latest', 'postgres:17', '--option', `sha256:${'A'.repeat(64)}`])
        invalid.push({ ...base, [key]: value });
    }
    for (const value of ['0', '-1', '001', '1.5', '4294967295'])
      invalid.push({ ...base, POSTGRES_DATA_UID: value });
    for (const key of ['POSTGRES_DATA_DIR', 'POSTGRES_PASSWORD_FILE']) {
      for (const value of ['/', './relative', '/a/../b', '/a/', '/a//b', '/a\nb'])
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
    writeFileSync(config, '{SYNTHETIC_SECRET', { mode: 0o600 });
    expect(run(config, output).stderr).toBe('CasaOS app: preparation refused\n');
  } finally {
    rmSync(temp, { recursive: true, force: true });
  }
});

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
