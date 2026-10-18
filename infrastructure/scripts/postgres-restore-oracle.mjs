// Bounded restore oracle v2. Pure validation; import never performs I/O.
import { createHash } from 'node:crypto';
import { Buffer } from 'node:buffer';

export const tableNames = Object.freeze([
  'public.user',
  'public.account',
  'public.session',
  'public.verification',
  'cupmemo.coffees',
  'cupmemo.brews',
  'cupmemo.brew_pours',
  'cupmemo.coffee_tasting_notes',
  'cupmemo.brew_tasting_tags',
  'drizzle.__drizzle_migrations',
]);
export const sha256 = (bytes) => createHash('sha256').update(bytes).digest('hex');
export const refuse = () => {
  throw new Error('restore refused');
};
export const hex = (s, length) =>
  typeof s === 'string' && new RegExp(`^[0-9a-f]{${length}}$`).test(s);
export function exactKeys(o, names) {
  if (
    !o ||
    typeof o !== 'object' ||
    Array.isArray(o) ||
    Object.keys(o).sort().join(',') !== [...names].sort().join(',')
  )
    refuse();
}
export function timestamp(s) {
  if (
    typeof s !== 'string' ||
    !/^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d\.\d{3}Z$/.test(s) ||
    new Date(s).toISOString() !== s
  )
    refuse();
}
export function decimal(s) {
  if (
    typeof s !== 'string' ||
    !/^(0|[1-9][0-9]{0,19})$/.test(s) ||
    BigInt(s) > 18446744073709551615n
  )
    refuse();
  return s;
}
export function parseExpectations(bytes, expectedHash, binding) {
  if (Buffer.byteLength(bytes) > 262144 || !hex(expectedHash, 64) || sha256(bytes) !== expectedHash)
    refuse();
  // Round-trip refuses invalid UTF-8 rather than silently replacing bytes.
  const text = Buffer.from(bytes).toString('utf8');
  if (!Buffer.from(text).equals(Buffer.from(bytes))) refuse();
  const o = JSON.parse(text);
  exactKeys(o, [
    'version',
    'archiveSha256',
    'releaseCommit',
    'releaseTree',
    'catalogSha256',
    'rowCounts',
    'observedAt',
  ]);
  if (
    o.version !== 2 ||
    !hex(o.archiveSha256, 64) ||
    !hex(o.releaseCommit, 40) ||
    !hex(o.releaseTree, 40) ||
    !hex(o.catalogSha256, 64)
  )
    refuse();
  for (const key of ['archiveSha256', 'releaseCommit', 'releaseTree'])
    if (o[key] !== binding[key]) refuse();
  timestamp(o.observedAt);
  exactKeys(o.rowCounts, tableNames);
  for (const value of Object.values(o.rowCounts)) decimal(value);
  return o;
}

// JS string comparison is ordinal, never locale-sensitive. Names in the supported
// source profile are ASCII. Column ordinals compare numerically.
function compare(a, b) {
  for (let i = 0; i < a.length; i++) {
    if (a[i] === b[i]) continue;
    return a[i] < b[i] ? -1 : 1;
  }
  return 0;
}
export function canonicalCatalog(c) {
  exactKeys(c, ['version', 'tables', 'columns', 'constraints', 'indexes']);
  if (c.version !== 2) refuse();
  const shapes = {
    tables: ['s', 's', 's', 's', 'b', 'b'],
    columns: ['s', 's', 'n', 's', 's', 'b', '?', 's', 's'],
    constraints: ['s', 's', 's', 's', 's', 'b', 'b', 'b'],
    indexes: ['s', 's', 's', 's', 'b', 'b', 'b', 'b'],
  };
  const out = { version: 2 };
  for (const [key, shape] of Object.entries(shapes)) {
    const rows = c[key];
    if (!Array.isArray(rows) || rows.length === 0 || rows.length > 4096) refuse();
    const seen = new Set();
    for (const row of rows) {
      if (
        !Array.isArray(row) ||
        row.length !== shape.length ||
        !tableNames.includes(`${row[0]}.${row[1]}`)
      )
        refuse();
      for (let i = 0; i < shape.length; i++) {
        const v = row[i];
        if (shape[i] === '?' && v === null) continue;
        if ((shape[i] === 's' || shape[i] === '?') && (typeof v !== 'string' || v.length > 16384))
          refuse();
        if (shape[i] === 'b' && typeof v !== 'boolean') refuse();
        if (shape[i] === 'n' && (!Number.isInteger(v) || v < 1 || v > 1600)) refuse();
      }
      const identity = JSON.stringify(row.slice(0, key === 'tables' ? 2 : 3));
      if (seen.has(identity)) refuse();
      seen.add(identity);
      if (key === 'tables' && (row[2] !== 'r' || row[3] !== 'p' || row[4] || row[5])) refuse();
      if (key === 'columns' && (row[7] !== '' || row[8] !== '')) refuse();
      if (
        key === 'constraints' &&
        (!['p', 'u', 'f', 'c'].includes(row[3]) || !row[5] || row[6] || row[7])
      )
        refuse();
      if (key === 'indexes' && (!row[6] || !row[7])) refuse();
    }
    if (key === 'tables' && rows.length !== tableNames.length) refuse();
    // All baseline tables have columns and primary keys/indexes.
    for (const name of tableNames) if (!rows.some((r) => `${r[0]}.${r[1]}` === name)) refuse();
    out[key] = [...rows].sort(compare);
  }
  return JSON.stringify(out);
}
