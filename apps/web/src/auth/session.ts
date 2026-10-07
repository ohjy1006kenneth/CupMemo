import 'server-only';

import { parseApiOrigin } from '../api-origin';

export type AuthSession = { user: { name: string; email: string } };
export type SessionResult =
  | { kind: 'authenticated'; session: AuthSession }
  | { kind: 'unauthenticated' }
  | { kind: 'unavailable' };

type SessionOptions = {
  cookie?: string | null;
  origin?: string;
  fetcher?: typeof fetch;
  timeoutMs?: number;
};

export async function readAuthSession({
  cookie,
  origin = parseApiOrigin(process.env.CUPMEMO_API_ORIGIN),
  fetcher = fetch,
  timeoutMs = 3000,
}: SessionOptions): Promise<SessionResult> {
  if (!cookie) return { kind: 'unauthenticated' };
  try {
    const response = await fetcher(
      `${origin}/api/v1/auth/get-session?disableRefresh=true&disableCookieCache=true`,
      {
        method: 'GET',
        headers: { cookie, accept: 'application/json' },
        cache: 'no-store',
        redirect: 'manual',
        signal: AbortSignal.timeout(timeoutMs),
      },
    );
    if (response.status === 401) return { kind: 'unauthenticated' };
    if (!response.ok || response.status >= 300) return { kind: 'unavailable' };
    const body: unknown = await response.json();
    if (body === null) return { kind: 'unauthenticated' };
    if (!isSessionResponse(body)) return { kind: 'unavailable' };
    return {
      kind: 'authenticated',
      session: { user: { name: body.user.name, email: body.user.email } },
    };
  } catch {
    return { kind: 'unavailable' };
  }
}

function isSessionResponse(value: unknown): value is { user: { name: string; email: string } } {
  if (
    !value ||
    typeof value !== 'object' ||
    !('user' in value) ||
    !('session' in value) ||
    !value.session ||
    typeof value.session !== 'object' ||
    Array.isArray(value.session)
  )
    return false;
  const user = value.user;
  return (
    !!user &&
    typeof user === 'object' &&
    'name' in user &&
    typeof user.name === 'string' &&
    'email' in user &&
    typeof user.email === 'string'
  );
}

export async function currentAuthSession(): Promise<SessionResult> {
  const { headers } = await import('next/headers');
  const requestHeaders = await headers();
  return readAuthSession({ cookie: requestHeaders.get('cookie') });
}
