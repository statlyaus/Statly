import { cert, getApps, initializeApp, getApp } from 'firebase-admin/app';
import { getFirestore } from 'firebase-admin/firestore';

const serviceAccountJson = process.env.FIREBASE_SERVICE_ACCOUNT_JSON;

if (!serviceAccountJson) {
  throw new Error(
    'FIREBASE_SERVICE_ACCOUNT_JSON is not set. This is required for server-side Firebase operations. Please add it to your .env.local file and restart the server.'
  );
}

const serviceAccount = JSON.parse(serviceAccountJson);

const app =
  getApps().length === 0
    ? initializeApp({ credential: cert(serviceAccount) })
    : getApp();

const adminDb = getFirestore(app);

export { adminDb };