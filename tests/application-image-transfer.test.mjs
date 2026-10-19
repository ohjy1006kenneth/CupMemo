import { describe, expect, it } from 'vitest';
import { spawnSync } from 'node:child_process';
import { fileURLToPath, URL } from 'node:url';

// Execute the same standard-library validator that CI uses on real Docker-save
// bytes. Fixtures are disposable and never call Docker, load images or start DBs.
describe('application image transfer', () => {
  it('checks two-image identity and refuses corrupt/unsafe archive fixtures', () => {
    const result = spawnSync(
      'python3',
      [
        '-B',
        '-m',
        'unittest',
        'discover',
        '-s',
        'tests',
        '-p',
        'test_application_image_transfer.py',
        '-v',
      ],
      {
        cwd: fileURLToPath(new URL('../', import.meta.url)),
        encoding: 'utf8',
        timeout: 30000,
      },
    );
    expect(result.error).toBeUndefined();
    expect(result.status, result.stdout + result.stderr).toBe(0);
    expect(result.stderr).toMatch(/Ran \d+ tests/);
    expect(result.stderr).toContain('OK');
  });
});
