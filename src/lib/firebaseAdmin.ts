// Hybrid Admin initializer: prefers base64 service account, falls back to ADC
import { getApps, initializeApp, applicationDefault, cert, type App } from 'firebase-admin/app';
import { getFirestore } from 'firebase-admin/firestore';
import { getAuth } from 'firebase-admin/auth';

import { getServiceAccountFromEnv } from './serviceAccount';

const FIREBASE_ADMIN_APP_NAME = 'statly-admin';
const SERVICE_ACCOUNT_PLACEHOLDERS = new Set(['YOUR_PRODUCTION_SERVICE_ACCOUNT_BASE64']);
const PROJECT_ID_PLACEHOLDERS = new Set(['your-production-project-id']);

let serviceAccountProjectId: string | undefined;
let credentialSource: 'base64' | 'adc' = 'adc';

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
  if (SERVICE_ACCOUNT_PLACEHOLDERS.has(process.env.FIREBASE_SERVICE_ACCOUNT_JSON_BASE64?.trim() ?? '')) {
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

const credential = resolveCredential();
const projectId = serviceAccountProjectId || projectIdFromEnv();

if (!projectId) {
  throw new Error(
    '[firebaseAdmin] Missing Firebase projectId. Set FIREBASE_SERVICE_ACCOUNT_JSON_BASE64 with project_id, or set GOOGLE_CLOUD_PROJECT / GCLOUD_PROJECT / NEXT_PUBLIC_FIREBASE_PROJECT_ID.'
  );
}

function getConfiguredAdminApp(): App {
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

const app: App = getConfiguredAdminApp();

const db = getFirestore(app);

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

// Back-compat exports used around the codebase
export const adminDb = db;
export const adminAuth = getAuth(app);
// Backwards-compatible alias for legacy imports expecting { db }
export { db };
