import { expect, test } from 'vitest';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import process from 'node:process';

const script = 'infrastructure/scripts/recovery-drill.py';
test('hosted drill refuses a local execution before Docker or private files', () => {
  expect(fs.existsSync(script)).toBe(true);
  const result = spawnSync('python3', [script], {
    env: { PATH: process.env.PATH },
    encoding: 'utf8',
  });
  expect(result.status).toBe(1);
  expect(result.stdout).toBe('');
  expect(result.stderr).toBe('recovery drill refused: hosted ARM64 only\n');
});

test('cap gate checks effective config and live cgroup, not requested limits', () => {
  const result = spawnSync(
    'python3',
    [
      '-c',
      `
import importlib.util, sys
sys.dont_write_bytecode = True
s = importlib.util.spec_from_file_location('drill', '${script}')
m = importlib.util.module_from_spec(s)
s.loader.exec_module(m)
h = dict(Memory=536870912, MemorySwap=536870912, NanoCpus=1000000000,
         PidsLimit=128, RestartPolicy=dict(Name='no'))
assert m.caps_valid(h, '536870912', '0')
assert not m.caps_valid(h, 'max', '0')
assert not m.caps_valid(h, '536870912', 'max')
assert not m.caps_valid(h, '536870912', '536870912')
for key, value in [('Memory', 0), ('MemorySwap', -1), ('NanoCpus', 0),
                   ('PidsLimit', 0), ('RestartPolicy', dict(Name='always'))]:
    assert not m.caps_valid({**h, key: value}, '536870912', '0')
`,
    ],
    { encoding: 'utf8' },
  );
  expect(result.stderr).toBe('');
  expect(result.status).toBe(0);
});
