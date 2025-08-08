// src/lib/firebaseAdmin.ts
import 'server-only';
import {
  cert,
  getApps,
  initializeApp,
  getApp,
  type ServiceAccount as AdminServiceAccount,
} from 'firebase-admin/app';
import { getFirestore } from 'firebase-admin/firestore';

/**
 * Raw Google JSON shape (snake_case) when using FIREBASE_SERVICE_ACCOUNT_JSON.
 */
type ParsedServiceAccountJson = {
  project_id?: string;
  client_email?: string;
  private_key?: string;
  [key: string]: unknown;
};

function normalizePrivateKey(key: string | undefined): string {
  if (!key) return '';
  // Convert "\n" to real newlines
  return key.includes('\\n') ? key.replace(/\\n/g, '\n') : key;
}

function decodeBase64(value: string | undefined): string {
  if (!value) return '';
  return Buffer.from(value, 'base64').toString('utf8');
}

/**
 * Prefer FIREBASE_SERVICE_ACCOUNT_JSON, otherwise fall back to
 * FIREBASE_PROJECT_ID / FIREBASE_CLIENT_EMAIL / FIREBASE_PRIVATE_KEY(_BASE64)
 */
function readAdminCredentials(): AdminServiceAccount {
  const rawJson = process.env.FIREBASE_SERVICE_ACCOUNT_JSON;

  if (rawJson) {
    // Some setups wrap the JSON in single quotes; strip them if present.
    const stripped = rawJson.replace(/^\s*'|'\s*$/g, '');
    let parsed: ParsedServiceAccountJson;
    try {
      parsed = JSON.parse(stripped) as ParsedServiceAccountJson;
    } catch {
      throw new Error('FIREBASE_SERVICE_ACCOUNT_JSON is not valid JSON. Check quoting/escaping.');
    }

    const projectId = parsed.project_id ?? '';
    const clientEmail = parsed.client_email ?? '';
    const privateKey = normalizePrivateKey(parsed.private_key);

    if (!projectId || !clientEmail || !privateKey) {
      throw new Error(
        'FIREBASE_SERVICE_ACCOUNT_JSON missing required fields: project_id, client_email, private_key.'
      );
    }

    if (process.env.NODE_ENV !== 'production') {
      // Safe debug (no secrets)
      console.log(
        `[Firebase Admin] Init via SERVICE_ACCOUNT_JSON for project "${projectId}" using "${clientEmail}"`
      );
    }

    const cred: AdminServiceAccount = { projectId, clientEmail, privateKey };
    return cred;
  }

  // Fallback: explicit env vars
  const projectId = process.env.FIREBASE_PROJECT_ID ?? '';
  const clientEmail = process.env.FIREBASE_CLIENT_EMAIL ?? '';
  const privateKeyBase64 = process.env.FIREBASE_PRIVATE_KEY_BASE64 ?? '';
  const privateKeyRaw = process.env.FIREBASE_PRIVATE_KEY ?? '';

  const privateKey = privateKeyBase64
    ? decodeBase64(privateKeyBase64)
    : normalizePrivateKey(privateKeyRaw);

  if (!projectId || !clientEmail || !privateKey) {
    throw new Error(
      'Firebase Admin not configured. Provide FIREBASE_SERVICE_ACCOUNT_JSON or FIREBASE_PROJECT_ID/FIREBASE_CLIENT_EMAIL/FIREBASE_PRIVATE_KEY(_BASE64).'
    );
  }

  if (process.env.NODE_ENV !== 'production') {
    console.log(`[Firebase Admin] Init via env triplet for project "${projectId}" using "${clientEmail}"`);
  }

  const cred: AdminServiceAccount = { projectId, clientEmail, privateKey };
  return cred;
}

const credentials = readAdminCredentials();

const app =
  getApps().length === 0
    ? initializeApp({ credential: cert(credentials) })
    : getApp();

export const adminDb = getFirestore(app);