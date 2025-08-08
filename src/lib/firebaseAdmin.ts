// src/lib/firebaseAdmin.ts
import 'server-only';
import { cert, getApps, initializeApp, getApp } from 'firebase-admin/app';
import { getFirestore } from 'firebase-admin/firestore';

type ServiceAccount = {
  private_key?: string;
  project_id?: string;
  client_email?: string;
  [key: string]: unknown;
};

function readServiceAccount(): ServiceAccount {
  const raw = process.env.FIREBASE_SERVICE_ACCOUNT_JSON;
  if (!raw) {
    throw new Error(
      'FIREBASE_SERVICE_ACCOUNT_JSON is not set. Add it to .env.local and restart the server.'
    );
  }

  // Some env setups keep the outer single quotes; strip if present
  const maybeStripped = raw.replace(/^\s*'|'\s*$/g, '');

  let parsed: ServiceAccount;
  try {
    parsed = JSON.parse(maybeStripped) as ServiceAccount;
  } catch {
    throw new Error('FIREBASE_SERVICE_ACCOUNT_JSON is not valid JSON. Check quoting/escaping.');
  }

  if (!parsed.private_key || !parsed.project_id || !parsed.client_email) {
    throw new Error(
      'FIREBASE_SERVICE_ACCOUNT_JSON missing one of required fields: private_key, project_id, client_email.'
    );
  }

  // Normalize escaped newlines
  parsed.private_key = parsed.private_key.replace(/\\n/g, '\n');

  if (process.env.NODE_ENV !== 'production') {
    // Safe debug (no secrets)
    console.log(
      `[Firebase Admin] Init for project "${parsed.project_id}" using service account "${parsed.client_email}"`
    );
  }

  return parsed;
}

const sa = readServiceAccount();

const app =
  getApps().length === 0
    ? initializeApp({ credential: cert(sa as any) })
    : getApp();

export const adminDb = getFirestore(app);