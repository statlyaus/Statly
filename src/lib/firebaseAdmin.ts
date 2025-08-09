// src/lib/firebaseAdmin.ts
import 'server-only';
import admin from 'firebase-admin';

type SAFromVars = {
  projectId?: string;
  clientEmail?: string;
  privateKey?: string;
};

function fromBase64JSON(): SAFromVars | null {
  const b64 = process.env.FIREBASE_SERVICE_ACCOUNT_JSON_BASE64;
  if (!b64) return null;
  try {
    const json = Buffer.from(b64, 'base64').toString('utf8');
    const parsed = JSON.parse(json) as {
      project_id?: string;
      client_email?: string;
      private_key?: string;
    };
    if (!parsed.project_id || !parsed.client_email || !parsed.private_key) {
      throw new Error('Missing fields in service account JSON');
    }
    return {
      projectId: parsed.project_id,
      clientEmail: parsed.client_email,
      privateKey: parsed.private_key,
    };
  } catch (e) {
    throw new Error(
      'Failed to parse FIREBASE_SERVICE_ACCOUNT_JSON_BASE64. ' +
        (e instanceof Error ? e.message : String(e))
    );
  }
}

function fromSeparateVars(): SAFromVars | null {
  const projectId = process.env.FIREBASE_PROJECT_ID;
  const clientEmail = process.env.FIREBASE_CLIENT_EMAIL;
  const rawKey = process.env.FIREBASE_PRIVATE_KEY;
  const privateKey = rawKey ? rawKey.replace(/\\n/g, '\n') : undefined;
  if (projectId && clientEmail && privateKey) {
    return { projectId, clientEmail, privateKey };
  }
  return null;
}

const sa =
  fromBase64JSON() /* prefer the single env you already have */ ??
  fromSeparateVars(); /* fallback to the 3-var style */

if (!admin.apps.length) {
  if (!sa?.projectId || !sa?.clientEmail || !sa?.privateKey) {
    throw new Error(
      'Firebase Admin misconfigured. Provide either ' +
        'FIREBASE_SERVICE_ACCOUNT_JSON_BASE64 (full JSON, base64) ' +
        'or the trio FIREBASE_PROJECT_ID, FIREBASE_CLIENT_EMAIL, FIREBASE_PRIVATE_KEY.'
    );
  }

  admin.initializeApp({
    credential: admin.credential.cert({
      projectId: sa.projectId,
      clientEmail: sa.clientEmail,
      privateKey: sa.privateKey,
    }),
    projectId: sa.projectId, // be explicit
  });
}

export const adminDb = admin.firestore();