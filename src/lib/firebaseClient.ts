import { initializeApp, getApps, getApp } from 'firebase/app';
import { getFirestore, connectFirestoreEmulator } from 'firebase/firestore';
import {
  getAuth,
  setPersistence,
  browserLocalPersistence,
  connectAuthEmulator,
} from 'firebase/auth';
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

// Initialize Firebase or create mock objects for development
let db: ReturnType<typeof getFirestore> | null = null;
let auth: ReturnType<typeof getAuth> | null = null;
let analytics: ReturnType<typeof getAnalytics> | null = null;

if (firebaseConfig.apiKey && firebaseConfig.projectId) {
  try {
    const app = getApps().length === 0 ? initializeApp(firebaseConfig) : getApp();
    db = getFirestore(app);
    auth = getAuth(app);
    // Ensure session persists across tabs/reloads for predictable UX
    try {
      void setPersistence(auth, browserLocalPersistence);
    } catch (e) {
      // Non-fatal; persistence may not be available in some environments
      console.warn('Failed to set Firebase auth persistence:', e);
    }

    if (typeof window !== 'undefined') {
      analytics = getAnalytics(app);
    }

    // Optional: connect to local emulators when enabled (development only)
    if (
      process.env.NODE_ENV !== 'production' &&
      process.env.NEXT_PUBLIC_USE_EMULATORS === 'true' &&
      db &&
      auth
    ) {
      const fsHost = process.env.NEXT_PUBLIC_FIRESTORE_EMULATOR_HOST ?? '127.0.0.1';
      const fsPort = Number(process.env.NEXT_PUBLIC_FIRESTORE_EMULATOR_PORT ?? '8080');
      const authUrl = process.env.NEXT_PUBLIC_FIREBASE_AUTH_EMULATOR_URL ?? 'http://127.0.0.1:9099';

      try {
        connectAuthEmulator(auth, authUrl, { disableWarnings: true });
      } catch {
        /* ignore already-connected/unsupported */
      }

      try {
        connectFirestoreEmulator(db, fsHost, fsPort);
      } catch {
        /* ignore already-connected/unsupported */
      }
    }

    // Ensure session persists across tabs/reloads for predictable UX
    setPersistence(auth!, browserLocalPersistence).catch((e) => {
      console.warn('Failed to set Firebase auth persistence:', e);
    });
  } catch (error) {
    console.warn('Firebase initialization failed:', error);
    // Continue with null values for development
  }
} else {
  console.warn('Firebase config is missing. Running without Firebase integration.');
}

export { db, auth, analytics };
