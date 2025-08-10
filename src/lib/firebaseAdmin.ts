import 'server-only';
import admin from 'firebase-admin';
import { env } from '@/lib/env';

if (!admin.apps.length) {
  const json = Buffer.from(
    env.FIREBASE_SERVICE_ACCOUNT_JSON_BASE64,
    'base64'
  ).toString('utf-8');
  const sa = JSON.parse(json) as {
    project_id: string;
    client_email: string;
    private_key: string;
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
export const adminAuth = admin.auth();
