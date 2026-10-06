import { describe, expect, it } from 'vitest';
import { parseApiOrigin } from '../apps/web/src/api-origin.ts';

describe('web API proxy configuration', () => {
  it('defaults to the private loopback API origin and normalizes a trailing slash', () => {
    expect(parseApiOrigin(undefined)).toBe('http://127.0.0.1:4101');
    expect(parseApiOrigin('https://api.example.test/')).toBe('https://api.example.test');
  });

  it.each(['ftp://example.test', 'http://user:pass@example.test', '/relative', 'not-a-url'])(
    'rejects unsafe or invalid API origin %s',
    (origin) => expect(() => parseApiOrigin(origin)).toThrow(),
  );
});
