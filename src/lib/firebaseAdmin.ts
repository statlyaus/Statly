// src/lib/firebaseAdmin.ts
// Node-only Firebase Admin singleton.
// IMPORTANT: Do not import this from client components/hooks.

import { getApps, initializeApp, cert, applicationDefault, type App } from 'firebase-admin/app';
import { getAuth, type Auth } from 'firebase-admin/auth';
import { getFirestore, type Firestore } from 'firebase-admin/firestore';

// Hard client-guard (instead of `server-only`, which breaks pages/):
if (typeof window !== 'undefined') {
  throw new Error("firebaseAdmin.ts was imported in the browser. Use '@/lib/firebaseClient' on the client.");
}

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

export const adminDb: Firestore = getFirestore(app);
export const adminAuth: Auth = getAuth(app);
export { app };

// TEMP legacy alias (so existing imports keep working while you migrate).
// Remove this once all call-sites use `adminDb`.
export const db = adminDb;

