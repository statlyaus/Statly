// src/lib/firebaseAdmin.ts
// Server-only Firebase Admin initialiser with robust env handling.
import 'server-only';
import { getApps, initializeApp, applicationDefault, cert } from 'firebase-admin/app';
import { getFirestore } from 'firebase-admin/firestore';

type ServiceAccountEnv = {
  projectId?: string;
  clientEmail?: string;
  privateKey?: string;
};

function readServiceAccountFromEnv(): ServiceAccountEnv | null {
  // Prefer explicit server-side env vars
  const projectId =
    process.env.FIREBASE_PROJECT_ID || process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID;
  const clientEmail = process.env.FIREBASE_CLIENT_EMAIL;
  // Private keys pasted into env often have literal "\n"; convert to real newlines
  const rawKey = process.env.FIREBASE_PRIVATE_KEY;
  const privateKey = rawKey ? rawKey.replace(/\\n/g, '\n') : undefined;

  if (projectId && clientEmail && privateKey) {
    return { projectId, clientEmail, privateKey };
  }
  return null;
}

if (!getApps().length) {
  const svc = readServiceAccountFromEnv();

  if (svc) {
    initializeApp({
      credential: cert({
        projectId: svc.projectId!,
        clientEmail: svc.clientEmail!,
        privateKey: svc.privateKey!,
      }),
    });
  } else {
    // Fallback to ADC (works with GOOGLE_APPLICATION_CREDENTIALS or gcloud ADC)
    initializeApp({
      credential: applicationDefault(),
    });
  }
}

// Firestore (Admin)
export const adminDb = getFirestore();
// Keep data tidy; undefined fields are ignored rather than erroring
adminDb.settings({ ignoreUndefinedProperties: true });

// If you need Auth later, you can export it like this:
// import { getAuth } from 'firebase-admin/auth';
// export const adminAuth = getAuth();