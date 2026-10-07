import { drizzleAdapter } from '@better-auth/drizzle-adapter';
import { betterAuth } from 'better-auth';
import { schema, type Database } from '@cupmemo/database';

const authPath = '/api/v1/auth';
const weakSecretPattern =
  /(?:change.?me|your.?secret|example|placeholder|replace.?me|replace-with|random.?secret|secret123)/i;

export interface AuthConfig {
  secret: string;
  origin: string;
  production: boolean;
}

export function resolveAuthConfig(env: NodeJS.ProcessEnv = process.env): AuthConfig {
  const secret = env.BETTER_AUTH_SECRET;
  if (!secret || secret.trim() !== secret || secret.length < 32 || weakSecretPattern.test(secret)) {
    throw new Error('BETTER_AUTH_SECRET must be a strong value of at least 32 characters');
  }

  const configuredUrl = env.BETTER_AUTH_URL;
  if (!configuredUrl) throw new Error('BETTER_AUTH_URL is required');
  let url: URL;
  try {
    url = new URL(configuredUrl);
  } catch {
    throw new Error('BETTER_AUTH_URL must be an absolute application origin');
  }
  const production = env.NODE_ENV === 'production' || env.CUPMEMO_DB_ENV === 'production';
  if (
    !['http:', 'https:'].includes(url.protocol) ||
    !url.hostname ||
    url.username ||
    url.password ||
    url.search ||
    url.hash ||
    !['', '/', authPath, `${authPath}/`].includes(url.pathname) ||
    (production && url.protocol !== 'https:') ||
    (!production && url.protocol === 'http:' && !isLoopback(url.hostname))
  ) {
    throw new Error('BETTER_AUTH_URL must be a valid application origin for this environment');
  }
  return { secret, origin: url.origin, production };
}

function isLoopback(hostname: string): boolean {
  const host = hostname.toLowerCase();
  return host === 'localhost' || host === '127.0.0.1' || host === '[::1]';
}

export function createAuth(db: Database, config: AuthConfig) {
  return betterAuth({
    appName: 'CupMemo',
    baseURL: config.origin,
    basePath: authPath,
    secret: config.secret,
    // Better Auth's default logger includes raw validation/origin diagnostics.
    // Keep those library details out of process logs; request failures are
    // surfaced only through the API's fixed generic response.
    logger: { disabled: true },
    trustedOrigins: [config.origin],
    database: drizzleAdapter(db, {
      provider: 'pg',
      schema: {
        user: schema.user,
        session: schema.session,
        account: schema.account,
        verification: schema.verification,
      },
    }),
    emailAndPassword: {
      enabled: true,
      requireEmailVerification: false,
    },
    session: {
      expiresIn: 60 * 60 * 24 * 7,
      updateAge: 60 * 60 * 24,
      cookieCache: { enabled: false },
    },
    advanced: {
      useSecureCookies: config.production,
      defaultCookieAttributes: {
        httpOnly: true,
        secure: config.production,
        sameSite: 'lax',
        path: '/',
      },
    },
  });
}

export { authPath };
