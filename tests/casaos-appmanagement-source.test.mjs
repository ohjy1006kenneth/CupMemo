import { afterAll, beforeAll, expect, test } from 'vitest';
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import process from 'node:process';
import { fileURLToPath, URL } from 'node:url';

const bundle = fileURLToPath(new URL('../infrastructure/casaos-appmanagement/', import.meta.url));
const lock = JSON.parse(fs.readFileSync(path.join(bundle, 'source-lock.json'), 'utf8'));
let root;
let helper;
let env;
function checked(filename, record) {
  const data = fs.readFileSync(filename);
  expect(data.length).toBe(record.bytes);
  expect(createHash('sha256').update(data).digest('hex')).toBe(record.sha256);
  return data;
}
function run(command, args, options = {}) {
  return spawnSync(command, args, {
    cwd: root,
    env,
    encoding: 'utf8',
    timeout: 4000,
    killSignal: 'SIGKILL',
    maxBuffer: 131072,
    shell: false,
    ...options,
  });
}
function ordinary() {
  return {
    name: 'ordinary',
    workingDir: '/synthetic/ordinary',
    composeFiles: ['/synthetic/ordinary/docker-compose.yml'],
    serviceNames: ['ordinary'],
  };
}
function request() {
  return { version: 1, operation: 'apply', current: ordinary(), candidate: null };
}
function cli(input, args = ['--check']) {
  checked(
    helper,
    lock.patched_files.find((r) => r.path === 'service/testdata/syncthing-manager-policy.mjs'),
  );
  return run(process.execPath, [helper, ...args], {
    input: typeof input === 'string' ? input : JSON.stringify(input),
  });
}
function refusal(result, status = 1) {
  expect(result.error).toBeUndefined();
  expect(result.signal).toBeNull();
  expect(result.status).toBe(status);
  expect(result.stdout).toBe('');
  expect(result.stderr).toBe('Syncthing manager policy refused\n');
}
beforeAll(() => {
  const parent = fs.realpathSync(
    process.env.GITHUB_ACTIONS === 'true' ? os.tmpdir() : os.homedir(),
  );
  if (process.env.GITHUB_ACTIONS !== 'true') {
    const mount = spawnSync(
      '/usr/bin/findmnt',
      ['--json', '--target', parent, '--output', 'UUID,FSTYPE'],
      {
        env: { PATH: '/usr/bin:/bin', LANG: 'C' },
        encoding: 'utf8',
        timeout: 2000,
        maxBuffer: 16384,
        shell: false,
      },
    );
    expect(mount.status).toBe(0);
    expect(JSON.parse(mount.stdout).filesystems).toEqual([
      { uuid: '493d6733-2a8b-482b-b39f-a7ecc1ce8863', fstype: 'ext4' },
    ]);
  }
  root = fs.mkdtempSync(path.join(parent, 'cupmemo-appmanagement-source-'));
  env = {
    PATH: '/usr/bin:/bin',
    HOME: root,
    TMPDIR: root,
    LANG: 'C',
    GIT_CONFIG_NOSYSTEM: '1',
    GIT_CONFIG_GLOBAL: '/dev/null',
  };
  checked(path.join(bundle, lock.patch.path), lock.patch);
  for (const record of lock.upstream_files) {
    const destination = path.join(root, record.path);
    fs.mkdirSync(path.dirname(destination), { recursive: true });
    fs.writeFileSync(destination, checked(path.join(bundle, 'upstream', record.path), record), {
      flag: 'wx',
    });
  }
  for (const args of [['apply', '--check'], ['apply']]) {
    const result = run('/usr/bin/git', [...args, path.join(bundle, lock.patch.path)]);
    expect(result.error).toBeUndefined();
    expect(result.status).toBe(0);
  }
  for (const record of lock.patched_files) checked(path.join(root, record.path), record);
  helper = path.join(root, 'service/testdata/syncthing-manager-policy.mjs');
});
afterAll(() => {
  if (root) fs.rmSync(root, { recursive: true, force: true });
});
test('real materializer refuses adversarial archives without execution', () => {
  const result = run('/usr/bin/python3', ['-B', path.join(bundle, 'test_materialize.py')]);
  expect(result.error).toBeUndefined();
  expect(result.status).toBe(0);
  expect(result.stderr).toContain('Ran 5 tests');
  expect(result.stderr).toContain('OK');
});
test('offline original fixtures are minimal, exact and not a runnable manager', () => {
  expect(lock.upstream_files.map((r) => r.path).sort()).toEqual([
    'LICENSE',
    'pkg/docker/auth.go',
    'pkg/docker/digest.go',
    'route/v1/docker.go',
    'route/v2/compose_app.go',
    'route/v2/docker.go',
    'service/compose_app.go',
    'service/compose_service.go',
    'service/container.go',
  ]);
  expect(fs.existsSync(path.join(bundle, 'upstream/go.mod'))).toBe(false);
  expect(lock.module_files.map((r) => r.path)).toEqual(['go.mod', 'go.sum']);
  expect(lock.provenance.original_implementation_run_id).toBe(2817);
});
test('materialized actual helper admits ordinary identity', () => {
  const result = cli(request());
  expect(result.error).toBeUndefined();
  expect(result.status).toBe(0);
  expect(result.stdout).toBe('{"version":1,"allowed":true}\n');
  expect(result.stderr).toBe('');
});
test('strict pull production binding and test-only bridge are distributed exactly', () => {
  const read = (name) => fs.readFileSync(path.join(root, name), 'utf8');
  const staging = read('service/recreation_image.go');
  expect(staging).toContain('pull: docker.PullImageContext');
  expect(staging).toContain('deps.pull(ctx, name, consumeRecreationPull)');
  expect(staging).not.toContain('pullImageProgress');
  expect(read('pkg/docker/recreation_testbridge.go')).toMatch(
    /^\/\/go:build cupmemo_recreation_test\n/,
  );
  expect(read('service/recreation_protocol_test.go')).toContain('docker.RecreationPullTestBridge');
  const hosted = fs.readFileSync(path.join(bundle, 'hosted-build.py'), 'utf8');
  expect(hosted.indexOf('"go", "build"')).toBeGreaterThan(
    hosted.indexOf('record(key + "-test-summary"', hosted.indexOf('"recreate-pkg-docker"')),
  );
  const buildLine = hosted.split('\n').find((line) => line.includes('"go", "build"'));
  expect(buildLine).not.toContain('-tags');
});
for (const side of ['current', 'candidate']) {
  for (const selector of ['name', 'directory', 'compose', 'service']) {
    test(`materialized helper refuses protected ${side} ${selector}`, () => {
      const input = request();
      const identity = ordinary();
      input[side] = identity;
      if (selector === 'name') identity.name = 'LOCAL-SYNCTHING';
      if (selector === 'directory')
        identity.workingDir = '/var/lib/casaos/apps/local-syncthing/subdir';
      if (selector === 'compose')
        identity.composeFiles = ['/var/lib/casaos/apps/local-syncthing/docker-compose.yml'];
      if (selector === 'service') identity.serviceNames = ['big-bear-syncthing'];
      refusal(cli(input));
    });
  }
}
test('component-prefix siblings remain ordinary', () => {
  const input = request();
  input.current.name = 'local-syncthing-extra';
  input.current.workingDir = '/var/lib/casaos/apps/local-syncthing-extra';
  expect(cli(input).status).toBe(0);
});
for (const input of [
  '{}',
  '{"version":1,"version":1}',
  JSON.stringify(request()) + '{}',
  'SECRET-SENTINEL',
  'x'.repeat(65537),
]) {
  test(`strict refusal ${input.length} bytes`, () => refusal(cli(input)));
}
test('unknown operation and unknown properties are refused', () => {
  refusal(cli({ ...request(), operation: 'restart-override' }));
  refusal(cli({ ...request(), secret: 'SECRET-SENTINEL' }));
});
test('invalid CLI is sanitized and shell arguments never execute', () => {
  refusal(cli(request(), ['--check', ';touch SECRET-SENTINEL']), 2);
  expect(fs.existsSync(path.join(root, 'SECRET-SENTINEL'))).toBe(false);
});

for (const operation of [
  'legacy-update',
  'legacy-uninstall',
  'legacy-archive',
  'legacy-terminal',
  'container-recreate',
]) {
  test(`${operation} uses the real shared policy for current and candidate`, () => {
    const input = { ...request(), operation };
    expect(cli(input).status).toBe(0);
    for (const side of ['current', 'candidate']) {
      for (const marker of ['name', 'workingDir', 'composeFiles', 'serviceNames']) {
        input[side] = ordinary();
        if (marker === 'name') input[side].name = 'LOCAL-SYNCTHING';
        if (marker === 'workingDir')
          input[side].workingDir = '/var/lib/casaos/apps/local-syncthing/nested';
        if (marker === 'composeFiles')
          input[side].composeFiles = ['/var/lib/casaos/apps/local-syncthing/docker-compose.yml'];
        if (marker === 'serviceNames') input[side].serviceNames = ['BIG-BEAR-SYNCTHING'];
        refusal(cli(input));
      }
      input[side] = side === 'current' ? ordinary() : null;
    }
    input.current.name = 'local-syncthing-extra';
    input.current.workingDir = '/var/lib/casaos/apps/local-syncthing-extra';
    expect(cli(input).status).toBe(0);
    input.current.serviceNames = ['SECRET-SENTINEL/invalid'];
    refusal(cli(input));
  });
}
