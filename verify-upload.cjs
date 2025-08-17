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

async function verifyUpload() {
  const db = admin.firestore();
  
  console.log('🔍 Verifying upload...');
  
  // Get total count
  const snapshot = await db.collection('player_match_stats').get();
  console.log(`📊 Total records: ${snapshot.size}`);
  
  if (snapshot.size > 0) {
    // Get first few documents to check structure
    const docs = snapshot.docs.slice(0, 3);
    console.log('\n📋 Sample records:');
    docs.forEach((doc, i) => {
      const data = doc.data();
      console.log(`${i + 1}. ID: ${doc.id}`);
      console.log(`   Round: ${data.round}, Player: ${data.player_name || data.playerName || 'unknown'}`);
      console.log(`   Fields: ${Object.keys(data).length} (${Object.keys(data).slice(0, 5).join(', ')}...)`);
    });
    
    // Check round distribution
    const rounds = new Map();
    snapshot.docs.forEach(doc => {
      const round = doc.data().round;
      rounds.set(round, (rounds.get(round) || 0) + 1);
    });
    
    console.log('\n📊 Records per round:');
    Array.from(rounds.entries()).sort((a, b) => a[0] - b[0]).forEach(([round, count]) => {
      console.log(`   Round ${round}: ${count} records`);
    });
    
    // Check for complete stats
    const hasCompleteStats = snapshot.docs.some(doc => {
      const data = doc.data();
      return data.disposals || data.kicks || data.handballs; // AFL stat fields
    });
    
    console.log(`\n✅ Complete AFL stats present: ${hasCompleteStats ? 'YES' : 'NO'}`);
    
    if (!hasCompleteStats) {
      console.log('⚠️  Only basic player match data found - missing detailed stats');
      console.log('🔧 The upload may have only included player names/rounds, not full statistics');
    }
  }
}

verifyUpload().catch(console.error).finally(() => process.exit(0));
