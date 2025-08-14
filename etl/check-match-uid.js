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

async function checkFirstRecord() {
  try {
    const snapshot = await db.collection('player_match_stats').limit(1).get();
    if (snapshot.size > 0) {
      const data = snapshot.docs[0].data();
      console.log('Sample record structure:');
      console.log('Match UID:', data.match_uid);
      console.log('Player:', data.player_name, 'Team:', data.team);
      console.log('Opposition:', data.opposition);
      console.log('Round:', data.round, 'Season:', data.season);
      console.log('Available stats:', Object.keys(data.stats || {}));
    }
  } catch (error) {
    console.error('Error:', error.message);
  }
}

checkFirstRecord();
