// src/lib/firebaseAdmin.ts
// Server-only Firebase Admin singleton (guarded by Next.js 'server-only').
import 'server-only';
// IMPORTANT: Do not import this from client components/hooks.

import { getApps, initializeApp, cert, applicationDefault, type App } from 'firebase-admin/app';
import { getAuth, type Auth } from 'firebase-admin/auth';
import { getFirestore, type Firestore } from 'firebase-admin/firestore';
import { getPreferredEmulatorHosts } from '@/lib/env';
import { info, warn, time, timeEnd } from '@/lib/logger';
import { parseHostPort, DEFAULTS } from '@/lib/firebaseEmulator';


// Prefer the tested helper if available
import { getServiceAccountFromEnv } from './serviceAccount';

// Fallbacks if the helper isn't available or environment uses different vars.
type SACompat = { project_id: string; client_email: string; private_key: string };

function tryGetServiceAccount(): SACompat | null {
  try {
    // Use helper and normalize to snake_case keys
    if (typeof getServiceAccountFromEnv === 'function') {
      const sa: any = getServiceAccountFromEnv();
      const project_id = sa.projectId ?? sa.project_id;
      const client_email = sa.clientEmail ?? sa.client_email;
      let private_key = sa.privateKey ?? sa.private_key;
      if (!project_id || !client_email || !private_key) return null;
      private_key = String(private_key).replace(/\\n/g, '\n');
      return { project_id, client_email, private_key } as SACompat;
    }

    // Minimal inline fallback from env (base64 JSON var)
    const b64 = process.env.FIREBASE_SERVICE_ACCOUNT_JSON_BASE64;
    if (b64) {
      const parsed = JSON.parse(Buffer.from(b64, 'base64').toString('utf8')) as any;
      const project_id = parsed.project_id ?? parsed.projectId;
      const client_email = parsed.client_email ?? parsed.clientEmail;
      let private_key = parsed.private_key ?? parsed.privateKey;
      if (!project_id || !client_email || !private_key) return null;
      private_key = String(private_key).replace(/\\n/g, '\n');
      return { project_id, client_email, private_key } as SACompat;
    }

    // Direct env triplet support
    const project_id = process.env.FIREBASE_PROJECT_ID;
    const client_email = process.env.FIREBASE_CLIENT_EMAIL;
    let private_key = process.env.FIREBASE_PRIVATE_KEY;
    if (!project_id || !client_email || !private_key) return null;
    private_key = private_key.replace(/\\n/g, '\n');
    return { project_id, client_email, private_key } as SACompat;
  } catch {
    return null;
  }
}

let app: App;
if (getApps().length === 0) {
  const sa = tryGetServiceAccount();
  if (sa) {
    app = initializeApp({
      credential: cert({
        projectId: sa.project_id,
        clientEmail: sa.client_email,
        privateKey: sa.private_key,
      }),
      projectId: sa.project_id,
    });
  } else {
    // ADC fallback (local dev: `gcloud auth application-default login` or GOOGLE_APPLICATION_CREDENTIALS)
    app = initializeApp({
      credential: applicationDefault(),
      projectId:
        process.env.GOOGLE_CLOUD_PROJECT ??
        process.env.GCLOUD_PROJECT ??
        process.env.FIREBASE_PROJECT_ID ??
        process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID,
    });
  }
} else {
  app = getApps()[0]!;
}

// In development, optionally connect Admin SDK to emulators when enabled
let _emuWarned = false;
// Prefer private emulator vars if present; otherwise fall back to public values in dev
if (process.env.NODE_ENV !== 'production') {
  try {
    const pref = getPreferredEmulatorHosts();
    const fsRaw = process.env.FIRESTORE_EMULATOR_HOST || pref.firestore || '';
    const auRaw = process.env.FIREBASE_AUTH_EMULATOR_HOST || pref.auth || '';

    if (!process.env.FIRESTORE_EMULATOR_HOST && pref.firestore && !_emuWarned) {
      warn('Using public Firestore emulator host on server; prefer FIRESTORE_EMULATOR_HOST', { host: pref.firestore });
      _emuWarned = true;
    }
    if (!process.env.FIREBASE_AUTH_EMULATOR_HOST && pref.auth && !_emuWarned) {
      warn('Using public Auth emulator host on server; prefer FIREBASE_AUTH_EMULATOR_HOST', { host: pref.auth });
      _emuWarned = true;
    }

    if (fsRaw) {
      const fs = parseHostPort(fsRaw, DEFAULTS.firestore);
      process.env.FIRESTORE_EMULATOR_HOST = `${fs.host}:${fs.port}`;
    }
    if (auRaw) {
      const au = parseHostPort(auRaw, DEFAULTS.auth);
      // Admin Auth respects FIREBASE_AUTH_EMULATOR_HOST when set (host:port)
      process.env.FIREBASE_AUTH_EMULATOR_HOST = `${au.host}:${au.port}`;
    }
  } catch {}
}

export const adminDb: Firestore = getFirestore(app);
export const adminAuth: Auth = getAuth(app);
export { app as adminApp };

// TEMP legacy alias (so existing imports keep working while you migrate).
// Remove this once all call-sites use `adminDb`.
export const db = adminDb;

export function getAdminDb(): Firestore {
  return adminDb;
}

export function getProjectId(): string {
  return (
    process.env.GOOGLE_CLOUD_PROJECT ||
    process.env.GCLOUD_PROJECT ||
    process.env.FIREBASE_PROJECT_ID ||
    process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID ||
    ''
  );
}

// Guard against accidental import in the browser
if (typeof window !== 'undefined') {
  throw new Error('[firebaseAdmin] This module is server-only and must not be imported in the browser.');
}

// One-time observability log in dev/test to confirm config
if (process.env.NODE_ENV !== 'production') {
  const pid = getProjectId();
  const usingEmu = Boolean(process.env.FIRESTORE_EMULATOR_HOST || process.env.FIREBASE_AUTH_EMULATOR_HOST);
  time('firebaseAdmin:init');
  info('firebaseAdmin initialized', { projectId: pid, emulator: usingEmu });
  timeEnd('firebaseAdmin:init', 'firebaseAdmin:initDone');
}
