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
  if (!isRecord(value) || !isRecord(value.user) || !isRecord(value.session)) return false;
  const user = value.user;
  const session = value.session;
  // Validate the pinned Better Auth 1.7.7 JSON shape, not authentication:
  // Fastify owns expiry/revocation decisions. Never return these private fields.
  return (
    isCoreRecord(user) &&
    isCoreRecord(session) &&
    isNonemptyString(session.userId) &&
    session.userId === user.id &&
    isNonemptyString(session.token) &&
    isSerializedDate(session.expiresAt) &&
    isOptionalString(session.ipAddress) &&
    isOptionalString(session.userAgent) &&
    typeof user.name === 'string' &&
    isNonemptyString(user.email) &&
    typeof user.emailVerified === 'boolean' &&
    isOptionalString(user.image)
  );
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === 'object' && !Array.isArray(value);
}

function isNonemptyString(value: unknown): value is string {
  return typeof value === 'string' && value.trim().length > 0;
}

function isOptionalString(value: unknown): boolean {
  return value === undefined || value === null || typeof value === 'string';
}

function isSerializedDate(value: unknown): boolean {
  if (typeof value !== 'string') return false;
  const date = new Date(value);
  return Number.isFinite(date.getTime()) && date.toISOString() === value;
}

function isCoreRecord(value: Record<string, unknown>): boolean {
  return (
    isNonemptyString(value.id) &&
    isSerializedDate(value.createdAt) &&
    isSerializedDate(value.updatedAt)
  );
}

export async function currentAuthSession(): Promise<SessionResult> {
  const { headers } = await import('next/headers');
  const requestHeaders = await headers();
  return readAuthSession({ cookie: requestHeaders.get('cookie') });
}
