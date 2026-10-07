import { mkdtemp, mkdir, readFile, writeFile, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { inspectMigrationStatus } from '../packages/database/src/status.ts';

const migrationsDir = path.resolve('packages/database/drizzle');
const journal = JSON.parse(await readFile(path.join(migrationsDir, 'meta/_journal.json'), 'utf8'));

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
    expect(result).toEqual({ status: 'pending', applied: 0, total: journal.entries.length });
    expect(statements).toEqual([
      "SELECT to_regclass('drizzle.__drizzle_migrations') AS table_name",
    ]);
    expect(statements.every((sql) => !/CREATE|INSERT|UPDATE|DELETE|DROP/i.test(sql))).toBe(true);
  });

  it('distinguishes applied, mismatched, and ahead migration history', async () => {
    const { createHash } = await import('node:crypto');
    const applied = await Promise.all(
      journal.entries.map(async (entry) => {
        const sql = await readFile(path.join(migrationsDir, `${entry.tag}.sql`), 'utf8');
        return { hash: createHash('sha256').update(sql).digest('hex'), created_at: entry.when };
      }),
    );
    expect(await scenario(applied)).toEqual({
      status: 'current',
      applied: journal.entries.length,
      total: journal.entries.length,
    });
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
