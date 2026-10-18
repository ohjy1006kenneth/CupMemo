import { expect, test } from 'vitest';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import process from 'node:process';

const flags = [
  '-std=c17',
  '-O2',
  '-Wall',
  '-Wextra',
  '-Werror',
  '-Wformat=2',
  '-Wconversion',
  '-Wshadow',
  '-D_FORTIFY_SOURCE=3',
  '-fstack-protector-strong',
  '-fPIE',
  '-pie',
  '-Wl,-z,relro,-z,now',
];
test('native strict parser tests and actual binary redacted CLI/config refusal', () => {
  const temp = mkdtempSync(path.join(tmpdir(), 'cupmemo-native-gate-'));
  try {
    for (const [name, source] of [
      ['unit', 'tests/postgres-hdd-entrypoint-unit.c'],
      ['gate', 'infrastructure/casaos/postgres-hdd-entrypoint.c'],
    ]) {
      const compile = spawnSync('cc', [...flags, source, '-o', path.join(temp, name)], {
        encoding: 'utf8',
        timeout: 30000,
      });
      expect(compile.status, compile.stderr).toBe(0);
    }
    const unit = spawnSync(path.join(temp, 'unit'), [], { encoding: 'utf8', timeout: 5000 });
    expect(unit.status, unit.stderr).toBe(0);
    expect(unit.stdout).toContain('PASS strict UUID/path');
    for (const argv of [
      [],
      ['--check'],
      ['postgres'],
      ['sh', '-c', 'echo SECRET'],
      ['postgres', '-c', 'data_directory=/tmp'],
    ]) {
      const result = spawnSync(path.join(temp, 'gate'), argv, {
        encoding: 'utf8',
        timeout: 5000,
        env: { PATH: process.env.PATH, POSTGRES_PASSWORD: 'SECRET' },
      });
      expect(result.status).toBe(1);
      expect(result.stdout).toBe('');
      expect(result.stderr).toBe('CupMemo PostgreSQL: storage admission refused\n');
    }
  } finally {
    rmSync(temp, { recursive: true, force: true });
  }
});
