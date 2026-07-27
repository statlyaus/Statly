// Hybrid Admin initializer: prefers base64 service account, falls back to ADC
import {
  getApps,
  initializeApp,
  applicationDefault,
  cert,
  type App,
  type Credential,
} from 'firebase-admin/app';
import { getFirestore, type Firestore } from 'firebase-admin/firestore';
import { getAuth, type Auth } from 'firebase-admin/auth';

import { getServiceAccountFromEnv } from './serviceAccount';

const FIREBASE_ADMIN_APP_NAME = 'statly-admin';
const SERVICE_ACCOUNT_PLACEHOLDERS = new Set(['YOUR_PRODUCTION_SERVICE_ACCOUNT_BASE64']);
const PROJECT_ID_PLACEHOLDERS = new Set(['your-production-project-id']);

let serviceAccountProjectId: string | undefined;
let credentialSource: 'base64' | 'adc' = 'adc';

export function firebaseAdminIsDisabled(): boolean {
  return process.env.FIREBASE_ADMIN_DISABLED?.trim().toLowerCase() === 'true';
}

function createDisabledService<T extends object>(serviceName: string): T {
  return new Proxy({} as T, {
    get(_target, property) {
      if (property === 'then') return undefined;

      return () => {
        throw new Error(
          `[firebaseAdmin] ${serviceName} operation "${String(property)}" is unavailable because Firebase Admin integration is disabled.`
        );
      };
    },
  });
}

function hasServiceAccountCredential(value: string | undefined): boolean {
  const trimmed = value?.trim();
  return Boolean(trimmed && !SERVICE_ACCOUNT_PLACEHOLDERS.has(trimmed));
}

function projectIdFromEnv(): string | undefined {
  const configured =
    process.env.GOOGLE_CLOUD_PROJECT ||
    process.env.GCLOUD_PROJECT ||
    process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID;
  if (configured && !PROJECT_ID_PLACEHOLDERS.has(configured)) {
    return configured;
  }
  if (
    SERVICE_ACCOUNT_PLACEHOLDERS.has(process.env.FIREBASE_SERVICE_ACCOUNT_JSON_BASE64?.trim() ?? '')
  ) {
    return 'your-production-project-id';
  }
  return undefined;
}

function resolveCredential() {
  const b64 = process.env.FIREBASE_SERVICE_ACCOUNT_JSON_BASE64;
  const usingB64 = hasServiceAccountCredential(b64);
  if (usingB64) {
    const serviceAccount = getServiceAccountFromEnv();
    serviceAccountProjectId = serviceAccount.projectId;
    credentialSource = 'base64';
    console.log(
      '[firebaseAdmin] Using service account credential from env (base64). Project:',
      serviceAccountProjectId
    );
    return cert(serviceAccount);
  }
  credentialSource = 'adc';
  console.log('[firebaseAdmin] Using application default credentials (ADC).');
  return applicationDefault();
}

function getConfiguredAdminApp(credential: Credential, projectId: string): App {
  const existing = getApps().find((candidate) => candidate.name === FIREBASE_ADMIN_APP_NAME);
  if (existing) {
    return existing;
  }

  return initializeApp(
    {
      credential,
      projectId,
    },
    FIREBASE_ADMIN_APP_NAME
  );
}

let db: Firestore;
let auth: Auth;

if (firebaseAdminIsDisabled()) {
  console.log('[firebaseAdmin] Firebase Admin integration is disabled.');
  db = createDisabledService<Firestore>('Firestore');
  auth = createDisabledService<Auth>('Auth');
} else {
  const credential = resolveCredential();
  const projectId = serviceAccountProjectId || projectIdFromEnv();

  if (!projectId) {
    throw new Error(
      '[firebaseAdmin] Missing Firebase projectId. Set FIREBASE_SERVICE_ACCOUNT_JSON_BASE64 with project_id, or set GOOGLE_CLOUD_PROJECT / GCLOUD_PROJECT / NEXT_PUBLIC_FIREBASE_PROJECT_ID.'
    );
  }

  const app = getConfiguredAdminApp(credential, projectId);

  db = getFirestore(app);
  auth = getAuth(app);

  try {
    const opts = (app as unknown as { options?: { projectId?: string } })?.options;
    console.log(
      '[firebaseAdmin] Firestore initialized. Project:',
      opts?.projectId || projectId,
      '| Credential:',
      credentialSource
    );
  } catch (e) {
    console.warn('[firebaseAdmin] Could not log project debug info:', e);
  }
}

// Back-compat exports used around the codebase
export const adminDb = db;
export const adminAuth = auth;
// Backwards-compatible alias for legacy imports expecting { db }
export { db };
