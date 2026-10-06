import type { NextConfig } from 'next';
import { parseApiOrigin } from './src/api-origin';

const apiOrigin = parseApiOrigin(process.env.CUPMEMO_API_ORIGIN);

const nextConfig: NextConfig = {
  async rewrites() {
    return [{ source: '/api/v1/:path*', destination: `${apiOrigin}/api/v1/:path*` }];
  },
};

export default nextConfig;
