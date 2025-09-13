/**
 * Environment Configuration
 * Centralized environment variable management with validation and defaults
 */

export interface EnvironmentConfig {
  // Application
  NODE_ENV: 'development' | 'staging' | 'production';
  APP_BASE_URL: string;
  NEXT_PUBLIC_APP_URL: string;

  // Socket.IO
  SOCKET_PORT: number;
  NEXT_PUBLIC_SOCKET_URL: string;
  ALLOWED_ORIGINS: string[];

  // Database
  DATABASE_URL: string;

  // Firebase
  FIREBASE_PROJECT_ID: string;
  FIREBASE_PRIVATE_KEY: string;
  FIREBASE_CLIENT_EMAIL: string;

  // Authentication
  JWT_SECRET: string;

  // External APIs
  AFL_API_KEY: string;
  AFL_API_URL: string;

  // Performance
  PLAYERS_FETCH_TIMEOUT_MS: number;
  LEAGUE_REVALIDATE_SECONDS: number;

  // Development
  ENABLE_DEBUG_LOGGING: boolean;
  ENABLE_MOCK_DATA: boolean;
}

// Environment validation
function validateEnvironment(): void {
  const requiredVars = [
    'DATABASE_URL',
    'FIREBASE_PROJECT_ID',
    'FIREBASE_PRIVATE_KEY',
    'FIREBASE_CLIENT_EMAIL',
  ];

  const missingVars = requiredVars.filter((varName) => !process.env[varName]);

  if (missingVars.length > 0) {
    throw new Error(`Missing required environment variables: ${missingVars.join(', ')}`);
  }
}

// Get environment variable with type conversion
function getEnvVar<T>(key: string, defaultValue: T, transform?: (value: string) => T): T {
  const raw = process.env[key];
  if (raw === undefined) return defaultValue;
  if (!transform) return (raw as unknown) as T;
  try {
    return transform(raw);
  } catch (err) {
    const reason = err instanceof Error ? err.message : String(err);
    console.warn(`Warning: Invalid value for ${key}, using default`, { key, defaultValue, reason });
    return defaultValue;
  }
}

// Parse comma-separated string
function parseCommaSeparated(value: string): string[] {
  return value
    .split(',')
    .map((item) => item.trim())
    .filter(Boolean);
}

// Parse boolean
function parseBoolean(value: string): boolean {
  return value.toLowerCase() === 'true' || value === '1';
}

// Parse integer (renamed to avoid shadowing global parseInt)
function parseEnvInt(value: string): number {
  const parsed = Number.parseInt(value, 10);
  if (Number.isNaN(parsed)) {
    throw new Error(`Invalid integer: ${value}`);
  }
  return parsed;
}

// Environment configuration
export const environment: EnvironmentConfig = {
  // Application
  NODE_ENV: getEnvVar('NODE_ENV', 'development') as EnvironmentConfig['NODE_ENV'],
  APP_BASE_URL: getEnvVar('APP_BASE_URL', 'http://localhost:3000'),
  NEXT_PUBLIC_APP_URL: getEnvVar('NEXT_PUBLIC_APP_URL', 'http://localhost:3000'),

  // Socket.IO
  // Prefer SOCKETIO_PORT for Socket.IO, fallback to legacy SOCKET_PORT
  SOCKET_PORT: (() => {
    const raw = process.env.SOCKETIO_PORT ?? process.env.SOCKET_PORT ?? '3002';
    try {
      return parseEnvInt(raw);
    } catch (_err) {
      console.warn(
        `Warning: Invalid socket port '${raw}', using default 3002`
      );
      return 3002;
    }
  })(),
  NEXT_PUBLIC_SOCKET_URL: getEnvVar('NEXT_PUBLIC_SOCKET_URL', 'http://localhost:3002'),
  ALLOWED_ORIGINS: getEnvVar(
    'ALLOWED_ORIGINS',
    [
      'http://localhost:3000',
      'http://localhost:3001',
      'http://localhost:3002',
      'http://localhost:3003',
    ],
    parseCommaSeparated
  ),

  // Database
  DATABASE_URL: getEnvVar('DATABASE_URL', ''),

  // Firebase
  FIREBASE_PROJECT_ID: getEnvVar('FIREBASE_PROJECT_ID', ''),
  FIREBASE_PRIVATE_KEY: getEnvVar('FIREBASE_PRIVATE_KEY', ''),
  FIREBASE_CLIENT_EMAIL: getEnvVar('FIREBASE_CLIENT_EMAIL', ''),

  // Authentication
  JWT_SECRET: getEnvVar('JWT_SECRET', 'your-secret-key-change-in-production'),

  // External APIs
  AFL_API_KEY: getEnvVar('AFL_API_KEY', ''),
  AFL_API_URL: getEnvVar('AFL_API_URL', 'https://api.afl.com.au'),

  // Performance
  PLAYERS_FETCH_TIMEOUT_MS: getEnvVar('PLAYERS_FETCH_TIMEOUT_MS', 5000, parseEnvInt),
  LEAGUE_REVALIDATE_SECONDS: getEnvVar('LEAGUE_REVALIDATE_SECONDS', 3600, parseEnvInt),

  // Development
  ENABLE_DEBUG_LOGGING: getEnvVar('ENABLE_DEBUG_LOGGING', false, parseBoolean),
  ENABLE_MOCK_DATA: getEnvVar('ENABLE_MOCK_DATA', false, parseBoolean),
};

// Validate environment in production
if (environment.NODE_ENV === 'production') {
  validateEnvironment();
}

// Environment-specific overrides
if (environment.NODE_ENV === 'development') {
  // Development overrides
  const devOverride = process.env.DEV_ALLOWED_ORIGINS;
  const defaultDevOrigins = ['http://localhost:3000', 'http://127.0.0.1:3000'];
  environment.ALLOWED_ORIGINS =
    devOverride && devOverride.trim().length > 0
      ? devOverride
          .split(',')
          .map((s) => s.trim())
          .filter(Boolean)
      : defaultDevOrigins;
  environment.ENABLE_DEBUG_LOGGING = true;
}

// Export environment checkers
export const isDevelopment = environment.NODE_ENV === 'development';
export const isStaging = environment.NODE_ENV === 'staging';
export const isProduction = environment.NODE_ENV === 'production';

// Export environment validation
export function validateEnvironmentConfig(): void {
  try {
    validateEnvironment();
    console.log('✅ Environment configuration validated successfully');
  } catch (error) {
    const details = error instanceof Error ? error.stack || error.message : String(error);
    console.error(`❌ Environment configuration validation failed: ${details}`, error);
    // Preserve original error
    throw error instanceof Error ? error : new Error(String(error));
  }
}

// Export default configuration
export default environment;
