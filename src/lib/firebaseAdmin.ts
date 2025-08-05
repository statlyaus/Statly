import { initializeApp, cert, getApps, getApp } from 'firebase-admin/app';
import { getFirestore } from 'firebase-admin/firestore';
import { readFileSync } from 'fs';
import path from 'path';

let db: ReturnType<typeof getFirestore>;

try {
  const serviceAccountPath = process.env.GOOGLE_APPLICATION_CREDENTIALS;

  if (!serviceAccountPath) {
    console.warn(
      'WARNING: GOOGLE_APPLICATION_CREDENTIALS environment variable not set. Firebase Admin SDK is not initialized. Server-side Firebase features will be unavailable.'
    );
  } else {
    const serviceAccount = JSON.parse(readFileSync(path.resolve(serviceAccountPath), 'utf8'));

    const app = getApps().length
      ? getApp()
      : initializeApp({ credential: cert(serviceAccount) });

    db = getFirestore(app);
  }
} catch (error) {
  console.error('FATAL: Failed to initialize Firebase Admin SDK. Please check your service account credentials.', error);
}

export { db };