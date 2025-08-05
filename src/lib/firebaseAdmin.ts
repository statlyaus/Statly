import { initializeApp, cert, getApps, getApp, ServiceAccount } from 'firebase-admin/app';
import { getFirestore } from 'firebase-admin/firestore';

let adminDb: ReturnType<typeof getFirestore> | null = null;

try {
  // Best practice: Use an environment variable for the service account key.
  // This prevents committing sensitive credentials to version control.
  const serviceAccountString = process.env.FIREBASE_SERVICE_ACCOUNT_KEY;
  if (!serviceAccountString) {
    throw new Error('FIREBASE_SERVICE_ACCOUNT_KEY environment variable is not set.');
  }

  const serviceAccount: ServiceAccount = JSON.parse(serviceAccountString);

  if (!getApps().length) {
    initializeApp({
      credential: cert(serviceAccount),
    });
  }

  adminDb = getFirestore(getApp());
} catch (error) {
  console.error('Firebase Admin SDK initialization failed:', error);
  // The consuming code checks if adminDb is null, so this prevents server crashes.
}

export { adminDb };