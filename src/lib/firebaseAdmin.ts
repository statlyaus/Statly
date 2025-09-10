// Server-side Firebase Admin singleton (env-only)
// Exports: app, adminDb (Firestore), adminAuth (Auth)

import { getApps, initializeApp, cert, applicationDefault, type App } from 'firebase-admin/app';
import { getFirestore, type Firestore } from 'firebase-admin/firestore';
import { getAuth, type Auth } from 'firebase-admin/auth';

type ServiceAccount = { project_id: string; client_email: string; private_key: string };

function fromBase64(): ServiceAccount | null {
  const b64 = process.env.FIREBASE_SERVICE_ACCOUNT_JSON_BASE64;
  if (!b64) return null;
  try { return JSON.parse(Buffer.from(b64, 'base64').toString('utf8')) as ServiceAccount; }
  catch { console.error('[firebaseAdmin] Invalid FIREBASE_SERVICE_ACCOUNT_JSON_BASE64'); return null; }
}

function fromTriple(): ServiceAccount | null {
  const project_id = process.env.FIREBASE_PROJECT_ID;
  const client_email = process.env.FIREBASE_CLIENT_EMAIL;
  let private_key = process.env.FIREBASE_PRIVATE_KEY;
  if (!project_id || !client_email || !private_key) return null;
  private_key = private_key.replace(/\\n/g, '\n');
  return { project_id, client_email, private_key };
}

let app: App;
if (getApps().length === 0) {
  const sa = fromBase64() ?? fromTriple();
  app = sa
    ? initializeApp({
        credential: cert({ projectId: sa.project_id, clientEmail: sa.client_email, privateKey: sa.private_key }),
        projectId: sa.project_id,
      })
    : initializeApp({
        credential: applicationDefault(),
        projectId:
          process.env.GOOGLE_CLOUD_PROJECT ??
          process.env.GCLOUD_PROJECT ??
          process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID,
      });
} else {
  app = getApps()[0]!;
}

const adminDb: Firestore = getFirestore(app);
const adminAuth: Auth = getAuth(app);

export { app, adminDb, adminAuth };
