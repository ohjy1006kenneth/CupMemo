import { expect, test } from 'vitest';
import { spawnSync } from 'node:child_process';
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import process from 'node:process';
import { fileURLToPath, URL } from 'node:url';

const root = fileURLToPath(new URL('../', import.meta.url));

function offlineModel(relativePath) {
  const temp = mkdtempSync(path.join(tmpdir(), 'cupmemo-casaos-static-'));
  try {
    writeFileSync(path.join(temp, 'empty.env'), '');
    const result = spawnSync(
      'docker',
      [
        'compose',
        '--env-file',
        path.join(temp, 'empty.env'),
        '-p',
        'cupmemo-metadata-test',
        '-f',
        path.join(root, relativePath),
        'config',
        '--no-interpolate',
        '--no-env-resolution',
        '--no-path-resolution',
        '--format',
        'json',
      ],
      {
        cwd: temp,
        env: {
          PATH: process.env.PATH,
          HOME: temp,
          DOCKER_HOST: `unix://${temp}/absent.sock`,
        },
        encoding: 'utf8',
        timeout: 10000,
        maxBuffer: 1024 * 1024,
      },
    );
    expect(result.error).toBeUndefined();
    expect(result.status, result.stderr).toBe(0);
    return JSON.parse(result.stdout);
  } finally {
    rmSync(temp, { recursive: true, force: true });
  }
}

test('stock app preserves the complete production runtime model, without hooks or new mounts', () => {
  const base = offlineModel('infrastructure/docker/production.compose.yml');
  const app = offlineModel('infrastructure/casaos/docker-compose.yml');
  const { 'x-casaos': metadata, ...runtime } = app;
  expect(runtime).toEqual(base);
  expect(metadata).toMatchObject({
    id: 'io.github.ohjy1006kenneth.cupmemo',
    main: 'cupmemo-web',
    architectures: ['arm64'],
    title: { en_US: 'CupMemo' },
    version: '0.1.0',
  });
  expect(app.services[metadata.main]).toBeDefined();
  expect(metadata.port_map).toBeUndefined();
  expect(metadata.tips.before_install.en_US).toContain('Do not install/start yet');
});

test('retires all active custom-manager bundles and their dedicated build/test lane', () => {
  for (const relativePath of [
    'infrastructure/casaos-samba',
    'infrastructure/casaos-appmanagement',
    '.github/workflows/appmanagement-guard.yml',
    'tests/casaos-samba-source.test.mjs',
    'tests/casaos-appmanagement-source.test.mjs',
  ]) {
    // Empty local directories left by editing are not source bundles.
    const result = spawnSync('git', ['ls-files', '--', relativePath], {
      cwd: root,
      encoding: 'utf8',
      timeout: 5000,
    });
    expect(result.status).toBe(0);
    for (const file of result.stdout.trim().split('\n').filter(Boolean)) {
      expect(existsSync(path.join(root, file)), file).toBe(false);
    }
  }
  for (const relativePath of [
    'infrastructure/scripts/postgres-hdd-guard.mjs',
    'infrastructure/scripts/private-stack-start.mjs',
    'infrastructure/docker/production.compose.yml',
  ]) {
    expect(existsSync(path.join(root, relativePath))).toBe(true);
  }
});

test('documents stock ownership, importer limitations and accepted sharing without launch claims', () => {
  const docs = readFileSync(path.join(root, 'docs/PRIVATE_COMPOSE.md'), 'utf8');
  for (const phrase of [
    'stock CasaOS',
    'single lifecycle owner',
    'format: raw',
    'v1.20.2',
    'UNVERIFIED',
    'file sharing',
    'Tailscale',
    'not importable unchanged',
  ]) {
    expect(docs).toContain(phrase);
  }
  const deployment = readFileSync(path.join(root, 'docs/DEPLOYMENT.md'), 'utf8');
  expect(deployment).not.toMatch(/\.\.\/infrastructure\/casaos-(samba|appmanagement)/);
});
