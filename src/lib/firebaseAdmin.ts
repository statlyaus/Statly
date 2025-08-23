// Best-effort: mark as server-only in Next.js; ignore if package is unavailable in non-Next runtimes.
void import('server-only').catch(() => undefined);
import admin from 'firebase-admin';
import { env } from '@/lib/env';

if (!admin.apps.length) {
  const json = Buffer.from(env.FIREBASE_SERVICE_ACCOUNT_JSON_BASE64, 'base64').toString('utf-8');
  const sa = JSON.parse(json) as {
    project_id: string;
    client_email: string;
    private_key: string;
  };

  // Ensure private key newlines are correctly formatted when coming from env/base64
  const privateKey = sa.private_key.includes('\\n') ? sa.private_key.replace(/\\n/g, '\n') : sa.private_key;

  admin.initializeApp({
    credential: admin.credential.cert({
      projectId: sa.project_id,
      clientEmail: sa.client_email,
      privateKey,
    }),
    projectId: sa.project_id,
  });
}

export const adminDb = admin.firestore();
export const adminAuth = admin.auth();
