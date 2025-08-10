import { initializeApp, getApps, getApp } from 'firebase/app';
import { getFirestore } from 'firebase/firestore';
import { getAuth } from 'firebase/auth';
import { getAnalytics } from 'firebase/analytics';

const firebaseConfig = {
  apiKey: process.env.NEXT_PUBLIC_FIREBASE_API_KEY,
  authDomain: process.env.NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN,
  projectId: process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID,
  storageBucket: process.env.NEXT_PUBLIC_FIREBASE_STORAGE_BUCKET,
  messagingSenderId: process.env.NEXT_PUBLIC_FIREBASE_MESSAGING_SENDER_ID,
  appId: process.env.NEXT_PUBLIC_FIREBASE_APP_ID,
  measurementId: process.env.NEXT_PUBLIC_FIREBASE_MEASUREMENT_ID,
};
// In development, it's helpful to see if the keys are loaded, but avoid logging the actual keys.
if (process.env.NODE_ENV === 'development') {
  console.log('Firebase keys loaded:', {
    apiKey: !!firebaseConfig.apiKey,
    projectId: !!firebaseConfig.projectId,
    measurementId: !!firebaseConfig.measurementId,
  });
}

if (!firebaseConfig.apiKey || !firebaseConfig.projectId) {
  console.error('Missing Firebase env config:', firebaseConfig);
  throw new Error(
    'Firebase config is missing. Ensure .env.local is properly set and restart your dev server.'
  );
}

const app = getApps().length === 0 ? initializeApp(firebaseConfig) : getApp();
const db = getFirestore(app);
const auth = getAuth(app);
let analytics: ReturnType<typeof getAnalytics> | null = null;

if (typeof window !== 'undefined') {
  analytics = getAnalytics(app);
}

export { db, auth, analytics };
