// src/lib/firebaseClient.ts
// Long-term safe: Client-only Firebase Web SDK singleton.
// - Never initializes on the server
// - Validates NEXT_PUBLIC_* only in the browser
// - Preserves named exports (app, auth, db) via lazy proxies
// - If accessed on the server, throws a clear error instructing to use firebaseAdmin

import { getClientEnv } from '@/lib/envClient';
import { parseHostPort, DEFAULTS } from '@/lib/firebaseEmulator';
import { info, time, timeEnd } from '@/lib/logger';

import { getApp, getApps, initializeApp, type FirebaseApp } from 'firebase/app';
import {
  browserLocalPersistence,
  connectAuthEmulator,
  getAuth,
  setPersistence,
  type Auth,
} from 'firebase/auth';
import { connectFirestoreEmulator, getFirestore, type Firestore } from 'firebase/firestore';

let _app: FirebaseApp | null = null;
let _auth: Auth | null = null;
let _db: Firestore | null = null;
let _authEmuConnected = false;
let _dbEmuConnected = false;
let _warnedOptionalEnv = false;

function assertBrowserEnv() {
  if (typeof window === 'undefined') {
    throw new Error(
      '[firebaseClient] Called on the server. Use the Admin SDK (import { adminDb } from "@/lib/firebaseAdmin").'
    );
  }
  // Validate client env (throws helpful error if invalid)
  const env = getClientEnv();
  // Soft-warn for optional but commonly needed envs
  if (!_warnedOptionalEnv) {
    const missingOptional: string[] = [];
    if (!env.NEXT_PUBLIC_FIREBASE_STORAGE_BUCKET)
      missingOptional.push('NEXT_PUBLIC_FIREBASE_STORAGE_BUCKET');
    if (!env.NEXT_PUBLIC_FIREBASE_MESSAGING_SENDER_ID)
      missingOptional.push('NEXT_PUBLIC_FIREBASE_MESSAGING_SENDER_ID');
    if (missingOptional.length && typeof console !== 'undefined') {
      console.warn(
        `[firebaseClient] Optional env(s) missing: ${missingOptional.join(', ')}. Some features may be disabled.`
      );
    }
    _warnedOptionalEnv = true;
  }
}

function ensureApp(): FirebaseApp {
  assertBrowserEnv();
  if (_app) return _app;
  time('firebaseClient:init');
  _app = getApps().length
    ? getApp()
    : initializeApp({
        apiKey: getClientEnv().NEXT_PUBLIC_FIREBASE_API_KEY,
        authDomain: getClientEnv().NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN,
        projectId: getClientEnv().NEXT_PUBLIC_FIREBASE_PROJECT_ID,
        appId: getClientEnv().NEXT_PUBLIC_FIREBASE_APP_ID,
        storageBucket: getClientEnv().NEXT_PUBLIC_FIREBASE_STORAGE_BUCKET,
        measurementId: process.env.NEXT_PUBLIC_FIREBASE_MEASUREMENT_ID,
        messagingSenderId: getClientEnv().NEXT_PUBLIC_FIREBASE_MESSAGING_SENDER_ID,
      });
  if (process.env.NODE_ENV !== 'production') {
    info('firebaseClient initialized', {
      projectId: getClientEnv().NEXT_PUBLIC_FIREBASE_PROJECT_ID,
      emulator: getClientEnv().NEXT_PUBLIC_USE_EMULATORS === 'true',
    });
  }
  timeEnd('firebaseClient:init', 'firebaseClient:initDone');
  return _app;
}

function ensureAuth(): Auth {
  if (_auth) return _auth;
  const app = ensureApp();

  _auth = getAuth(app);
  // Keep auth state in local storage for SPA experience; don’t block if it fails.
  try {
    void setPersistence(_auth, browserLocalPersistence);
  } catch {}

  // Optional: connect to local emulators in dev
  if (getClientEnv().NEXT_PUBLIC_USE_EMULATORS === 'true' && !_authEmuConnected) {
    try {
      const { host, port } = parseHostPort(
        getClientEnv().NEXT_PUBLIC_AUTH_EMULATOR_HOST,
        DEFAULTS.auth
      );
      const url = `http://${host}:${port}`;
      connectAuthEmulator(_auth, url, { disableWarnings: true } as any);
      _authEmuConnected = true;
    } catch (e) {
      if (process.env.NODE_ENV !== 'production') console.debug('Auth emulator connect failed:', e);
    }
  }
  return _auth;
}

function ensureDb(): Firestore {
  if (_db) return _db;
  if (getClientEnv().NEXT_PUBLIC_USE_EMULATORS === 'true') {
    ensureAuth();
  }
  const app = ensureApp();
  _db = getFirestore(app);

  // Optional: connect to local emulators in dev
  if (getClientEnv().NEXT_PUBLIC_USE_EMULATORS === 'true' && !_dbEmuConnected) {
    try {
      const { host, port } = parseHostPort(
        getClientEnv().NEXT_PUBLIC_FIRESTORE_EMULATOR_HOST,
        DEFAULTS.firestore
      );
      connectFirestoreEmulator(_db, host, port);
      _dbEmuConnected = true;
    } catch (e) {
      if (process.env.NODE_ENV !== 'production')
        console.debug('Firestore emulator connect failed:', e);
    }
  }
  return _db;
}

// Preserve existing named exports using lazy proxies so imports don’t need to change.
export const app: FirebaseApp = new Proxy({} as FirebaseApp, {
  get(_t, p) {
    const inst = ensureApp() as any;
    return inst[p as keyof FirebaseApp];
  },
}) as FirebaseApp;

export const auth: Auth = new Proxy({} as Auth, {
  get(_t, p) {
    const inst = ensureAuth() as any;
    return inst[p as keyof Auth];
  },
}) as Auth;

export const db: Firestore = new Proxy({} as Firestore, {
  get(_t, p) {
    const inst = ensureDb() as any;
    return inst[p as keyof Firestore];
  },
}) as Firestore;

// Also export getters for explicit usage if preferred by new code.
export function getFirebaseApp(): FirebaseApp {
  return ensureApp();
}
export function getFirebaseAuth(): Auth {
  return ensureAuth();
}
export function getFirebaseDb(): Firestore {
  return ensureDb();
}

// Aliases with client-prefixed names for ergonomics
export function getClientApp(): FirebaseApp {
  return ensureApp();
}
export function getClientAuth(): Auth {
  return ensureAuth();
}
export function getClientFirestore(): Firestore {
  return ensureDb();
}
