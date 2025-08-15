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

async function getStats() {
  try {
    console.log('📊 Analyzing AFL 2025 database...');

    // Get total count
    const snapshot = await db.collection('player_match_stats').get();
    console.log('🎯 Total AFL records:', snapshot.size);

    // Get unique players, teams, rounds
    const players = new Set();
    const teams = new Set();
    const rounds = new Set();

    snapshot.docs.forEach((doc) => {
      const data = doc.data();
      players.add(data.player_name);
      teams.add(data.team);
      rounds.add(data.round);
    });

    console.log('👥 Unique players:', players.size);
    console.log('🏟️  Teams represented:', teams.size);
    console.log(
      '📅 Rounds covered:',
      Array.from(rounds)
        .sort((a, b) => a - b)
        .join(', ')
    );
  } catch (error) {
    console.error('Error:', error.message);
  }
}

getStats();
