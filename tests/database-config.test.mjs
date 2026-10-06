import assert from 'node:assert/strict';
import { describe, it } from 'vitest';
import { resolveDatabaseConfig } from '../packages/database/src/config.ts';

const secret = 'never-print-this-password';
const url = (name, host = '127.0.0.1', port = 5432) =>
  `postgresql://cupmemo:${secret}@${host}:${port}/${name}?sslmode=disable`;
const base = (mode, selectedUrl, extra = {}) => ({
  CUPMEMO_DB_ENV: mode,
  [`CUPMEMO_DATABASE_URL_${mode.toUpperCase()}`]: selectedUrl,
  ...extra,
});

function rejected(env, expression) {
  assert.throws(
    () => resolveDatabaseConfig(env),
    (error) => {
      assert.match(error.message, expression);
      assert.ok(!error.message.includes(secret));
      return true;
    },
  );
}

describe('database environment configuration', () => {
  it('resolves dedicated development, test, and production URLs without connecting', () => {
    assert.deepEqual(resolveDatabaseConfig(base('development', url('cupmemo_dev'))), {
      environment: 'development',
      databaseUrl: url('cupmemo_dev'),
      databaseName: 'cupmemo_dev',
      hostname: '127.0.0.1',
      port: 5432,
    });
    const testName = 'cupmemo_test_task_123';
    assert.equal(
      resolveDatabaseConfig(
        base('test', url(testName), {
          CUPMEMO_TEST_DATABASE: testName,
        }),
      ).databaseName,
      testName,
    );
    assert.equal(
      resolveDatabaseConfig(base('production', url('cupmemo_live', 'db.internal'))).environment,
      'production',
    );
  });

  it('requires an exact explicit mode and its own URL', () => {
    rejected({}, /CUPMEMO_DB_ENV/);
    rejected({ CUPMEMO_DB_ENV: 'staging' }, /CUPMEMO_DB_ENV/);
    rejected({ CUPMEMO_DB_ENV: 'test' }, /CUPMEMO_DATABASE_URL_TEST/);
    rejected(
      { DATABASE_URL: url('cupmemo_dev'), ...base('development', url('cupmemo_dev')) },
      /Legacy/,
    );
  });

  it('rejects invalid URLs, missing database names, and ambiguous environment combinations', () => {
    rejected(base('development', 'mysql://host/cupmemo_dev'), /PostgreSQL/);
    rejected(base('development', 'postgresql://localhost/'), /database name/);
    rejected(
      {
        ...base('test', url('cupmemo_test_task')),
        CUPMEMO_TEST_DATABASE: 'cupmemo_test_task',
        NODE_ENV: 'production',
      },
      /Production NODE_ENV/,
    );
  });

  it('enforces database names, matching test identity, and loopback-only test URLs', () => {
    rejected(base('development', url('other')), /cupmemo_dev/);
    rejected(
      base('test', url('cupmemo_dev'), { CUPMEMO_TEST_DATABASE: 'cupmemo_test_task' }),
      /CUPMEMO_TEST_DATABASE/,
    );
    rejected(
      base('test', url('cupmemo_test_task', 'remote.internal'), {
        CUPMEMO_TEST_DATABASE: 'cupmemo_test_task',
      }),
      /loopback/,
    );
    assert.equal(
      resolveDatabaseConfig({
        ...base('test', url('cupmemo_test_ipv6', '[::1]')),
        CUPMEMO_TEST_DATABASE: 'cupmemo_test_ipv6',
      }).hostname,
      '[::1]',
    );
    rejected(base('production', url('cupmemo_test_task', 'db.internal')), /development or test/);
  });

  it('detects encoded-name bypasses and reused cross-mode targets independent of credentials', () => {
    rejected(
      base('test', url('cupmemo_test_task%2Fother'), {
        CUPMEMO_TEST_DATABASE: 'cupmemo_test_task/other',
      }),
      /database name/,
    );
    rejected(
      {
        ...base('development', url('cupmemo_dev', 'localhost')),
        CUPMEMO_DATABASE_URL_TEST:
          'postgresql://different:another-secret@LOCALHOST:5432/cupmemo_dev',
        CUPMEMO_TEST_DATABASE: 'cupmemo_dev',
      },
      /reused/,
    );
    rejected(
      {
        ...base('development', url('cupmemo_dev')),
        CUPMEMO_DATABASE_URL_PRODUCTION: url('cupmemo_dev', '127.0.0.1', 5432),
      },
      /reused/,
    );
  });
});
