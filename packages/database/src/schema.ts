import { sql } from 'drizzle-orm';
import {
  boolean,
  check,
  date,
  foreignKey,
  index,
  integer,
  numeric,
  pgSchema,
  pgTable,
  primaryKey,
  text,
  timestamp,
  unique,
  uniqueIndex,
  uuid,
} from 'drizzle-orm/pg-core';

/** Application tables are introduced by their owning feature migrations. */
export const cupmemo = pgSchema('cupmemo');

// Better Auth's public adapter tables are intentionally separate from domain data.
export const user = pgTable(
  'user',
  {
    id: text('id').primaryKey(),
    name: text('name').notNull(),
    email: text('email').notNull(),
    emailVerified: boolean('email_verified').notNull().default(false),
    image: text('image'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [uniqueIndex('user_email_unique').on(table.email)],
);

export const session = pgTable(
  'session',
  {
    id: text('id').primaryKey(),
    expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
    token: text('token').notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
    ipAddress: text('ip_address'),
    userAgent: text('user_agent'),
    userId: text('user_id')
      .notNull()
      .references(() => user.id, { onDelete: 'cascade' }),
  },
  (table) => [uniqueIndex('session_token_unique').on(table.token)],
);

export const account = pgTable(
  'account',
  {
    id: text('id').primaryKey(),
    accountId: text('account_id').notNull(),
    providerId: text('provider_id').notNull(),
    userId: text('user_id')
      .notNull()
      .references(() => user.id, { onDelete: 'cascade' }),
    accessToken: text('access_token'),
    refreshToken: text('refresh_token'),
    idToken: text('id_token'),
    accessTokenExpiresAt: timestamp('access_token_expires_at', { withTimezone: true }),
    refreshTokenExpiresAt: timestamp('refresh_token_expires_at', { withTimezone: true }),
    scope: text('scope'),
    password: text('password'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [uniqueIndex('account_provider_account_unique').on(table.providerId, table.accountId)],
);

export const verification = pgTable(
  'verification',
  {
    id: text('id').primaryKey(),
    identifier: text('identifier').notNull(),
    value: text('value').notNull(),
    expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [uniqueIndex('verification_identifier_unique').on(table.identifier)],
);

export const coffees = cupmemo.table(
  'coffees',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    ownerId: text('owner_id')
      .notNull()
      .references(() => user.id, { onDelete: 'cascade' }),
    name: text('name').notNull(),
    roaster: text('roaster').notNull(),
    country: text('country'),
    region: text('region'),
    farmStation: text('farm_station'),
    producer: text('producer'),
    variety: text('variety'),
    process: text('process'),
    elevation: text('elevation'),
    roastDate: date('roast_date'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    unique('coffees_id_owner_unique').on(table.id, table.ownerId),
    index('coffees_owner_created_idx').on(table.ownerId, table.createdAt),
    check('coffees_name_nonblank', sql`${table.name} ~ '[^[:space:]]'`),
    check('coffees_roaster_nonblank', sql`${table.roaster} ~ '[^[:space:]]'`),
  ],
);

export const brews = cupmemo.table(
  'brews',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    ownerId: text('owner_id')
      .notNull()
      .references(() => user.id, { onDelete: 'cascade' }),
    coffeeId: uuid('coffee_id').notNull(),
    brewer: text('brewer').notNull(),
    grinder: text('grinder').notNull(),
    grindSetting: text('grind_setting').notNull(),
    doseGrams: numeric('dose_grams', { precision: 7, scale: 2 }).notNull(),
    waterGrams: numeric('water_grams', { precision: 7, scale: 2 }).notNull(),
    waterTemperatureC: numeric('water_temperature_c', { precision: 5, scale: 2 }).notNull(),
    totalBrewTimeSeconds: integer('total_brew_time_seconds').notNull(),
    overallScore: numeric('overall_score', { precision: 5, scale: 2 }).notNull(),
    tastingMode: text('tasting_mode').notNull().default('quick'),
    acidity: numeric('acidity', { precision: 4, scale: 2 }),
    body: numeric('body', { precision: 4, scale: 2 }),
    aftertaste: numeric('aftertaste', { precision: 4, scale: 2 }),
    fragranceAroma: numeric('fragrance_aroma', { precision: 4, scale: 2 }),
    flavor: numeric('flavor', { precision: 4, scale: 2 }),
    balance: numeric('balance', { precision: 4, scale: 2 }),
    sweetness: numeric('sweetness', { precision: 4, scale: 2 }),
    overallImpression: numeric('overall_impression', { precision: 4, scale: 2 }),
    notes: text('notes'),
    brewedAt: timestamp('brewed_at', { withTimezone: true }).notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    // NO ACTION checks at statement end: protect history but permit user cascades.
    foreignKey({
      name: 'brews_coffee_owner_fk',
      columns: [table.coffeeId, table.ownerId],
      foreignColumns: [coffees.id, coffees.ownerId],
    }).onDelete('no action'),
    index('brews_owner_brewed_idx').on(table.ownerId, table.brewedAt),
    index('brews_coffee_owner_brewed_idx').on(table.coffeeId, table.ownerId, table.brewedAt),
    check('brews_brewer_nonblank', sql`${table.brewer} ~ '[^[:space:]]'`),
    check('brews_grinder_nonblank', sql`${table.grinder} ~ '[^[:space:]]'`),
    check('brews_grind_setting_nonblank', sql`${table.grindSetting} ~ '[^[:space:]]'`),
    check(
      'brews_dose_positive_finite',
      sql`${table.doseGrams} > 0 AND ${table.doseGrams} NOT IN ('NaN'::numeric, 'Infinity'::numeric, '-Infinity'::numeric)`,
    ),
    check(
      'brews_water_positive_finite',
      sql`${table.waterGrams} > 0 AND ${table.waterGrams} NOT IN ('NaN'::numeric, 'Infinity'::numeric, '-Infinity'::numeric)`,
    ),
    check('brews_temperature_range', sql`${table.waterTemperatureC} BETWEEN 0 AND 100`),
    check('brews_duration_nonnegative', sql`${table.totalBrewTimeSeconds} >= 0`),
    check(
      'brews_overall_score_quarter',
      sql`${table.overallScore} BETWEEN 0 AND 100 AND mod(${table.overallScore}, 0.25) = 0`,
    ),
    check('brews_tasting_mode', sql`${table.tastingMode} IN ('quick', 'sensory')`),
    ...[
      table.acidity,
      table.body,
      table.aftertaste,
      table.fragranceAroma,
      table.flavor,
      table.balance,
      table.sweetness,
      table.overallImpression,
    ].map((column) =>
      check(
        `brews_${column.name}_quarter`,
        sql`${column} BETWEEN 0 AND 10 AND mod(${column}, 0.25) = 0`,
      ),
    ),
  ],
);

export const brewPours = cupmemo.table(
  'brew_pours',
  {
    brewId: uuid('brew_id')
      .notNull()
      .references(() => brews.id, { onDelete: 'cascade' }),
    position: integer('position').notNull(),
    waterGrams: numeric('water_grams', { precision: 7, scale: 2 }).notNull(),
    startTimeSeconds: integer('start_time_seconds').notNull(),
  },
  (table) => [
    primaryKey({ columns: [table.brewId, table.position] }),
    check('brew_pours_position_nonnegative', sql`${table.position} >= 0`),
    check('brew_pours_start_nonnegative', sql`${table.startTimeSeconds} >= 0`),
    check(
      'brew_pours_water_positive_finite',
      sql`${table.waterGrams} > 0 AND ${table.waterGrams} NOT IN ('NaN'::numeric, 'Infinity'::numeric, '-Infinity'::numeric)`,
    ),
  ],
);

export const coffeeTastingNotes = cupmemo.table(
  'coffee_tasting_notes',
  {
    coffeeId: uuid('coffee_id')
      .notNull()
      .references(() => coffees.id, { onDelete: 'cascade' }),
    note: text('note').notNull(),
  },
  (table) => [
    primaryKey({ columns: [table.coffeeId, table.note] }),
    check('coffee_tasting_notes_nonblank', sql`${table.note} ~ '[^[:space:]]'`),
  ],
);

export const brewTastingTags = cupmemo.table(
  'brew_tasting_tags',
  {
    brewId: uuid('brew_id')
      .notNull()
      .references(() => brews.id, { onDelete: 'cascade' }),
    tag: text('tag').notNull(),
  },
  (table) => [
    primaryKey({ columns: [table.brewId, table.tag] }),
    check('brew_tasting_tags_nonblank', sql`${table.tag} ~ '[^[:space:]]'`),
  ],
);
