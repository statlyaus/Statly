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

async function getMatches() {
  try {
    const snapshot = await db.collection('player_match_stats').get();
    const matches = new Set();
    snapshot.docs.forEach((doc) => {
      matches.add(doc.data().match_uid);
    });
    console.log('Available match UIDs:');
    Array.from(matches)
      .sort()
      .forEach((match) => console.log(match));
  } catch (error) {
    console.error('Error:', error.message);
  }
}

getMatches();
