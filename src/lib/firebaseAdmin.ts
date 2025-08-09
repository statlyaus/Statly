// src/lib/firebaseAdmin.ts
import 'server-only';
import admin from 'firebase-admin';

type SA = { projectId: string; clientEmail: string; privateKey: string };

function fromBase64(): SA | null {
  const b64 = process.env.FIREBASE_SERVICE_ACCOUNT_JSON_BASE64;
  if (!b64) return null;
  const json = Buffer.from(b64, 'base64').toString('utf8');
  const parsed = JSON.parse(json) as {
    project_id?: string;
    client_email?: string;
    private_key?: string;
  };
  if (!parsed.project_id || !parsed.client_email || !parsed.private_key) {
    throw new Error('Invalid FIREBASE_SERVICE_ACCOUNT_JSON_BASE64: missing fields.');
  }
  return {
    projectId: parsed.project_id,
    clientEmail: parsed.client_email,
    privateKey: parsed.private_key,
  };
}

function fromEnvTriplet(): SA | null {
  const projectId = process.env.FIREBASE_PROJECT_ID?.trim();
  const clientEmail = process.env.FIREBASE_CLIENT_EMAIL?.trim();
  const rawKey = process.env.FIREBASE_PRIVATE_KEY;
  const privateKey = rawKey ? rawKey.replace(/\\n/g, '\n') : undefined;
  if (projectId && clientEmail && privateKey) {
    return { projectId, clientEmail, privateKey };
  }
  return null;
}

const sa = fromBase64() ?? fromEnvTriplet();

if (!admin.apps.length) {
  if (!sa) {
    throw new Error(
      'Firebase Admin misconfigured. Provide either FIREBASE_SERVICE_ACCOUNT_JSON_BASE64 ' +
        'or FIREBASE_PROJECT_ID, FIREBASE_CLIENT_EMAIL, FIREBASE_PRIVATE_KEY.'
    );
  }

  admin.initializeApp({
    credential: admin.credential.cert({
      projectId: sa.projectId,
      clientEmail: sa.clientEmail,
      privateKey: sa.privateKey,
    }),
    projectId: sa.projectId,
  });
}

export const adminDb = admin.firestore();
export const adminAuth = admin.auth();