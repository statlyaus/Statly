// src/lib/firebaseAdmin.ts
import 'server-only';
import { cert, getApps, initializeApp, getApp } from 'firebase-admin/app';
import { getFirestore } from 'firebase-admin/firestore';

type ServiceAccountRaw = {
  project_id?: string;
  client_email?: string;
  private_key?: string;
  [k: string]: unknown;
};

type ServiceAccountClean = {
  projectId: string;
  clientEmail: string;
  privateKey: string;
};

function fromEnv(): ServiceAccountClean {
  const b64 = process.env.FIREBASE_SERVICE_ACCOUNT_JSON_BASE64 ?? '';
  const json = b64 ? Buffer.from(b64, 'base64').toString('utf8') : process.env.FIREBASE_SERVICE_ACCOUNT_JSON ?? '';

  if (!json) {
    throw new Error('Missing Firebase Admin creds. Set FIREBASE_SERVICE_ACCOUNT_JSON_BASE64 (preferred) or FIREBASE_SERVICE_ACCOUNT_JSON.');
  }

  let parsed: ServiceAccountRaw;
  try {
    parsed = JSON.parse(json) as ServiceAccountRaw;
  } catch {
    throw new Error('Service account JSON is not valid JSON (bad base64 or quoting).');
  }

  const projectId = parsed.project_id ?? '';
  const clientEmail = parsed.client_email ?? '';
  // normalise \n
  const privateKey = (parsed.private_key ?? '').replace(/\\n/g, '\n');

  if (!projectId || !clientEmail || !privateKey) {
    throw new Error('Service account JSON missing project_id, client_email or private_key.');
  }

  if (process.env.NODE_ENV !== 'production') {
    console.log(`[Firebase Admin] Using project "${projectId}" with account "${clientEmail}"`);
  }

  return { projectId, clientEmail, privateKey };
}

const credentials = fromEnv();

const app =
  getApps().length === 0
    ? initializeApp({ credential: cert(credentials) })
    : getApp();

export const adminDb = getFirestore(app);