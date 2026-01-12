// create-test-league.cjs (near the top)
const admin = require('firebase-admin');

// Optional: load .env.local if you store vars there
require('dotenv').config({ path: '.env.local' });

function initFirebaseAdmin() {
  if (admin.apps.length) return;

  // Option A: Base64 JSON in env var
  if (process.env.FIREBASE_SERVICE_ACCOUNT_JSON_BASE64) {
    const json = Buffer.from(
      process.env.FIREBASE_SERVICE_ACCOUNT_JSON_BASE64,
      'base64'
    ).toString('utf8');

    const serviceAccount = JSON.parse(json);
    admin.initializeApp({
      credential: admin.credential.cert(serviceAccount),
    });
    return;
  }

  // Option B: Google Application Default Credentials (GOOGLE_APPLICATION_CREDENTIALS)
  admin.initializeApp({
    credential: admin.credential.applicationDefault(),
  });
}

initFirebaseAdmin();
