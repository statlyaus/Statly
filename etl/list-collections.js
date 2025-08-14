const admin = require('firebase-admin');

// Initialize Firebase Admin
const base64Json = process.env.FIREBASE_SERVICE_ACCOUNT_JSON_BASE64;
if (!base64Json) {
  console.error('❌ FIREBASE_SERVICE_ACCOUNT_JSON_BASE64 environment variable is required');
  process.exit(1);
}

const json = Buffer.from(base64Json, 'base64').toString('utf8');
const serviceAccount = JSON.parse(json);

if (!admin.apps.length) {
  admin.initializeApp({
    credential: admin.credential.cert(serviceAccount),
  });
}

const db = admin.firestore();

async function listCollections() {
  try {
    console.log('🔍 Listing all Firestore collections...');
    const collections = await db.listCollections();
    
    console.log(`📁 Found ${collections.length} collections:`);
    
    for (const collection of collections) {
      const snapshot = await collection.limit(3).get();
      console.log(`  📊 ${collection.id}: ${snapshot.size} documents`);
      
      if (snapshot.size > 0) {
        console.log(`    Sample document keys:`, Object.keys(snapshot.docs[0].data()));
      }
    }
    
  } catch (error) {
    console.error('❌ Error listing collections:', error.message);
  }
}

listCollections();
