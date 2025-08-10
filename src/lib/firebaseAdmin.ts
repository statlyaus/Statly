import 'server-only';
import admin from 'firebase-admin';
import { decodeServiceAccount } from './serviceAccount';

if (!admin.apps.length) {
  const encoded = process.env.FIREBASE_SERVICE_ACCOUNT_JSON_BASE64;
  if (!encoded) throw new Error('Missing FIREBASE_SERVICE_ACCOUNT_JSON_BASE64');

  const sa = decodeServiceAccount(encoded);

  admin.initializeApp({
    credential: admin.credential.cert({
      projectId: sa.project_id,
      clientEmail: sa.client_email,
      privateKey: sa.private_key,
    }),
    projectId: sa.project_id,
  });
}

export const adminDb = admin.firestore();