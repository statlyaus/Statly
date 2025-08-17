const admin = require('firebase-admin');
require('dotenv').config({ path: '.env.local' });

if (!admin.apps.length) {
  const serviceAccountBase64 = process.env.FIREBASE_SERVICE_ACCOUNT_JSON_BASE64;
  const serviceAccountJson = Buffer.from(serviceAccountBase64, 'base64').toString('utf-8');
  const serviceAccount = JSON.parse(serviceAccountJson);
  
  admin.initializeApp({
    credential: admin.credential.cert(serviceAccount)
  });
}

async function clearDatabase() {
  const db = admin.firestore();
  
  console.log('🧹 Clearing all player_match_stats records...');
  
  let deletedCount = 0;
  let hasMore = true;
  
  while (hasMore) {
    const snapshot = await db.collection('player_match_stats').limit(500).get();
    
    if (snapshot.empty) {
      hasMore = false;
      break;
    }
    
    const batch = db.batch();
    snapshot.docs.forEach(doc => {
      batch.delete(doc.ref);
    });
    
    await batch.commit();
    deletedCount += snapshot.size;
    console.log(`🗑️  Deleted ${deletedCount} records so far...`);
  }
  
  console.log(`✅ Cleared ${deletedCount} total records`);
  
  // Verify clearing
  const verifySnapshot = await db.collection('player_match_stats').get();
  console.log(`✅ Verification: ${verifySnapshot.size} records remaining`);
}

clearDatabase().catch(console.error).finally(() => process.exit(0));
