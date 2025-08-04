// lib/firebaseAdmin.ts
import { initializeApp, cert, getApps, getApp } from 'firebase-admin/app';
import { getFirestore, Firestore } from 'firebase-admin/firestore';

const firebaseAdminConfig = {
  projectId: process.env.FIREBASE_PROJECT_ID,
  clientEmail: process.env.FIREBASE_CLIENT_EMAIL,
  privateKey: process.env.FIREBASE_PRIVATE_KEY?.replace(/\\n/g, '\n'),
};

let adminDb: Firestore | undefined;

if (
  firebaseAdminConfig.projectId &&
  firebaseAdminConfig.clientEmail &&
  firebaseAdminConfig.privateKey
) {
  const app = getApps().length
    ? getApp()
    : initializeApp({
        credential: cert(firebaseAdminConfig),
      });

  adminDb = getFirestore(app);
} else {
  console.warn('Missing Firebase Admin environment variables');
}

export { adminDb };

