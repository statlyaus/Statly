// src/lib/firebaseClient.ts
// Client-side Firebase Web SDK singleton.
// Works with real web keys OR falls back to emulators in development
// when NEXT_PUBLIC_USE_EMULATORS=true or required NEXT_PUBLIC_* keys are missing.

import { getApp, getApps, initializeApp, type FirebaseApp } from 'firebase/app';
import {
  getAuth,
  type Auth,
  connectAuthEmulator,
  browserLocalPersistence,
  setPersistence,
} from 'firebase/auth';
import {
  getFirestore,
  type Firestore,
  connectFirestoreEmulator,
} from 'firebase/firestore';

function shouldUseEmulators(missingKeys: string[]): boolean {
  if (process.env.NEXT_PUBLIC_USE_EMULATORS === 'true') return true;
  // Auto-fallback in development if keys are missing
  return process.env.NODE_ENV !== 'production' && missingKeys.length > 0;
}

function getConfig() {
  const cfg = {
    apiKey: process.env.NEXT_PUBLIC_FIREBASE_API_KEY,
    authDomain: process.env.NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN,
    projectId: process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID,
    appId: process.env.NEXT_PUBLIC_FIREBASE_APP_ID,
    storageBucket: process.env.NEXT_PUBLIC_FIREBASE_STORAGE_BUCKET,
    messagingSenderId: process.env.NEXT_PUBLIC_FIREBASE_MESSAGING_SENDER_ID,
    measurementId: process.env.NEXT_PUBLIC_FIREBASE_MEASUREMENT_ID,
  };

  const missing: string[] = [];
  if (!cfg.apiKey) missing.push('NEXT_PUBLIC_FIREBASE_API_KEY');
  if (!cfg.authDomain) missing.push('NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN');
  if (!cfg.projectId) missing.push('NEXT_PUBLIC_FIREBASE_PROJECT_ID');
  if (!cfg.appId) missing.push('NEXT_PUBLIC_FIREBASE_APP_ID');

  const usingEmulators = shouldUseEmulators(missing);

  if (usingEmulators) {
    if (process.env.NODE_ENV !== 'production') {
      console.info('[firebaseClient] Using Firebase Emulators (auth@127.0.0.1:9099, firestore@127.0.0.1:8080).');
      if (missing.length) {
        console.warn('[firebaseClient] Missing keys in dev; falling back to emulators:', missing.join(', '));
      }
    }
    return {
      apiKey: cfg.apiKey || 'fake-emulator-key',
      authDomain: cfg.authDomain || 'localhost',
      projectId: cfg.projectId || 'demo-emulator',
      appId: cfg.appId || 'demo-app',
      storageBucket: cfg.storageBucket,
      messagingSenderId: cfg.messagingSenderId,
      measurementId: cfg.measurementId,
    } as const;
  }

  if (missing.length) {
    const msg =
      `[firebaseClient] Missing required env(s): ${missing.join(', ')}. ` +
      `Add them to .env.local or your hosting env, or set NEXT_PUBLIC_USE_EMULATORS=true.`;
    // Surface a readable error in dev; throw so you notice immediately.
    if (process.env.NODE_ENV !== 'production') {
      console.error(msg);
    }
    throw new Error(msg);
  }

  return cfg;
}

const config = getConfig();
export const USING_EMULATORS = shouldUseEmulators([
  config.apiKey ? '' : 'NEXT_PUBLIC_FIREBASE_API_KEY',
  config.authDomain ? '' : 'NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN',
  config.projectId ? '' : 'NEXT_PUBLIC_FIREBASE_PROJECT_ID',
  config.appId ? '' : 'NEXT_PUBLIC_FIREBASE_APP_ID',
].filter(Boolean));

export const app: FirebaseApp = getApps().length ? getApp() : initializeApp(config);

export const auth: Auth = getAuth(app);
export const db: Firestore = getFirestore(app);

// IMPORTANT: connect emulators *immediately* so the first auth listener
// doesn’t hit Google endpoints and trip invalid-api-key.
if (USING_EMULATORS) {
  try {
    connectAuthEmulator(auth, 'http://127.0.0.1:9099', { disableWarnings: true });
  } catch {}
  try {
    connectFirestoreEmulator(db, '127.0.0.1', 8080);
  } catch {}
}

// Keep auth state in local storage for SPA experience; don’t block if it fails.
void setPersistence(auth, browserLocalPersistence).catch(() => {});