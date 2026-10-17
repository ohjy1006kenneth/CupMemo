import { z } from 'zod';

const originSchema = z
  .string()
  // Validate raw spelling before Zod/URL can trim whitespace or normalize it.
  .regex(/^https?:\/\/[^/?#\\\s]+\/?$/i, 'Expected an HTTP(S) origin only')
  .url()
  .refine((value) => {
    const url = new URL(value);
    return (
      ['http:', 'https:'].includes(url.protocol) &&
      !url.username &&
      !url.password &&
      url.pathname === '/' &&
      !url.search &&
      !url.hash
    );
  }, 'Expected an HTTP(S) origin without credentials, path, query or fragment');

export function parseApiOrigin(value: string | undefined): string {
  return new URL(originSchema.parse(value ?? 'http://127.0.0.1:4101')).origin;
}
