// Production-wired read-only PG17 boundary. Never restores or migrates.
import { createDatabase } from '../../packages/database/dist/index.js';
import { inspectMigrationStatus } from '../../packages/database/dist/status.js';
import {
  tableNames,
  canonicalCatalog,
  sha256,
  decimal,
  refuse,
} from './postgres-restore-oracle.mjs';

const userNamespace = "n.nspname NOT IN ('pg_catalog','information_schema','pg_toast')";
const applicationNamespace = "n.nspname IN ('public','cupmemo','drizzle')";
const identitySQL = `/* restore:identity */
SELECT pg_catalog.current_setting('server_version_num') AS version,
 pg_catalog.current_database() AS database, current_user AS username,
 pg_catalog.host(pg_catalog.inet_server_addr()) AS address, pg_catalog.inet_server_port() AS port,
 d.datdba = r.oid AS owner,
 (NOT r.rolsuper AND NOT r.rolcreatedb AND NOT r.rolcreaterole AND NOT r.rolreplication
 AND NOT r.rolbypassrls AND r.rolcanlogin AND NOT EXISTS
 (SELECT 1 FROM pg_catalog.pg_auth_members m WHERE m.member = r.oid)) AS safe_role
FROM pg_catalog.pg_database d JOIN pg_catalog.pg_roles r ON r.rolname = current_user
WHERE d.datname = pg_catalog.current_database()`;

// No information_schema privilege-filtered views: inaccessible/unknown catalog
// state must not masquerade as an empty database. All SQL is fixed, not oracle SQL.
const inventorySQL = `/* restore:inventory */ SELECT
 ARRAY(SELECT nspname::text FROM pg_catalog.pg_namespace n WHERE ${userNamespace} ORDER BY nspname COLLATE "C") AS schemas,
 ARRAY(SELECT extname::text FROM pg_catalog.pg_extension ORDER BY extname COLLATE "C") AS extensions,
 (SELECT count(*)::text FROM pg_catalog.pg_class c JOIN pg_catalog.pg_namespace n ON n.oid=c.relnamespace WHERE ${userNamespace}) AS relations,
 COALESCE((SELECT pg_catalog.json_agg(pg_catalog.json_build_array(n.nspname,c.relname,
   c.relname='__drizzle_migrations_id_seq' AND n.nspname='drizzle' AND c.relpersistence='p'
   AND EXISTS (SELECT 1 FROM pg_catalog.pg_sequence s WHERE s.seqrelid=c.oid
     AND s.seqtypid='pg_catalog.int4'::pg_catalog.regtype AND s.seqstart=1 AND s.seqincrement=1
     AND s.seqmin=1 AND s.seqmax=2147483647 AND s.seqcache=1 AND NOT s.seqcycle)
   AND EXISTS (SELECT 1 FROM pg_catalog.pg_depend dep
     JOIN pg_catalog.pg_class t ON t.oid=dep.refobjid
     JOIN pg_catalog.pg_namespace tn ON tn.oid=t.relnamespace
     JOIN pg_catalog.pg_attribute a ON a.attrelid=t.oid AND a.attnum=dep.refobjsubid
     WHERE dep.classid='pg_catalog.pg_class'::pg_catalog.regclass AND dep.objid=c.oid
     AND dep.refclassid='pg_catalog.pg_class'::pg_catalog.regclass AND dep.deptype='a'
     AND tn.nspname='drizzle' AND t.relname='__drizzle_migrations' AND a.attname='id')))
 FROM pg_catalog.pg_class c JOIN pg_catalog.pg_namespace n ON n.oid=c.relnamespace
 WHERE ${userNamespace} AND c.relkind='S'), '[]'::pg_catalog.json) AS sequences,
 ((SELECT count(*) FROM pg_catalog.pg_proc p JOIN pg_catalog.pg_namespace n ON n.oid=p.pronamespace WHERE ${userNamespace}) +
 (SELECT count(*) FROM pg_catalog.pg_class c JOIN pg_catalog.pg_namespace n ON n.oid=c.relnamespace WHERE ${userNamespace} AND c.relkind NOT IN ('r','i','S')) +
 (SELECT count(*) FROM pg_catalog.pg_trigger t JOIN pg_catalog.pg_class c ON c.oid=t.tgrelid JOIN pg_catalog.pg_namespace n ON n.oid=c.relnamespace WHERE ${userNamespace} AND NOT t.tgisinternal) +
 (SELECT count(*) FROM pg_catalog.pg_rewrite rw JOIN pg_catalog.pg_class c ON c.oid=rw.ev_class JOIN pg_catalog.pg_namespace n ON n.oid=c.relnamespace WHERE ${userNamespace}) +
 (SELECT count(*) FROM pg_catalog.pg_inherits) +
 (SELECT count(*) FROM pg_catalog.pg_ts_config o JOIN pg_catalog.pg_namespace n ON n.oid=o.cfgnamespace WHERE ${userNamespace}) +
 (SELECT count(*) FROM pg_catalog.pg_ts_dict o JOIN pg_catalog.pg_namespace n ON n.oid=o.dictnamespace WHERE ${userNamespace}) +
 (SELECT count(*) FROM pg_catalog.pg_ts_parser o JOIN pg_catalog.pg_namespace n ON n.oid=o.prsnamespace WHERE ${userNamespace}) +
 (SELECT count(*) FROM pg_catalog.pg_ts_template o JOIN pg_catalog.pg_namespace n ON n.oid=o.tmplnamespace WHERE ${userNamespace}) +
 (SELECT count(*) FROM pg_catalog.pg_policy) +
 (SELECT count(*) FROM pg_catalog.pg_event_trigger) +
 (SELECT count(*) FROM pg_catalog.pg_foreign_server) +
 (SELECT count(*) FROM pg_catalog.pg_publication) +
 (SELECT count(s.oid) FROM pg_catalog.pg_subscription s JOIN pg_catalog.pg_database d ON s.subdbid=d.oid WHERE d.datname=pg_catalog.current_database()) +
 (SELECT count(*) FROM pg_catalog.pg_type t JOIN pg_catalog.pg_namespace n ON n.oid=t.typnamespace WHERE ${userNamespace} AND t.typrelid=0 AND t.typelem=0) +
 (SELECT count(*) FROM pg_catalog.pg_operator o JOIN pg_catalog.pg_namespace n ON n.oid=o.oprnamespace WHERE ${userNamespace}) +
 (SELECT count(*) FROM pg_catalog.pg_collation o JOIN pg_catalog.pg_namespace n ON n.oid=o.collnamespace WHERE ${userNamespace}) +
 (SELECT count(*) FROM pg_catalog.pg_conversion o JOIN pg_catalog.pg_namespace n ON n.oid=o.connamespace WHERE ${userNamespace}))::text AS unsupported`;

const fromRelations = `FROM pg_catalog.pg_class c JOIN pg_catalog.pg_namespace n ON n.oid=c.relnamespace`;
const catalogSQL = {
  tables: `SELECT pg_catalog.json_build_array(n.nspname,c.relname,c.relkind,c.relpersistence,c.relrowsecurity,c.relforcerowsecurity) AS tuple ${fromRelations} WHERE ${applicationNamespace} AND c.relkind NOT IN ('i','S') LIMIT 4097`,
  columns: `SELECT pg_catalog.json_build_array(n.nspname,c.relname,a.attnum,a.attname,pg_catalog.format_type(a.atttypid,a.atttypmod),a.attnotnull,pg_catalog.pg_get_expr(d.adbin,d.adrelid),a.attidentity,a.attgenerated) AS tuple ${fromRelations} JOIN pg_catalog.pg_attribute a ON a.attrelid=c.oid LEFT JOIN pg_catalog.pg_attrdef d ON d.adrelid=c.oid AND d.adnum=a.attnum WHERE ${applicationNamespace} AND c.relkind='r' AND a.attnum>0 AND NOT a.attisdropped LIMIT 4097`,
  constraints: `SELECT pg_catalog.json_build_array(n.nspname,c.relname,k.conname,k.contype,pg_catalog.pg_get_constraintdef(k.oid,true),k.convalidated,k.condeferrable,k.condeferred) AS tuple ${fromRelations} JOIN pg_catalog.pg_constraint k ON k.conrelid=c.oid WHERE ${applicationNamespace} LIMIT 4097`,
  indexes: `SELECT pg_catalog.json_build_array(n.nspname,c.relname,ic.relname,pg_catalog.pg_get_indexdef(i.indexrelid),i.indisunique,i.indisprimary,i.indisvalid,i.indisready) AS tuple ${fromRelations} JOIN pg_catalog.pg_index i ON i.indrelid=c.oid JOIN pg_catalog.pg_class ic ON ic.oid=i.indexrelid WHERE ${applicationNamespace} LIMIT 4097`,
};
const relationships = [
  ['public.account', 'public.user', 'child.user_id = parent.id'],
  ['public.session', 'public.user', 'child.user_id = parent.id'],
  ['cupmemo.coffees', 'public.user', 'child.owner_id = parent.id'],
  ['cupmemo.brews', 'public.user', 'child.owner_id = parent.id'],
  [
    'cupmemo.brews',
    'cupmemo.coffees',
    'child.coffee_id = parent.id AND child.owner_id = parent.owner_id',
  ],
  ['cupmemo.brew_pours', 'cupmemo.brews', 'child.brew_id = parent.id'],
  ['cupmemo.coffee_tasting_notes', 'cupmemo.coffees', 'child.coffee_id = parent.id'],
  ['cupmemo.brew_tasting_tags', 'cupmemo.brews', 'child.brew_id = parent.id'],
];
const identifier = (name) =>
  name
    .split('.')
    .map((s) => `"${s}"`)
    .join('.');
async function one(query, sql) {
  const { rows } = await query(sql);
  if (rows.length !== 1) refuse();
  return rows[0];
}
async function snapshot(query, work) {
  await query('BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY');
  try {
    await query('SET LOCAL search_path = pg_catalog');
    await query("SET LOCAL statement_timeout = '10000ms'");
    await query("SET LOCAL lock_timeout = '2000ms'");
    await query('SET LOCAL row_security = off');
    return await work();
  } finally {
    await query('ROLLBACK');
  }
}
async function identity(query, expected) {
  const r = await one(query, identitySQL);
  if (
    !/^17[0-9]{4}$/.test(r.version) ||
    r.database !== expected.database ||
    r.username !== expected.username ||
    r.port !== expected.port ||
    !['127.0.0.1', '::1'].includes(r.address) ||
    r.owner !== true ||
    r.safe_role !== true
  )
    refuse();
  if (expected.address !== 'localhost' && r.address !== expected.address) refuse();
}
async function inventory(query, empty) {
  const r = await one(query, inventorySQL);
  if (
    r.unsupported !== '0' ||
    JSON.stringify(r.extensions) !== '["plpgsql"]' ||
    !Array.isArray(r.schemas) ||
    !Array.isArray(r.sequences)
  )
    refuse();
  const schemas = [...r.schemas].sort().join(',');
  if (schemas !== (empty ? 'public' : 'cupmemo,drizzle,public')) refuse();
  if (empty) {
    if (r.relations !== '0' || r.sequences.length) refuse();
  } else if (JSON.stringify(r.sequences) !== '[["drizzle","__drizzle_migrations_id_seq",true]]')
    refuse();
}
export async function preflight(query, expected) {
  return snapshot(query, async () => {
    await identity(query, expected);
    await inventory(query, true);
  });
}
export async function verifyRestored(query, expected, oracle, directory) {
  return snapshot(query, async () => {
    await identity(query, expected);
    await inventory(query, false);
    const c = { version: 2 };
    for (const [key, sql] of Object.entries(catalogSQL))
      c[key] = (await query(`/* restore:catalog:${key} */ ${sql}`)).rows.map((r) => r.tuple);
    if (sha256(canonicalCatalog(c)) !== oracle.catalogSha256) refuse();
    const history = await inspectMigrationStatus(query, directory);
    if (history.status !== 'current' || history.applied !== 3 || history.total !== 3) refuse();
    for (const name of tableNames) {
      const r = await one(
        query,
        `/* restore:count:${name} */ SELECT count(*)::text AS count FROM ${identifier(name)}`,
      );
      if (decimal(r.count) !== oracle.rowCounts[name]) refuse();
    }
    for (const [index, [child, parent, predicate]] of relationships.entries()) {
      const r = await one(
        query,
        `/* restore:orphan:${index} */ SELECT count(*)::text AS count FROM ${identifier(child)} child WHERE NOT EXISTS (SELECT 1 FROM ${identifier(parent)} parent WHERE ${predicate})`,
      );
      if (r.count !== '0') refuse();
    }
    return { tablesCompared: 10, relationshipsCompared: 8 };
  });
}

// One checked-out client keeps BEGIN/SET/queries on the SAME connection, not
// pool.query's potentially different clients. No connection before explicit call.
export async function connectTarget(config) {
  const connection = createDatabase(config.databaseUrl, {
    max: 1,
    connectionTimeoutMillis: 10000,
    query_timeout: 10000,
    statement_timeout: 10000,
    idle_in_transaction_session_timeout: 15000,
    application_name: 'cupmemo-restore-check',
  });
  try {
    const client = await connection.pool.connect();
    return {
      query: (sql) => client.query(sql),
      close: async () => {
        client.release(true);
        await connection.close();
      },
    };
  } catch {
    await connection.close();
    refuse();
  }
}
