import { z } from 'zod';

const requiredText = z.string().trim().min(1).max(200);
const optionalText = z
  .string()
  .trim()
  .max(500)
  .transform((value) => value || null)
  .nullable();
const calendarDate = z.iso.date();
const notes = z
  .array(z.string().trim().min(1).max(100))
  .max(32)
  .refine((values) => new Set(values).size === values.length);
const editable = {
  name: requiredText,
  roaster: requiredText,
  country: optionalText,
  region: optionalText,
  farmStation: optionalText,
  producer: optionalText,
  variety: optionalText,
  process: optionalText,
  elevation: optionalText,
  roastDate: calendarDate.nullable(),
  tastingNotes: notes,
};
export const coffeeCreateSchema = z.strictObject({
  ...editable,
  country: optionalText.default(null),
  region: optionalText.default(null),
  farmStation: optionalText.default(null),
  producer: optionalText.default(null),
  variety: optionalText.default(null),
  process: optionalText.default(null),
  elevation: optionalText.default(null),
  roastDate: calendarDate.nullable().default(null),
  tastingNotes: notes.default([]),
});
export const coffeePatchSchema = z
  .strictObject(editable)
  .partial()
  .refine((value) => Object.values(value).some((field) => field !== undefined));
export const coffeeIdSchema = z.uuid();
const decimal = (minimum: number, maximum: number, fallback: string) =>
  z
    .string()
    .regex(/^[0-9]+$/)
    .default(fallback)
    .transform(Number)
    .pipe(z.number().int().min(minimum).max(maximum));
export const coffeeListQuerySchema = z.strictObject({
  limit: decimal(1, 100, '50'),
  offset: decimal(0, 100000, '0'),
});
// Output validation never repairs invalid persistence or silently strips fields.
const storedText = (maximum: number) =>
  z
    .string()
    .min(1)
    .max(maximum)
    .refine((value) => value === value.trim());
const storedNotes = z
  .array(storedText(100))
  .max(32)
  .refine((values) => new Set(values).size === values.length)
  .refine((values) => values.every((value, index) => index === 0 || values[index - 1]! < value));
export const coffeeSchema = z.strictObject({
  id: coffeeIdSchema,
  name: storedText(200),
  roaster: storedText(200),
  country: storedText(500).nullable(),
  region: storedText(500).nullable(),
  farmStation: storedText(500).nullable(),
  producer: storedText(500).nullable(),
  variety: storedText(500).nullable(),
  process: storedText(500).nullable(),
  elevation: storedText(500).nullable(),
  roastDate: calendarDate.nullable(),
  tastingNotes: storedNotes,
  createdAt: z.iso.datetime(),
  updatedAt: z.iso.datetime(),
});
export const coffeeResponseSchema = z.strictObject({ coffee: coffeeSchema });
export const coffeeListResponseSchema = z.strictObject({
  coffees: z.array(coffeeSchema).max(100),
  pagination: z.strictObject({
    limit: z.number().int().min(1).max(100),
    offset: z.number().int().min(0).max(100000),
    hasMore: z.boolean(),
  }),
});
export type CoffeeCreate = z.infer<typeof coffeeCreateSchema>;
export type CoffeePatch = z.infer<typeof coffeePatchSchema>;
export type CoffeeListQuery = z.infer<typeof coffeeListQuerySchema>;
export type Coffee = z.infer<typeof coffeeSchema>;
export type CoffeeResponse = z.infer<typeof coffeeResponseSchema>;
export type CoffeeListResponse = z.infer<typeof coffeeListResponseSchema>;
export type CoffeeId = z.infer<typeof coffeeIdSchema>;

// Decimal spelling avoids both binary multiplication artifacts (0.29) and
// accepting excess precision via an epsilon or PostgreSQL's fixed-scale rounding.
const hundredthsNumber = z.number().refine((value) => /^\d+(?:\.\d{1,2})?$/.test(String(value)));
const grams = hundredthsNumber.pipe(z.number().positive().max(99999.99));
const temperature = hundredthsNumber.pipe(z.number().min(0).max(100));
const seconds = z.number().int().min(0).max(86400);
const quarter = (maximum: number) =>
  z
    .number()
    .min(0)
    .max(maximum)
    .refine((value) => Number.isInteger(value * 4));
const brewDate = z
  .string()
  .refine((value) => {
    const match =
      /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2})(?:\.(\d{1,3}))?(Z|[+-]\d{2}:\d{2})$/.exec(
        value,
      );
    if (!match) return false;
    const year = Number(match[1]);
    const month = Number(match[2]);
    const day = Number(match[3]);
    const leap = year % 4 === 0 && (year % 100 !== 0 || year % 400 === 0);
    const days = [31, leap ? 29 : 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];
    if (year < 1 || month < 1 || month > 12 || day < 1 || day > days[month - 1]!) return false;
    if (Number(match[4]) > 23 || Number(match[5]) > 59 || Number(match[6]) > 59) return false;
    if (match[8] !== 'Z' && (Number(match[8]!.slice(1, 3)) > 23 || Number(match[8]!.slice(4)) > 59))
      return false;
    const date = new Date(value);
    return (
      Number.isFinite(date.getTime()) && date.getUTCFullYear() >= 1 && date.getUTCFullYear() <= 9999
    );
  })
  .transform((value) => new Date(value).toISOString());
const brewNotes = z
  .string()
  .trim()
  .max(5000)
  .transform((value) => value || null)
  .nullable();
const tags = z
  .array(z.string().trim().min(1).max(100))
  .max(32)
  .refine((values) => new Set(values).size === values.length)
  .transform((values) => values.sort());
const pour = z.strictObject({ waterGrams: grams, startTimeSeconds: seconds });
const quality = quarter(10).nullable();
const tastingMode = z.enum(['quick', 'sensory']);
const brewEditable = {
  brewer: requiredText,
  grinder: requiredText,
  grindSetting: requiredText,
  doseGrams: grams,
  waterGrams: grams,
  waterTemperatureC: temperature,
  totalBrewTimeSeconds: seconds,
  brewedAt: brewDate,
  overallScore: quarter(100),
  tastingMode,
  acidity: quality,
  body: quality,
  aftertaste: quality,
  fragranceAroma: quality,
  flavor: quality,
  balance: quality,
  sweetness: quality,
  overallImpression: quality,
  tastingTags: tags,
  notes: brewNotes,
  pours: z.array(pour).min(1).max(32),
};
function validRecipe(value: {
  waterGrams: number;
  totalBrewTimeSeconds: number;
  pours: { waterGrams: number; startTimeSeconds: number }[];
}) {
  return (
    value.pours.reduce((sum, item) => sum + Math.round(item.waterGrams * 100), 0) ===
      Math.round(value.waterGrams * 100) &&
    value.pours.every(
      (item, index) =>
        item.startTimeSeconds <= value.totalBrewTimeSeconds &&
        (index === 0 || item.startTimeSeconds >= value.pours[index - 1]!.startTimeSeconds),
    )
  );
}
export const brewIdSchema = z.uuid();
export const brewCreateSchema = z
  .strictObject({
    ...brewEditable,
    coffeeId: brewIdSchema,
    acidity: brewEditable.acidity.default(null),
    body: brewEditable.body.default(null),
    aftertaste: brewEditable.aftertaste.default(null),
    fragranceAroma: quality.default(null),
    flavor: quality.default(null),
    balance: quality.default(null),
    sweetness: quality.default(null),
    overallImpression: quality.default(null),
    tastingMode: tastingMode.default('quick'),
    tastingTags: tags.default([]),
    notes: brewNotes.default(null),
  })
  .refine(validRecipe);
export const brewPatchSchema = z
  .strictObject(brewEditable)
  .partial()
  .refine((value) => Object.values(value).some((field) => field !== undefined));
export const brewListQuerySchema = z.strictObject({
  limit: decimal(1, 100, '50'),
  offset: decimal(0, 100000, '0'),
  coffeeId: brewIdSchema.optional(),
});
const utcMillis = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/)
  .refine((value) => brewDate.safeParse(value).success);
export const brewSchema = z
  .strictObject({
    ...brewEditable,
    id: brewIdSchema,
    coffeeId: brewIdSchema,
    brewer: storedText(200),
    grinder: storedText(200),
    grindSetting: storedText(200),
    brewedAt: utcMillis,
    createdAt: utcMillis,
    updatedAt: utcMillis,
    notes: storedText(5000).nullable(),
    tastingTags: storedNotes,
    pours: z
      .array(z.strictObject({ ...pour.shape, position: z.number().int().min(0).max(31) }))
      .min(1)
      .max(32)
      .refine((values) => values.every((value, index) => value.position === index)),
  })
  .refine(validRecipe);
export const brewResponseSchema = z.strictObject({ brew: brewSchema });
export const brewListResponseSchema = z.strictObject({
  brews: z.array(brewSchema).max(100),
  pagination: coffeeListResponseSchema.shape.pagination,
});
export type BrewCreate = z.infer<typeof brewCreateSchema>;
export type BrewPatch = z.infer<typeof brewPatchSchema>;
export type BrewListQuery = z.infer<typeof brewListQuerySchema>;
export type BrewId = z.infer<typeof brewIdSchema>;
export type Brew = z.infer<typeof brewSchema>;
export type BrewResponse = z.infer<typeof brewResponseSchema>;
export type BrewListResponse = z.infer<typeof brewListResponseSchema>;
