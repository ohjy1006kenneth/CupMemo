import { pgSchema } from 'drizzle-orm/pg-core';

/** Application tables are introduced by their owning feature migrations. */
export const cupmemo = pgSchema('cupmemo');
