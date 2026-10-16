import type { NextConfig } from 'next';
import { fileURLToPath } from 'node:url';
import { resolve } from 'node:path';
import { parseApiOrigin } from './src/api-origin';

const apiOrigin = parseApiOrigin(process.env.CUPMEMO_API_ORIGIN);

const nextConfig: NextConfig = {
  output: 'standalone',
  // Resolve from this ESM file, never the caller's working directory.
  outputFileTracingRoot: resolve(fileURLToPath(new URL('../..', import.meta.url))),
  async rewrites() {
    return [{ source: '/api/v1/:path*', destination: `${apiOrigin}/api/v1/:path*` }];
  },
};

export default nextConfig;
