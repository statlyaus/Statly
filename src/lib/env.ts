import 'server-only';
import { z } from 'zod';

// Shared literals
const truthy = z.literal('true');
const falsy = z.literal('false');

// Client-side, public env (validated lazily at runtime)
const ClientEnvSchema = z.object({
  NEXT_PUBLIC_FIREBASE_API_KEY: z.string().min(1, 'NEXT_PUBLIC_FIREBASE_API_KEY is required'),
  NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN: z.string().min(1, 'NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN is required'),
  NEXT_PUBLIC_FIREBASE_PROJECT_ID: z.string().min(1, 'NEXT_PUBLIC_FIREBASE_PROJECT_ID is required'),
  NEXT_PUBLIC_FIREBASE_STORAGE_BUCKET: z.string().min(1).optional(),
  NEXT_PUBLIC_FIREBASE_MESSAGING_SENDER_ID: z.string().min(1).optional(),
  NEXT_PUBLIC_FIREBASE_APP_ID: z.string().min(1, 'NEXT_PUBLIC_FIREBASE_APP_ID is required'),

  // Emulator toggles and hosts
  NEXT_PUBLIC_USE_EMULATORS: z.union([truthy, falsy]).default('false'),
  NEXT_PUBLIC_FIRESTORE_EMULATOR_HOST: z.string().default('localhost:8081'),
  NEXT_PUBLIC_AUTH_EMULATOR_HOST: z.string().default('http://localhost:9099'),
});

// Server-side, secret env (validated lazily at runtime in getServerEnv)
const ServerEnvSchema = z.object({
  FIREBASE_SERVICE_ACCOUNT_JSON_BASE64: z.string().min(1).optional(),
  GOOGLE_CLOUD_PROJECT: z.string().min(1).optional(),
});

// Decode and validate the service account JSON from base64
function decodeServiceAccount(b64: string) {
  let raw: string;
  try {
    raw = Buffer.from(b64, 'base64').toString('utf8');
  } catch (e) {
    const reason = e instanceof Error ? e.message : String(e);
    throw new Error(`Failed to decode FIREBASE_SERVICE_ACCOUNT_JSON_BASE64: ${reason}`);
  }
  let parsed: any;
  try {
    parsed = JSON.parse(raw);
  } catch (e) {
    const reason = e instanceof Error ? e.message : String(e);
    throw new Error(`FIREBASE_SERVICE_ACCOUNT_JSON_BASE64 is not valid JSON: ${reason}`);
  }

  const SARequired = z.object({
    project_id: z.string().min(1),
    client_email: z.string().email(),
    private_key: z.string().min(1),
  });
  const normalized = {
    project_id: parsed.project_id ?? parsed.projectId,
    client_email: parsed.client_email ?? parsed.clientEmail,
    private_key: parsed.private_key ?? parsed.privateKey,
  };
  const sa = SARequired.parse(normalized);
  return sa;
}

let cachedClientEnv: Readonly<z.infer<typeof ClientEnvSchema>> | null = null;
export function getClientEnv() {
  if (cachedClientEnv) return cachedClientEnv;
  const parsed = ClientEnvSchema.parse(process.env);
  cachedClientEnv = Object.freeze(parsed);
  return cachedClientEnv;
}

type ServerEnv = z.infer<typeof ServerEnvSchema> & {
  serviceAccount?: { project_id: string; client_email: string; private_key: string };
};

let cachedServerEnv: Readonly<ServerEnv> | null = null;
export function getServerEnv() {
  if (cachedServerEnv) return cachedServerEnv;
  const base = ServerEnvSchema.parse(process.env);

  let serviceAccount: ServerEnv['serviceAccount'] | undefined;
  if (base.FIREBASE_SERVICE_ACCOUNT_JSON_BASE64) {
    serviceAccount = decodeServiceAccount(base.FIREBASE_SERVICE_ACCOUNT_JSON_BASE64);
  }

  const out: ServerEnv = { ...base, serviceAccount };
  cachedServerEnv = Object.freeze(out);
  return cachedServerEnv;
}

export function isEmulatorEnabled(): boolean {
  return (process.env.NEXT_PUBLIC_USE_EMULATORS || 'false') === 'true';
}

// Deprecation: prefer private server emulator hosts over public ones
let warnedEmuHost = false;
export function getPreferredEmulatorHosts() {
  const fsHost = process.env.FIRESTORE_EMULATOR_HOST || process.env.NEXT_PUBLIC_FIRESTORE_EMULATOR_HOST;
  const authHost = process.env.FIREBASE_AUTH_EMULATOR_HOST || process.env.NEXT_PUBLIC_AUTH_EMULATOR_HOST;
  if (!warnedEmuHost && typeof window === 'undefined') {
    if (!process.env.FIRESTORE_EMULATOR_HOST && process.env.NEXT_PUBLIC_FIRESTORE_EMULATOR_HOST) {
      console.warn('[env] Using public NEXT_PUBLIC_FIRESTORE_EMULATOR_HOST on server. Prefer FIRESTORE_EMULATOR_HOST.');
      warnedEmuHost = true;
    }
    if (!process.env.FIREBASE_AUTH_EMULATOR_HOST && process.env.NEXT_PUBLIC_AUTH_EMULATOR_HOST) {
      console.warn('[env] Using public NEXT_PUBLIC_AUTH_EMULATOR_HOST on server. Prefer FIREBASE_AUTH_EMULATOR_HOST.');
      warnedEmuHost = true;
    }
  }
  return { firestore: fsHost, auth: authHost };
}

// Maintain legacy default export for any existing consumers
export const env = { ...process.env } as Record<string, string | undefined>;

// Test-only exports
export const __TESTING__ = {
  decodeServiceAccount,
};
