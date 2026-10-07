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
