import { mkdtemp, mkdir, readFile, writeFile, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { inspectMigrationStatus } from '../packages/database/src/status.ts';

const migrationsDir = path.resolve('packages/database/drizzle');

async function scenario(history) {
  return inspectMigrationStatus(async (sql) => {
    if (sql.includes('to_regclass')) {
      return {
        rows: history === null ? [{ table_name: null }] : [{ table_name: '__drizzle_migrations' }],
      };
    }
    return { rows: history };
  }, migrationsDir);
}

describe('read-only migration status', () => {
  it('reports absent journal as pending without executing any mutation', async () => {
    const statements = [];
    const result = await inspectMigrationStatus(async (sql) => {
      statements.push(sql);
      return { rows: [{ table_name: null }] };
    }, migrationsDir);
    expect(result).toEqual({ status: 'pending', applied: 0, total: 1 });
    expect(statements).toEqual([
      "SELECT to_regclass('drizzle.__drizzle_migrations') AS table_name",
    ]);
    expect(statements.every((sql) => !/CREATE|INSERT|UPDATE|DELETE|DROP/i.test(sql))).toBe(true);
  });

  it('distinguishes applied, mismatched, and ahead migration history', async () => {
    const journal = JSON.parse(
      await readFile(path.join(migrationsDir, 'meta/_journal.json'), 'utf8'),
    );
    const sql = await readFile(path.join(migrationsDir, `${journal.entries[0].tag}.sql`), 'utf8');
    const { createHash } = await import('node:crypto');
    const applied = [
      { hash: createHash('sha256').update(sql).digest('hex'), created_at: journal.entries[0].when },
    ];
    expect(await scenario(applied)).toEqual({ status: 'current', applied: 1, total: 1 });
    expect((await scenario([{ ...applied[0], hash: 'wrong' }])).status).toBe('mismatch');
    expect((await scenario([...applied, applied[0]])).status).toBe('mismatch');
  });

  it('fails on an unjournaled or missing migration file', async () => {
    const temp = await mkdtemp(path.join(os.tmpdir(), 'cupmemo-migrations-'));
    try {
      await mkdir(path.join(temp, 'meta'));
      await writeFile(path.join(temp, 'meta/_journal.json'), JSON.stringify({ entries: [] }));
      await writeFile(path.join(temp, 'extra.sql'), 'SELECT 1;');
      await expect(inspectMigrationStatus(async () => ({ rows: [] }), temp)).rejects.toThrow();
    } finally {
      await rm(temp, { recursive: true, force: true });
    }
  });
});
