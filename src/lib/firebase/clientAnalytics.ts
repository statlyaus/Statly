import type { Analytics } from 'firebase/analytics';
import { firebaseApp } from './clientApp';
import { firebaseClientConfig, useFirebaseEmulators } from './clientConfig';

let analyticsPromise: Promise<Analytics | null> | null = null;

export function initializeFirebaseAnalytics(): Promise<Analytics | null> {
  if (
    typeof window === 'undefined' ||
    !firebaseApp ||
    !firebaseClientConfig.measurementId ||
    useFirebaseEmulators
  ) {
    return Promise.resolve(null);
  }

  const app = firebaseApp;
  analyticsPromise ??= import('firebase/analytics')
    .then(async ({ getAnalytics, isSupported }) => {
      if (!(await isSupported())) return null;
      return getAnalytics(app);
    })
    .catch((error: unknown) => {
      console.warn('Firebase Analytics initialization failed:', error);
      return null;
    });

  return analyticsPromise;
}
