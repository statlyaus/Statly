// src/lib/firebaseClient.ts
// Long-term safe: Client-only Firebase Web SDK singleton.
// - Never initializes on the server
// - Validates NEXT_PUBLIC_* only in the browser
// - Preserves named exports (app, auth, db) via lazy proxies
// - If accessed on the server, throws a clear error instructing to use firebaseAdmin

import type { FirebaseApp } from 'firebase/app';
import type { Auth } from 'firebase/auth';
import type { Firestore } from 'firebase/firestore';

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
  const required = [
    'NEXT_PUBLIC_FIREBASE_API_KEY',
    'NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN',
    'NEXT_PUBLIC_FIREBASE_PROJECT_ID',
    'NEXT_PUBLIC_FIREBASE_APP_ID',
  ];
  const missing = required.filter((k) => !process.env[k]);
  if (missing.length) {
    throw new Error(
      `[firebaseClient] Missing env(s): ${missing.join(', ')}. Add them to .env.local or your hosting env.`
    );
  }

  // Soft-warn for optional but commonly needed envs
  if (!_warnedOptionalEnv) {
    const optional = [
      'NEXT_PUBLIC_FIREBASE_STORAGE_BUCKET',
      'NEXT_PUBLIC_FIREBASE_MESSAGING_SENDER_ID',
    ];
    const missingOptional = optional.filter((k) => !process.env[k]);
    if (missingOptional.length && typeof console !== 'undefined') {
       
      console.warn(
        `[firebaseClient] Optional env(s) missing: ${missingOptional.join(
          ', '
        )}. Some features may be disabled.`
      );
    }
    _warnedOptionalEnv = true;
  }
}

function ensureApp(): FirebaseApp {
  assertBrowserEnv();
  if (_app) return _app;
  // Lazy-require to avoid SSR evaluating ESM imports
   
  const appMod = require('firebase/app') as typeof import('firebase/app');
  const { getApps, getApp, initializeApp } = appMod;
  _app = getApps().length
    ? getApp()
    : initializeApp({
        apiKey: process.env.NEXT_PUBLIC_FIREBASE_API_KEY!,
        authDomain: process.env.NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN!,
        projectId: process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID!,
        appId: process.env.NEXT_PUBLIC_FIREBASE_APP_ID!,
        storageBucket: process.env.NEXT_PUBLIC_FIREBASE_STORAGE_BUCKET,
        measurementId: process.env.NEXT_PUBLIC_FIREBASE_MEASUREMENT_ID,
        messagingSenderId: process.env.NEXT_PUBLIC_FIREBASE_MESSAGING_SENDER_ID,
      });
  return _app;
}

function ensureAuth(): Auth {
  if (_auth) return _auth;
  const app = ensureApp();
   
  const { getAuth, browserLocalPersistence, setPersistence } = require('firebase/auth') as typeof import('firebase/auth');
  _auth = getAuth(app);
  // Keep auth state in local storage for SPA experience; don’t block if it fails.
  try { void setPersistence(_auth, browserLocalPersistence); } catch {}

  // Optional: connect to local emulators in dev
  if (process.env.NEXT_PUBLIC_USE_EMULATORS === 'true' && !_authEmuConnected) {
    try {
      const { connectAuthEmulator } = require('firebase/auth') as typeof import('firebase/auth');
      connectAuthEmulator(_auth, 'http://127.0.0.1:9099', { disableWarnings: true } as any);
      _authEmuConnected = true;
    } catch (e) {
       
      if (process.env.NODE_ENV !== 'production') console.debug('Auth emulator connect failed:', e);
    }
  }
  return _auth;
}

function ensureDb(): Firestore {
  if (_db) return _db;
  const app = ensureApp();
   
  const { getFirestore } = require('firebase/firestore') as typeof import('firebase/firestore');
  _db = getFirestore(app);

  // Optional: connect to local emulators in dev
  if (process.env.NEXT_PUBLIC_USE_EMULATORS === 'true' && !_dbEmuConnected) {
    try {
      const { connectFirestoreEmulator } = require('firebase/firestore') as typeof import('firebase/firestore');
      connectFirestoreEmulator(_db, '127.0.0.1', 8080);
      _dbEmuConnected = true;
    } catch (e) {
       
      if (process.env.NODE_ENV !== 'production') console.debug('Firestore emulator connect failed:', e);
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
export function getFirebaseApp(): FirebaseApp { return ensureApp(); }
export function getFirebaseAuth(): Auth { return ensureAuth(); }
export function getFirebaseDb(): Firestore { return ensureDb(); }
