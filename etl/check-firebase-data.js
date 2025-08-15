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

async function checkData() {
  try {
    console.log('🔍 Checking Firebase for AFL player data...');

    const snapshot = await db.collection('player_stats').limit(10).get();
    console.log('📊 Player stats found in database:', snapshot.size);

    if (snapshot.size > 0) {
      console.log('\n🏈 Sample player records:');
      snapshot.docs.forEach((doc, index) => {
        const data = doc.data();
        console.log(
          `${index + 1}. ${data.player_name} (${data.team}) - Round ${data.round}, ${data.season}`
        );
        console.log(
          `   📈 ${data.disposals} disposals, ${data.goals} goals, ${data.player_value} value`
        );
      });
    } else {
      console.log('❌ No player stats found in database');
    }

    // Check match data too
    const matchSnapshot = await db.collection('matches').limit(5).get();
    console.log('\n🏟️ Matches found in database:', matchSnapshot.size);
  } catch (error) {
    console.error('❌ Error checking database:', error.message);
  }
}

checkData();
