import 'server-only';
import admin from 'firebase-admin';
import { getServiceAccountFromEnv } from './serviceAccount';

if (!admin.apps.length) {
  const sa = getServiceAccountFromEnv();

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