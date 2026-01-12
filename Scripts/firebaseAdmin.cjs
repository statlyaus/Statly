require('dotenv').config({ path: '.env.local' });

const admin = require('firebase-admin');

function tryGetServiceAccount() {
  // Base64 JSON (preferred)
  const b64 = process.env.FIREBASE_SERVICE_ACCOUNT_JSON_BASE64;
  if (b64) {
    const json = Buffer.from(b64, 'base64').toString('utf8');
    const parsed = JSON.parse(json);
    return {
      projectId: parsed.project_id ?? parsed.projectId,
      clientEmail: parsed.client_email ?? parsed.clientEmail,
      privateKey: String(parsed.private_key ?? parsed.privateKey).replace(/\\n/g, '\n'),
    };
  }

  // Env triplet (fallback)
  const projectId = process.env.FIREBASE_PROJECT_ID;
  const clientEmail = process.env.FIREBASE_CLIENT_EMAIL;
  const privateKey = process.env.FIREBASE_PRIVATE_KEY?.replace(/\\n/g, '\n');
  if (projectId && clientEmail && privateKey) {
    return { projectId, clientEmail, privateKey };
  }

  return null;
}

if (!admin.apps.length) {
  const sa = tryGetServiceAccount();
  if (sa) {
    admin.initializeApp({
      credential: admin.credential.cert(sa),
      projectId: sa.projectId,
    });
  } else {
    // ADC fallback: GOOGLE_APPLICATION_CREDENTIALS or gcloud auth application-default login
    admin.initializeApp({
      credential: admin.credential.applicationDefault(),
      projectId:
        process.env.GOOGLE_CLOUD_PROJECT ||
        process.env.GCLOUD_PROJECT ||
        process.env.FIREBASE_PROJECT_ID ||
        process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID,
    });
  }
}

module.exports = { admin };
