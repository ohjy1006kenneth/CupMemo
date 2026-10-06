export type DatabaseEnvironment = 'development' | 'test' | 'production';

export interface DatabaseConfig {
  environment: DatabaseEnvironment;
  databaseUrl: string;
  databaseName: string;
  hostname: string;
  port: number;
}

export type DatabaseEnvironmentMap = Readonly<Record<string, string | undefined>>;

const modeVariable = 'CUPMEMO_DB_ENV';
const urlVariables: Record<DatabaseEnvironment, string> = {
  development: 'CUPMEMO_DATABASE_URL_DEVELOPMENT',
  test: 'CUPMEMO_DATABASE_URL_TEST',
  production: 'CUPMEMO_DATABASE_URL_PRODUCTION',
};
const testDatabasePattern = /^cupmemo_test_[a-z0-9_]+$/;

function parseTarget(
  value: string,
  label: string,
): Omit<DatabaseConfig, 'environment' | 'databaseUrl'> {
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    throw new Error(`${label} must be a valid PostgreSQL connection URL`);
  }

  if (!['postgres:', 'postgresql:'].includes(url.protocol) || !url.hostname) {
    throw new Error(`${label} must be a valid PostgreSQL connection URL`);
  }

  // pg-connection-string allows query parameters to override URL authority fields
  // (notably host and port). Keep only TLS mode options so the validated target
  // is the target the driver will actually connect to.
  const queryKeys = [...url.searchParams.keys()];
  if (queryKeys.some((key) => key !== 'sslmode') || new Set(queryKeys).size !== queryKeys.length) {
    throw new Error(`${label} contains unsupported PostgreSQL connection options`);
  }

  let databaseName: string;
  try {
    databaseName = decodeURIComponent(url.pathname.slice(1));
  } catch {
    throw new Error(`${label} must include a valid database name`);
  }
  if (!databaseName || databaseName.includes('/')) {
    throw new Error(`${label} must include a valid database name`);
  }

  const hostname = url.hostname.toLowerCase();
  const port = url.port ? Number(url.port) : 5432;
  return { databaseName, hostname, port };
}

function isLoopback(hostname: string): boolean {
  return (
    hostname === 'localhost' ||
    hostname === '127.0.0.1' ||
    hostname === '::1' ||
    hostname === '[::1]'
  );
}

function targetKey(target: Omit<DatabaseConfig, 'environment' | 'databaseUrl'>): string {
  return `${target.hostname}:${target.port}/${target.databaseName}`;
}

export function resolveDatabaseConfig(env: DatabaseEnvironmentMap): DatabaseConfig {
  if (env.DATABASE_URL) {
    throw new Error('Legacy DATABASE_URL is unsupported; configure a mode-specific CupMemo URL');
  }

  const environment = env[modeVariable];
  if (environment !== 'development' && environment !== 'test' && environment !== 'production') {
    throw new Error('CUPMEMO_DB_ENV must be development, test, or production');
  }
  if (env.NODE_ENV === 'production' && environment !== 'production') {
    throw new Error('Production NODE_ENV requires production database mode');
  }

  const selectedVariable = urlVariables[environment];
  const selectedUrl = env[selectedVariable];
  if (!selectedUrl) {
    throw new Error(`${selectedVariable} is required for ${environment} mode`);
  }

  const selectedTarget = parseTarget(selectedUrl, selectedVariable);
  if (environment === 'development' && selectedTarget.databaseName !== 'cupmemo_dev') {
    throw new Error('Development database must be named cupmemo_dev');
  }
  if (environment === 'test') {
    const expected = env.CUPMEMO_TEST_DATABASE;
    if (
      !expected ||
      !testDatabasePattern.test(expected) ||
      selectedTarget.databaseName !== expected
    ) {
      throw new Error('Test database name must match CUPMEMO_TEST_DATABASE (cupmemo_test_<task>)');
    }
    if (!isLoopback(selectedTarget.hostname)) {
      throw new Error('Test database must use a loopback host');
    }
  }
  if (
    environment === 'production' &&
    (selectedTarget.databaseName === 'cupmemo_dev' ||
      selectedTarget.databaseName.toLowerCase().startsWith('cupmemo_test_'))
  ) {
    throw new Error('Production database cannot use a development or test database name');
  }

  const seen = new Map<string, DatabaseEnvironment>();
  for (const mode of ['development', 'test', 'production'] as const) {
    const configured = env[urlVariables[mode]];
    if (!configured) continue;
    const target = parseTarget(configured, urlVariables[mode]);
    const key = targetKey(target);
    const prior = seen.get(key);
    if (prior && prior !== mode) {
      throw new Error(`Database target is reused by ${prior} and ${mode} modes`);
    }
    seen.set(key, mode);
  }

  return { environment, databaseUrl: selectedUrl, ...selectedTarget };
}
