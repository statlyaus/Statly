import { cert, getApps, initializeApp, getApp } from 'firebase-admin/app';
import { getFirestore } from 'firebase-admin/firestore';

let adminDb: ReturnType<typeof getFirestore> | null = null;

try {
  const serviceAccountJson = process.env.FIREBASE_SERVICE_ACCOUNT_JSON;

  if (!serviceAccountJson) {
    throw new Error(
      'FIREBASE_SERVICE_ACCOUNT_JSON is not set. This is required for server-side Firebase operations. Please add it to your .env.local file.'
    );
  }

  const serviceAccount = JSON.parse(serviceAccountJson);

  const app =
    getApps().length === 0
      ? initializeApp({ credential: cert(serviceAccount) })
      : getApp();

  adminDb = getFirestore(app);
} catch (error) {
  console.error('Firebase Admin SDK initialization error:', error);
  // When initialization fails, adminDb will be null.
  // Code using adminDb (like in your player pages) should handle this case.
}

export { adminDb };