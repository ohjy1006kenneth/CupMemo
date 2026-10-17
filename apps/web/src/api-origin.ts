import { z } from 'zod';

const originSchema = z
  .string()
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
  return originSchema.parse(value ?? 'http://127.0.0.1:4101').replace(/\/$/, '');
}
