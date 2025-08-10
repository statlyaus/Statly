import 'server-only';
import admin from 'firebase-admin';
import { getServiceAccountFromEnv } from './serviceAccount';

if (!admin.apps.length) {
  const sa = getServiceAccountFromEnv();

  admin.initializeApp({
    credential: admin.credential.cert(sa),
    projectId: sa.projectId,
  });
}

export const adminDb = admin.firestore();