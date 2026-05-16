// src/lib/firebaseAdmin.ts
// Server-only Firebase Admin singleton (guarded by Next.js 'server-only').
// IMPORTANT: Do not import this from client components/hooks.

import './loadEnv';

import { getApps, initializeApp, cert, applicationDefault, type App } from 'firebase-admin/app';
import { getAuth, type Auth } from 'firebase-admin/auth';
import { getFirestore, type Firestore } from 'firebase-admin/firestore';

import { getPreferredEmulatorHosts } from './env';
import { parseHostPort, DEFAULTS } from './firebaseEmulator';
import { info, warn, time, timeEnd } from './logger';

// Prefer the tested helper if available
import { getServiceAccountFromEnv } from './serviceAccount';

// Fallbacks if the helper isn't available or environment uses different vars.
type SACompat = { project_id: string; client_email: string; private_key: string };
type AdminCredentialSource = 'service_account_base64' | 'service_account_triplet' | 'adc_explicit';

type AdminResolution = {
  credentialSource: AdminCredentialSource;
  projectId: string;
  options:
    | {
        credentialSource: 'service_account_base64' | 'service_account_triplet';
        credential: ReturnType<typeof cert>;
        projectId: string;
      }
    | {
        credentialSource: 'adc_explicit';
        credential: ReturnType<typeof applicationDefault>;
        projectId: string;
      };
};

function normalizeServiceAccount(sa: Record<string, unknown>): SACompat {
  const project_id = String(sa.projectId ?? sa.project_id ?? '').trim();
  const client_email = String(sa.clientEmail ?? sa.client_email ?? '').trim();
  const private_key = String(sa.privateKey ?? sa.private_key ?? '').replace(/\\n/g, '\n').trim();

  if (!project_id || !client_email || !private_key) {
    throw new Error('Firebase service account is missing required fields');
  }

  return { project_id, client_email, private_key };
}

function resolveProjectId(env: NodeJS.ProcessEnv): string {
  return (
    env.GOOGLE_CLOUD_PROJECT ??
    env.GCLOUD_PROJECT ??
    env.FIREBASE_PROJECT_ID ??
    env.NEXT_PUBLIC_FIREBASE_PROJECT_ID ??
    ''
  ).trim();
}

export function resolveFirebaseAdminConfig(env: NodeJS.ProcessEnv): AdminResolution {
  const projectId = resolveProjectId(env);
  const hasBase64 = Boolean(env.FIREBASE_SERVICE_ACCOUNT_JSON_BASE64?.trim());
  const hasTriplet =
    Boolean(env.FIREBASE_PROJECT_ID?.trim()) ||
    Boolean(env.FIREBASE_CLIENT_EMAIL?.trim()) ||
    Boolean(env.FIREBASE_PRIVATE_KEY?.trim());
  const allowAdc =
    env.FIREBASE_ADMIN_ALLOW_ADC === 'true' || Boolean(env.GOOGLE_APPLICATION_CREDENTIALS?.trim());

  if (hasBase64) {
    let sa: SACompat;
    try {
      sa = normalizeServiceAccount(getServiceAccountFromEnv() as Record<string, unknown>);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      throw new Error(`Invalid FIREBASE_SERVICE_ACCOUNT_JSON_BASE64: ${message}`);
    }

    return {
      credentialSource: 'service_account_base64',
      projectId: sa.project_id,
      options: {
        credentialSource: 'service_account_base64',
        credential: cert({
          projectId: sa.project_id,
          clientEmail: sa.client_email,
          privateKey: sa.private_key,
        }),
        projectId: sa.project_id,
      },
    };
  }

  if (hasTriplet) {
    const missing = ['FIREBASE_PROJECT_ID', 'FIREBASE_CLIENT_EMAIL', 'FIREBASE_PRIVATE_KEY'].filter(
      (key) => !env[key]?.trim()
    );
    if (missing.length > 0) {
      throw new Error(
        `Incomplete Firebase service-account triplet. Missing: ${missing.join(', ')}`
      );
    }

    const sa = normalizeServiceAccount({
      project_id: env.FIREBASE_PROJECT_ID,
      client_email: env.FIREBASE_CLIENT_EMAIL,
      private_key: env.FIREBASE_PRIVATE_KEY,
    });

    return {
      credentialSource: 'service_account_triplet',
      projectId: sa.project_id,
      options: {
        credentialSource: 'service_account_triplet',
        credential: cert({
          projectId: sa.project_id,
          clientEmail: sa.client_email,
          privateKey: sa.private_key,
        }),
        projectId: sa.project_id,
      },
    };
  }

  if (allowAdc) {
    return {
      credentialSource: 'adc_explicit',
      projectId,
      options: {
        credentialSource: 'adc_explicit',
        credential: applicationDefault(),
        projectId,
      },
    };
  }

  throw new Error(
    'No Firebase admin credential source configured. Provide FIREBASE_SERVICE_ACCOUNT_JSON_BASE64, the FIREBASE_PROJECT_ID/FIREBASE_CLIENT_EMAIL/FIREBASE_PRIVATE_KEY triplet, or explicitly opt into ADC with GOOGLE_APPLICATION_CREDENTIALS or FIREBASE_ADMIN_ALLOW_ADC=true.'
  );
}

const adminResolution = resolveFirebaseAdminConfig(process.env);
export const firebaseAdminDiagnostics = {
  credentialSource: adminResolution.credentialSource,
  projectId: adminResolution.projectId,
};

let app: App;
if (getApps().length === 0) {
  app = initializeApp({
    credential: adminResolution.options.credential,
    projectId: adminResolution.options.projectId,
  });
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
      warn('Using public Firestore emulator host on server; prefer FIRESTORE_EMULATOR_HOST', {
        host: pref.firestore,
      });
      _emuWarned = true;
    }
    if (!process.env.FIREBASE_AUTH_EMULATOR_HOST && pref.auth && !_emuWarned) {
      warn('Using public Auth emulator host on server; prefer FIREBASE_AUTH_EMULATOR_HOST', {
        host: pref.auth,
      });
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
if ('window' in globalThis) {
  throw new Error(
    '[firebaseAdmin] This module is server-only and must not be imported in the browser.'
  );
}

// One-time observability log in dev/test to confirm config
if (process.env.NODE_ENV !== 'production') {
  const pid = getProjectId();
  const usingEmu = Boolean(
    process.env.FIRESTORE_EMULATOR_HOST || process.env.FIREBASE_AUTH_EMULATOR_HOST
  );
  time('firebaseAdmin:init');
  info('firebaseAdmin initialized', {
    projectId: pid,
    emulator: usingEmu,
    credentialSource: firebaseAdminDiagnostics.credentialSource,
  });
  timeEnd('firebaseAdmin:init', 'firebaseAdmin:initDone');
}
