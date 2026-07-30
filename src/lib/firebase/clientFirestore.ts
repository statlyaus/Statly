import {
  connectFirestoreEmulator,
  getFirestore,
  type Firestore,
} from 'firebase/firestore';
import { firebaseApp } from './clientApp';
import { useFirebaseEmulators } from './clientConfig';

function getOrInitializeFirestore(): Firestore | null {
  if (!firebaseApp) return null;

  try {
    const firestore = getFirestore(firebaseApp);

    if (useFirebaseEmulators) {
      const host = process.env.NEXT_PUBLIC_FIRESTORE_EMULATOR_HOST ?? '127.0.0.1';
      const port = Number(process.env.NEXT_PUBLIC_FIRESTORE_EMULATOR_PORT ?? '8080');

      try {
        connectFirestoreEmulator(firestore, host, port);
      } catch {
        // Hot reload can re-evaluate this module after Firestore has already been configured.
      }
    }

    return firestore;
  } catch (error) {
    console.warn('Firebase Firestore initialization failed:', error);
    return null;
  }
}

export const db = getOrInitializeFirestore();
