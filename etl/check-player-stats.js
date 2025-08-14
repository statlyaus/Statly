const admin = require('firebase-admin');

const base64Json = process.env.FIREBASE_SERVICE_ACCOUNT_JSON_BASE64;
const json = Buffer.from(base64Json, 'base64').toString('utf8');
const serviceAccount = JSON.parse(json);

if (!admin.apps.length) {
  admin.initializeApp({
    credential: admin.credential.cert(serviceAccount),
  });
}

const db = admin.firestore();

async function checkData() {
  try {
    console.log('🔍 Checking player_match_stats collection...');
    const snapshot = await db.collection('player_match_stats').orderBy('last_updated', 'desc').limit(10).get();
    console.log('📊 Player match stats found:', snapshot.size);
    
    if (snapshot.size > 0) {
      console.log('\n🏈 Recent AFL player stats:');
      snapshot.docs.forEach((doc, index) => {
        const data = doc.data();
        console.log(`${index + 1}. ${data.player_name} (${data.team}) vs ${data.opposition} - Round ${data.round}, ${data.season}`);
        console.log(`   📈 Disposals: ${data.stats?.disposals}, Goals: ${data.stats?.goals}, Value: ${data.stats?.player_value}`);
        console.log(`   🔑 Document ID: ${doc.id}`);
      });
    }
  } catch (error) {
    console.error('Error:', error.message);
  }
}

checkData();
