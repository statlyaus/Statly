import { getApp, getApps, initializeApp, type FirebaseApp } from 'firebase/app';
import { firebaseClientConfig, hasFirebaseClientConfig } from './clientConfig';

function getOrInitializeFirebaseApp(): FirebaseApp | null {
  if (!hasFirebaseClientConfig()) {
    console.warn('Firebase config is missing. Running without Firebase integration.');
    return null;
  }

  try {
    return getApps().length === 0 ? initializeApp(firebaseClientConfig) : getApp();
  } catch (error) {
    console.warn('Firebase app initialization failed:', error);
    return null;
  }
}

export const firebaseApp = getOrInitializeFirebaseApp();
