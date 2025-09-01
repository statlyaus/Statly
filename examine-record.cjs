const admin = require('firebase-admin');
require('dotenv').config({ path: '.env.local' });

if (!admin.apps.length) {
  const serviceAccountBase64 = process.env.FIREBASE_SERVICE_ACCOUNT_JSON_BASE64;
  const serviceAccountJson = Buffer.from(serviceAccountBase64, 'base64').toString('utf-8');
  const serviceAccount = JSON.parse(serviceAccountJson);

  admin.initializeApp({
    credential: admin.credential.cert(serviceAccount),
  });
}

async function examineRecord() {
  const db = admin.firestore();

  const snapshot = await db.collection('player_match_stats').limit(1).get();
  if (!snapshot.empty) {
    const doc = snapshot.docs[0];
    console.log('📋 Complete record structure:');
    console.log('ID:', doc.id);
    console.log('Data:', JSON.stringify(doc.data(), null, 2));
  }
}

examineRecord()
  .catch(console.error)
  .finally(() => process.exit(0));
