import 'server-only';
import admin from 'firebase-admin';

type SA = { project_id: string; client_email: string; private_key: string };

function loadCreds(): SA {
  const b64 = process.env.FIREBASE_SERVICE_ACCOUNT_JSON_BASE64;
  if (!b64) throw new Error('Missing FIREBASE_SERVICE_ACCOUNT_JSON_BASE64');

  const json = Buffer.from(b64, 'base64').toString('utf8');

  // Parse; if someone pasted raw newlines in the PEM, normalize them first
  let parsed: any;
  try {
    parsed = JSON.parse(json);
  } catch {
    const fixed = json.replace(
      /"private_key"\s*:\s*"(?:[^"\\]|\\.|[\r\n])*?"/m,
      (m) => m.replace(/\r?\n/g, '\\n')
    );
    parsed = JSON.parse(fixed);
  }

  const project_id = parsed.project_id ?? '';
  const client_email = parsed.client_email ?? '';
  const private_key = String(parsed.private_key ?? '').replace(/\\n/g, '\n');

  if (!project_id || !client_email || !private_key) {
    throw new Error('Service account missing project_id/client_email/private_key');
  }
  return { project_id, client_email, private_key };
}

if (!admin.apps.length) {
  const { project_id, client_email, private_key } = loadCreds();
  admin.initializeApp({
    credential: admin.credential.cert({
      projectId: project_id,
      clientEmail: client_email,
      privateKey: private_key,
    }),
    projectId: project_id, // explicit helps avoid UNAUTHENTICATED gremlins
  });
}

export const adminDb = admin.firestore();