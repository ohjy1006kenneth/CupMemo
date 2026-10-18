import { afterAll, beforeAll, expect, test } from 'vitest';
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import process from 'node:process';
import { fileURLToPath, URL } from 'node:url';

const bundle = fileURLToPath(new URL('../infrastructure/casaos-samba/', import.meta.url));
const lock = JSON.parse(fs.readFileSync(path.join(bundle, 'source-lock.json'), 'utf8'));
// Synthetic policy, never copied from the live NAS stanza.
const canonicalNas =
  '[nas]\npath = /DATA/nas\ncomment = synthetic owner policy\nveto files = /cupmemo/\n';
const university =
  '[University]\n  path = /DATA/nas/University\n  guest ok = yes\n  writable = yes\n# ordinary control bytes\n';
let root;
let adapter;
let childEnv;

function checkedBytes(filename, record) {
  const bytes = fs.readFileSync(filename);
  expect(bytes.length).toBe(record.bytes);
  expect(createHash('sha256').update(bytes).digest('hex')).toBe(record.sha256);
  return bytes;
}

function run(command, args, options = {}) {
  return spawnSync(command, args, {
    cwd: root,
    env: childEnv,
    encoding: 'utf8',
    timeout: 4000,
    killSignal: 'SIGKILL',
    maxBuffer: 2 * 1024 * 1024,
    shell: false,
    ...options,
  });
}

function success(result) {
  expect(result.error).toBeUndefined();
  expect(result.signal).toBeNull();
  expect(result.status).toBe(0);
  expect(result.stderr).toBe('');
}

function cli(request, args = ['--transform']) {
  // Recheck executable bytes immediately before consuming the real patched file.
  checkedBytes(
    adapter,
    lock.patched_files.find((file) => file.path === 'service/testdata/samba-policy.mjs'),
  );
  return run(process.execPath, [adapter, ...args], {
    input: typeof request === 'string' ? request : JSON.stringify(request),
  });
}

function transform(generated, extra = {}) {
  const result = cli({ version: 1, canonicalNas, generated, ...extra });
  success(result);
  const response = JSON.parse(result.stdout);
  expect(Object.keys(response).sort()).toEqual(['config', 'version']);
  expect(response.version).toBe(1);
  return response.config;
}

function refusal(result, code, status = 1) {
  expect(result.error).toBeUndefined();
  expect(result.signal).toBeNull();
  expect(result.status).toBe(status);
  expect(result.stdout).toBe('');
  expect(result.stderr).toBe(`${code}\n`);
}

beforeAll(() => {
  // Ignore TMPDIR on the Pi. Hosted temp is ephemeral test storage, not HDD proof.
  const parent = fs.realpathSync(
    process.env.GITHUB_ACTIONS === 'true' ? os.tmpdir() : os.homedir(),
  );
  if (process.env.GITHUB_ACTIONS !== 'true') {
    const mount = spawnSync(
      '/usr/bin/findmnt',
      ['--json', '--target', parent, '--output', 'UUID,FSTYPE'],
      {
        encoding: 'utf8',
        timeout: 2000,
        killSignal: 'SIGKILL',
        maxBuffer: 16384,
        shell: false,
        env: { PATH: '/usr/bin:/bin', LANG: 'C' },
      },
    );
    expect(mount.error).toBeUndefined();
    expect(mount.status).toBe(0);
    expect(JSON.parse(mount.stdout).filesystems).toEqual([
      { uuid: '493d6733-2a8b-482b-b39f-a7ecc1ce8863', fstype: 'ext4' },
    ]);
  }
  root = fs.mkdtempSync(path.join(parent, 'cupmemo-samba-source-'));
  childEnv = {
    PATH: '/usr/bin:/bin',
    HOME: root,
    TMPDIR: root,
    LANG: 'C',
    GIT_CONFIG_NOSYSTEM: '1',
    GIT_CONFIG_GLOBAL: '/dev/null',
  };
  try {
    expect(lock.version).toBe(1);
    expect(lock.patch.sha256).toBe(
      '8b03799aea01572d552506cceae6ed34336f89f02f1a06f1737d5e9738aa4555',
    );
    checkedBytes(path.join(bundle, lock.patch.path), lock.patch);
    for (const record of lock.upstream_files) {
      const bytes = checkedBytes(path.join(bundle, 'upstream', record.path), record);
      const destination = path.join(root, record.path);
      fs.mkdirSync(path.dirname(destination), { recursive: true });
      fs.writeFileSync(destination, bytes, { flag: 'wx' });
    }
    success(run('git', ['init', '--quiet']));
    success(run('git', ['apply', '--check', path.join(bundle, lock.patch.path)]));
    success(run('git', ['apply', path.join(bundle, lock.patch.path)]));
    for (const record of lock.patched_files) checkedBytes(path.join(root, record.path), record);
    adapter = path.join(root, 'service/testdata/samba-policy.mjs');
  } catch (error) {
    fs.rmSync(root, { recursive: true, force: true });
    root = undefined;
    throw error;
  }
});

afterAll(() => {
  if (root) fs.rmSync(root, { recursive: true, force: true });
});

test('published patch produces all five locked outputs, not a second adapter copy', () => {
  expect(lock.patched_files).toHaveLength(5);
  for (const record of lock.patched_files) checkedBytes(path.join(root, record.path), record);
  expect(fs.existsSync(path.join(bundle, 'samba-policy.mjs'))).toBe(false);
});

test('zero rows retain canonical nas and repeated private generation is idempotent', () => {
  const first = transform('');
  expect(first).toBe(canonicalNas);
  expect(transform(first)).toBe(first);
});

test('ordinary University bytes and preamble survive append and replacement', () => {
  const generated = `# synthetic preamble\n${university}`;
  const first = transform(generated);
  expect(first).toBe(generated + canonicalNas);
  expect(transform(first)).toBe(first);
  expect(transform(`[nas]\npath = /DATA/nas\n${university}`)).toBe(canonicalNas + university);
});

test.each(['create', 'delete', 'delete-by-path'])(
  'protected %s mutations refuse before config transport',
  (operation) => {
    refusal(
      cli({
        version: 1,
        canonicalNas,
        generated: university,
        mutations: [{ operation, name: 'nas', path: '/DATA/nas' }],
      }),
      'MUTATION_PROTECTED',
    );
  },
);

test.each(['/', '/DATA', '/DATA/nas', '/DATA/nas/cupmemo', '/DATA/nas/cupmemo/postgres'])(
  'direct reserved/ancestor path %s refuses',
  (protectedPath) => {
    refusal(
      cli({ version: 1, canonicalNas, generated: `[Other]\npath = ${protectedPath}\n` }),
      'SHARE_CONFLICT',
    );
    refusal(
      cli({
        version: 1,
        canonicalNas,
        generated: '',
        mutations: [{ operation: 'delete-by-path', name: 'Other', path: protectedPath }],
      }),
      'MUTATION_PROTECTED',
    );
  },
);

test.each(['/DATA/nas-other', '/DATA/nas/cupmemo-other', '/DATA/nas/University'])(
  'component prefix sibling %s stays ordinary',
  (ordinaryPath) => {
    const generated = `[Control]\npath = ${ordinaryPath}\n`;
    expect(
      transform(generated, {
        mutations: [{ operation: 'create', name: 'Control', path: ordinaryPath }],
      }),
    ).toBe(generated + canonicalNas);
  },
);

test.each([
  ['[nas]\npath = /other\n', 'SHARE_CONFLICT'],
  ['[nas]\npath = /DATA/nas\nveto files = /different/\n', 'SHARE_CONFLICT'],
  ['[NAS]\npath = /DATA/nas\n', 'POLICY_INVALID'],
  [`${university}${university}`, 'POLICY_INVALID'],
  ['[Control]\npath = /ordinary\ninclude = /private-canary\n', 'POLICY_INVALID'],
  ['[Control]\npath = /ordinary\npath = /duplicate\n', 'POLICY_INVALID'],
])('conflicting or ambiguous generated input refuses (%s)', (generated, code) => {
  refusal(cli({ version: 1, canonicalNas, generated }), code);
});

test('invalid canonical and protocol emit only fixed diagnostics with empty stdout', () => {
  refusal(
    cli({ version: 1, canonicalNas: '[nas]\npath = /DATA/nas\n', generated: university }),
    'CANONICAL_INVALID',
  );
  refusal(
    cli({ version: 1, canonicalNas, generated: university, privateCanary: 'do-not-echo' }),
    'PROTOCOL_INVALID',
  );
  refusal(cli('private-canary-not-json'), 'PROTOCOL_INVALID');
  refusal(cli('', []), 'CLI_INVALID', 2);
  refusal(cli('', ['--transform', 'private-canary']), 'CLI_INVALID', 2);
});
