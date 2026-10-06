import { describe, expect, it } from 'vitest';
import { createApp, parseApiConfig } from '../apps/api/src/app.ts';

describe('API scaffold', () => {
  it.each(['/health', '/ready', '/api/v1/health'])(
    'serves %s with the exact JSON health contract',
    async (url) => {
      const app = createApp();
      const response = await app.inject({ method: 'GET', url });
      expect(response.statusCode).toBe(200);
      expect(response.headers['content-type']).toMatch(/^application\/json/);
      expect(response.json()).toEqual({ status: 'ok' });
      await app.close();
    },
  );

  it('returns 404 for unknown routes and does not accept mutations to health', async () => {
    const app = createApp();
    expect((await app.inject({ method: 'GET', url: '/unknown' })).statusCode).toBe(404);
    expect((await app.inject({ method: 'POST', url: '/health' })).statusCode).toBe(404);
    await app.close();
  });

  it('validates the API port and loopback bind configuration', () => {
    expect(parseApiConfig({})).toEqual({ host: '127.0.0.1', port: 4101 });
    expect(parseApiConfig({ CUPMEMO_API_PORT: '65535' }).port).toBe(65535);
    for (const port of ['0', '65536', 'nope', '1.2']) {
      expect(() => parseApiConfig({ CUPMEMO_API_PORT: port })).toThrow();
    }
    expect(() => parseApiConfig({ CUPMEMO_API_HOST: '0.0.0.0' })).not.toThrow();
  });
});
