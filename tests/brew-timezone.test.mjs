import { execFileSync } from 'node:child_process';
import process from 'node:process';
import { expect, it } from 'vitest';
it('validates actual timezone roundtrips, rejects nonexistent DST and documents native earlier overlap', () => {
  const output = execFileSync(
    process.execPath,
    ['--experimental-strip-types', 'tests/brew-timezone-fixture.mjs'],
    { env: { ...process.env, TZ: 'America/New_York' }, encoding: 'utf8' },
  );
  expect(output).toContain('passed');
});
