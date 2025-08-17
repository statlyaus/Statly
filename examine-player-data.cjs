require('dotenv').config({ path: '.env.local' });
const admin = require('firebase-admin');

if (!admin.apps.length) {
  const serviceAccountBase64 = process.env.FIREBASE_SERVICE_ACCOUNT_JSON_BASE64;
  const serviceAccountJson = Buffer.from(serviceAccountBase64, 'base64').toString('utf-8');
  const serviceAccount = JSON.parse(serviceAccountJson);
  
  admin.initializeApp({
    credential: admin.credential.cert(serviceAccount)
  });
}

async function examinePlayerData() {
  const db = admin.firestore();
  const snapshot = await db.collection('player_match_stats').limit(3).get();
  
  console.log('Sample player match data:');
  snapshot.forEach(doc => {
    console.log('Document ID:', doc.id);
    console.log('Data:', JSON.stringify(doc.data(), null, 2));
    console.log('---');
  });
}

examinePlayerData().catch(console.error).finally(() => process.exit(0));
