import 'server-only';
import admin from 'firebase-admin';
import { parseServiceAccountBase64 } from '../../firebaseHelpers';

if (!admin.apps.length) {
  const b64 = process.env.FIREBASE_SERVICE_ACCOUNT_JSON_BASE64;
  if (!b64) throw new Error('Missing FIREBASE_SERVICE_ACCOUNT_JSON_BASE64');

  const sa = parseServiceAccountBase64(b64);

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
