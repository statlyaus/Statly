import {
  browserLocalPersistence,
  browserPopupRedirectResolver,
  connectAuthEmulator,
  getAuth,
  indexedDBLocalPersistence,
  initializeAuth,
  type Auth,
} from 'firebase/auth';
import { firebaseApp } from './clientApp';
import { useFirebaseEmulators } from './clientConfig';

function getOrInitializeAuth(): Auth | null {
  if (!firebaseApp) return null;

  try {
    if (typeof window === 'undefined') {
      return getAuth(firebaseApp);
    }

    try {
      return initializeAuth(firebaseApp, {
        persistence: [indexedDBLocalPersistence, browserLocalPersistence],
        popupRedirectResolver: browserPopupRedirectResolver,
      });
    } catch (error) {
      if (
        typeof error === 'object' &&
        error !== null &&
        'code' in error &&
        error.code === 'auth/already-initialized'
      ) {
        return getAuth(firebaseApp);
      }

      throw error;
    }
  } catch (error) {
    console.warn('Firebase Auth initialization failed:', error);
    return null;
  }
}

function connectConfiguredAuthEmulator(authInstance: Auth | null): Auth | null {
  if (!useFirebaseEmulators || !authInstance) return authInstance;

  const authUrl =
    process.env.NEXT_PUBLIC_FIREBASE_AUTH_EMULATOR_URL ?? 'http://127.0.0.1:9099';

  try {
    if (!authInstance.emulatorConfig) {
      connectAuthEmulator(authInstance, authUrl, { disableWarnings: true });
    }
    return authInstance;
  } catch (error) {
    console.error('Firebase Auth emulator connection failed; disabling client auth.', error);
    return null;
  }
}

export const auth = connectConfiguredAuthEmulator(getOrInitializeAuth());

// Emulator connection is synchronous. This promise preserves the existing caller contract and makes
// the ordering explicit for auth listeners and sign-in commands.
export const authEmulatorReady: Promise<void> = Promise.resolve();
