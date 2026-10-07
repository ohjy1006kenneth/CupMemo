'use client';

import { createAuthClient } from 'better-auth/react';

// The pinned client resolves this path against window.location.origin in the browser.
// A relative baseURL is not supported by Better Auth 1.7.7.
export const authClient = createAuthClient({
  basePath: '/api/v1/auth',
  // Explicit browser origin also prevents public auth URL environment overrides.
  baseURL: typeof window === 'undefined' ? undefined : window.location.origin,
});
