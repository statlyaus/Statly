// src/lib/firebaseAdmin.ts
import 'server-only';
import admin from 'firebase-admin';

type ServiceAccountRaw = {
  project_id?: string;
  client_email?: string;
  private_key?: string;
  [k: string]: unknown;
};

function loadCreds(): Required<ServiceAccountRaw> {
  // 1) Prefer Base64 env
  const b64 = process.env.FIREBASE_SERVICE_ACCOUNT_JSON_BASE64;
  if (b64) {
    const json = Buffer.from(b64, 'base64').toString('utf8');
    const parsed = JSON.parse(json) as ServiceAccountRaw;
    const project_id = parsed.project_id ?? '';
    const client_email = parsed.client_email ?? '';
    const private_key = (parsed.private_key ?? '').replace(/\\n/g, '\n');
    if (!project_id || !client_email || !private_key) {
      throw new Error('Base64 service account missing project_id/client_email/private_key.');
    }
    return { project_id, client_email, private_key };
  }

  // 2) Fallback: plain JSON env (if you still have it)
  const raw = process.env.FIREBASE_SERVICE_ACCOUNT_JSON;
  if (raw) {
    const stripped = raw.replace(/^\s*'|'\s*$/g, '');
    const parsed = JSON.parse(stripped) as ServiceAccountRaw;
    const project_id = parsed.project_id ?? '';
    const client_email = parsed.client_email ?? '';
    const private_key = (parsed.private_key ?? '').replace(/\\n/g, '\n');
    if (!project_id || !client_email || !private_key) {
      throw new Error('JSON service account missing project_id/client_email/private_key.');
    }
    return { project_id, client_email, private_key };
  }

  throw new Error('Missing Firebase Admin creds. Set FIREBASE_SERVICE_ACCOUNT_JSON_BASE64.');
}

// Initialize Admin SDK once
if (!admin.apps.length) {
  const { project_id, client_email, private_key } = loadCreds();
  admin.initializeApp({
    credential: admin.credential.cert({
      projectId: project_id,
      clientEmail: client_email,
      privateKey: private_key,
    }),
  });
}

export const adminDb = admin.firestore();