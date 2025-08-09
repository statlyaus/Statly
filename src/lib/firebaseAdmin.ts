import 'server-only';
import admin from 'firebase-admin';

if (!admin.apps.length) {
  const b64 = process.env.FIREBASE_SERVICE_ACCOUNT_JSON_BASE64;
  if (!b64) throw new Error('Missing FIREBASE_SERVICE_ACCOUNT_JSON_BASE64');

  const json = Buffer.from(b64, 'base64').toString('utf-8');
  const sa = JSON.parse(json) as {
    project_id: string; client_email: string; private_key: string;
  };

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