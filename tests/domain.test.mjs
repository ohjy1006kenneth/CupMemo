import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import process from 'node:process';
import { describe, it } from 'vitest';
import { getTableConfig } from '../packages/database/node_modules/drizzle-orm/pg-core/index.js';
import * as schema from '../packages/database/src/schema.ts';

describe('private domain schema', () => {
  it('refuses missing, legacy, production and unsafe integration configuration before pool activity', () => {
    const valid = {
      CUPMEMO_DB_ENV: 'test',
      CUPMEMO_TEST_DATABASE: 'cupmemo_test_guard',
      CUPMEMO_DATABASE_URL_TEST:
        'postgresql://fixture:secret-sentinel@127.0.0.1:1/cupmemo_test_guard',
    };
    const cases = [
      {},
      { ...valid, DATABASE_URL: 'secret-sentinel' },
      { ...valid, NODE_ENV: 'production' },
      {
        ...valid,
        CUPMEMO_DB_ENV: 'production',
        CUPMEMO_DATABASE_URL_PRODUCTION:
          'postgresql://fixture:secret-sentinel@127.0.0.1:1/production',
      },
      { ...valid, CUPMEMO_TEST_DATABASE: 'wrong' },
      {
        ...valid,
        CUPMEMO_DATABASE_URL_TEST:
          'postgresql://fixture:secret-sentinel@192.0.2.1/cupmemo_test_guard',
      },
    ];
    for (const env of cases) {
      const result = spawnSync(
        process.execPath,
        ['packages/database/scripts/domain-integration.mjs'],
        { env, encoding: 'utf8', timeout: 10000 },
      );
      assert.equal(result.status, 1);
      assert.equal(result.stderr, 'Domain integration failed at: guarded configuration.\n');
      assert.equal(result.stdout, '');
      assert.ok(!result.stderr.includes('secret-sentinel'));
    }
  }, 20000);
  it('keys incremental pours and descriptors by their cascading parent', () => {
    for (const [name, keys] of [
      ['brewPours', ['brew_id', 'position']],
      ['coffeeTastingNotes', ['coffee_id', 'note']],
      ['brewTastingTags', ['brew_id', 'tag']],
    ]) {
      assert.ok(schema[name], `${name} table is exported`);
      const table = getTableConfig(schema[name]);
      assert.deepEqual(
        table.primaryKeys[0].columns.map((column) => column.name),
        keys,
      );
      assert.equal(table.foreignKeys[0].onDelete, 'cascade');
    }
    assert.equal(schema.brewPours.waterGrams.getSQLType(), 'numeric(7, 2)');
    assert.ok(!Object.hasOwn(schema.brewPours, 'id'));
  });
  it('binds recipes to the same owner and keeps assessment nullable and scalar', () => {
    assert.ok(schema.brews, 'brews table is exported');
    const table = getTableConfig(schema.brews);
    const ownership = table.foreignKeys.find((key) => key.reference().columns.length === 2);
    assert.deepEqual(
      ownership.reference().columns.map((column) => column.name),
      ['coffee_id', 'owner_id'],
    );
    assert.equal(ownership.onDelete, 'no action');
    assert.equal(schema.brews.grindSetting.getSQLType(), 'text');
    assert.equal(schema.brews.overallScore.getSQLType(), 'numeric(5, 2)');
    assert.equal(schema.brews.acidity.notNull, false);
    assert.equal(schema.brews.acidity.hasDefault, false);
    assert.equal(schema.brews.brewedAt.hasDefault, false);
  });
  it('exports a private UUID coffee with nullable metadata and required identity', () => {
    assert.ok(schema.coffees, 'coffees table is exported');
    const table = getTableConfig(schema.coffees);
    assert.equal(table.schema, 'cupmemo');
    const columns = Object.fromEntries(table.columns.map((column) => [column.name, column]));
    assert.equal(columns.id.getSQLType(), 'uuid');
    assert.equal(columns.name.notNull, true);
    assert.equal(columns.roaster.notNull, true);
    assert.equal(columns.elevation.getSQLType(), 'text');
    assert.equal(columns.country.notNull, false);
    assert.equal(columns.created_at.getSQLType(), 'timestamp with time zone');
    assert.equal(table.foreignKeys[0].onDelete, 'cascade');
  });
});
