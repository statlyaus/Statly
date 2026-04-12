import { z } from 'zod';

// Server-only environment schema
const ServerEnvSchema = z
  .object({
    NODE_ENV: z.enum(['development', 'staging', 'production']).default('development'),

    // Core app
    APP_BASE_URL: z.string().url().default('http://localhost:3000'),
    APP_ORIGIN: z.string().url().default('http://localhost:3000'),

    // Database
    DATABASE_URL: z.string().min(1).optional(),

    // Socket
    SOCKETIO_PORT: z.string().optional(),
    SOCKET_PORT: z.string().optional(), // legacy fallback

    // Firebase (accept ADC or service-account credentials)
    FIREBASE_SERVICE_ACCOUNT_JSON_BASE64: z.string().optional(),
    FIREBASE_PROJECT_ID: z.string().optional(),
    FIREBASE_CLIENT_EMAIL: z.string().optional(),
    FIREBASE_PRIVATE_KEY: z.string().optional(),

    // Optional services
    REDIS_HOST: z.string().optional(),
    REDIS_PORT: z.string().optional(),
    REDIS_DB: z.string().optional(),
    REDIS_MAX_RETRIES: z.string().optional(),

    // Optional tokens
    GITHUB_TOKEN: z.string().optional(),
    OPENAI_API_KEY: z.string().optional(),
    OPENAI_BASE_URL: z.string().url().optional(),
  })
  .transform((env) => {
    // Normalize socket port preference
    const rawPort = env.SOCKETIO_PORT ?? env.SOCKET_PORT ?? '3002';
    let socketPort = 3002;
    try {
      socketPort = Number.parseInt(String(rawPort), 10);
      if (!Number.isFinite(socketPort)) throw new Error('not a number');
    } catch {
      socketPort = 3002;
    }
    return { ...env, SOCKET_PORT_NUM: socketPort } as typeof env & { SOCKET_PORT_NUM: number };
  });

// Client-exposed environment schema (NEXT_PUBLIC_* only)
const ClientEnvSchema = z.object({
  NEXT_PUBLIC_API_BASE_URL: z.string().url().default('http://localhost:3000'),
  NEXT_PUBLIC_SOCKET_URL: z.string().url().default('http://localhost:3002'),
  NEXT_PUBLIC_FIREBASE_API_KEY: z.string().optional(),
  NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN: z.string().optional(),
  NEXT_PUBLIC_FIREBASE_PROJECT_ID: z.string().optional(),
  NEXT_PUBLIC_FIREBASE_STORAGE_BUCKET: z.string().optional(),
  NEXT_PUBLIC_FIREBASE_MESSAGING_SENDER_ID: z.string().optional(),
  NEXT_PUBLIC_FIREBASE_APP_ID: z.string().optional(),
  NEXT_PUBLIC_FIREBASE_MEASUREMENT_ID: z.string().optional(),
});

type ServerEnv = z.infer<typeof ServerEnvSchema> & { SOCKET_PORT_NUM: number };
type ClientEnv = z.infer<typeof ClientEnvSchema>;

export type AppConfig = {
  server: {
    nodeEnv: ServerEnv['NODE_ENV'];
    appBaseUrl: string;
    appOrigin: string;
    databaseUrl?: string;
    socketPort: number;
    firebase: {
      mode: 'adc' | 'service_account' | 'none';
      hasServiceAccountBase64: boolean;
      hasProjectId: boolean;
      hasClientEmail: boolean;
      hasPrivateKey: boolean;
    };
  };
  client: {
    apiBaseUrl: string;
    socketUrl: string;
  } & Pick<
    ClientEnv,
    | 'NEXT_PUBLIC_FIREBASE_API_KEY'
    | 'NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN'
    | 'NEXT_PUBLIC_FIREBASE_PROJECT_ID'
    | 'NEXT_PUBLIC_FIREBASE_STORAGE_BUCKET'
    | 'NEXT_PUBLIC_FIREBASE_MESSAGING_SENDER_ID'
    | 'NEXT_PUBLIC_FIREBASE_APP_ID'
    | 'NEXT_PUBLIC_FIREBASE_MEASUREMENT_ID'
  >;
  warnings: string[];
};

function buildConfig(): AppConfig {
  const serverParsed = ServerEnvSchema.safeParse(process.env);
  const clientParsed = ClientEnvSchema.safeParse(process.env);

  const warnings: string[] = [];
  if (!serverParsed.success) {
    warnings.push(
      `Server env parse warnings: ${serverParsed.error.issues
        .map((e: any) => `${e.path.join('.')}: ${e.message}`)
        .join('; ')}`
    );
  }
  if (!clientParsed.success) {
    warnings.push(
      `Client env parse warnings: ${clientParsed.error.issues
        .map((e: any) => `${e.path.join('.')}: ${e.message}`)
        .join('; ')}`
    );
  }

  const serverEnv = (serverParsed.success ? serverParsed.data : ({} as any)) as ServerEnv;
  const clientEnv = (clientParsed.success ? clientParsed.data : ({} as any)) as ClientEnv;

  // Determine Firebase mode
  const hasBase64 = Boolean(
    serverEnv.FIREBASE_SERVICE_ACCOUNT_JSON_BASE64 &&
    serverEnv.FIREBASE_SERVICE_ACCOUNT_JSON_BASE64.trim()
  );
  const hasTriple = Boolean(
    serverEnv.FIREBASE_PROJECT_ID &&
    serverEnv.FIREBASE_CLIENT_EMAIL &&
    serverEnv.FIREBASE_PRIVATE_KEY
  );
  const firebaseMode: 'adc' | 'service_account' | 'none' =
    hasBase64 || hasTriple ? 'service_account' : 'adc';

  const config: AppConfig = {
    server: {
      nodeEnv: serverEnv.NODE_ENV ?? 'development',
      appBaseUrl: serverEnv.APP_BASE_URL ?? 'http://localhost:3000',
      appOrigin: serverEnv.APP_ORIGIN ?? 'http://localhost:3000',
      databaseUrl: serverEnv.DATABASE_URL,
      socketPort: serverEnv.SOCKET_PORT_NUM ?? 3002,
      firebase: {
        mode: firebaseMode,
        hasServiceAccountBase64: hasBase64,
        hasProjectId: Boolean(serverEnv.FIREBASE_PROJECT_ID),
        hasClientEmail: Boolean(serverEnv.FIREBASE_CLIENT_EMAIL),
        hasPrivateKey: Boolean(serverEnv.FIREBASE_PRIVATE_KEY),
      },
    },
    client: {
      apiBaseUrl: clientEnv.NEXT_PUBLIC_API_BASE_URL ?? 'http://localhost:3000',
      socketUrl: clientEnv.NEXT_PUBLIC_SOCKET_URL ?? 'http://localhost:3002',
      NEXT_PUBLIC_FIREBASE_API_KEY: clientEnv.NEXT_PUBLIC_FIREBASE_API_KEY,
      NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN: clientEnv.NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN,
      NEXT_PUBLIC_FIREBASE_PROJECT_ID: clientEnv.NEXT_PUBLIC_FIREBASE_PROJECT_ID,
      NEXT_PUBLIC_FIREBASE_STORAGE_BUCKET: clientEnv.NEXT_PUBLIC_FIREBASE_STORAGE_BUCKET,
      NEXT_PUBLIC_FIREBASE_MESSAGING_SENDER_ID: clientEnv.NEXT_PUBLIC_FIREBASE_MESSAGING_SENDER_ID,
      NEXT_PUBLIC_FIREBASE_APP_ID: clientEnv.NEXT_PUBLIC_FIREBASE_APP_ID,
      NEXT_PUBLIC_FIREBASE_MEASUREMENT_ID: clientEnv.NEXT_PUBLIC_FIREBASE_MEASUREMENT_ID,
    },
    warnings,
  };

  // Production hard validation and fails
  if (config.server.nodeEnv === 'production') {
    const prodErrors: string[] = [];

    if (!config.server.databaseUrl) prodErrors.push('DATABASE_URL is required');

    // Require Firebase auth in production (ADC preferred, service_account acceptable)
    // In hosted environments with ADC, service account variables may be absent; that's fine.
    // If not on ADC, require service account credentials.
    if (config.server.firebase.mode === 'none') {
      prodErrors.push('Firebase ADC or service account credentials are required');
    }

    if (prodErrors.length) {
      throw new Error('Production environment misconfiguration: ' + prodErrors.join('; '));
    }
  }

  return config;
}

export const config = buildConfig();

export const serverConfig = config.server;
export const clientConfig = config.client;
export const configWarnings = config.warnings;
