const admin = require('firebase-admin');

// Initialize Firebase admin if not already initialized
if (!admin.apps.length) {
  const serviceAccount = require('./statly-4cbed-firebase-adminsdk-fbsvc-7df0e3dae3.json');
  admin.initializeApp({
    credential: admin.credential.cert(serviceAccount),
    databaseURL: 'https://statly-4cbed-default-rtdb.firebaseio.com',
  });
}

const db = admin.firestore();

async function checkFields() {
  try {
    const snapshot = await db
      .collection('player_match_stats')
      .where('match_uid', '==', '2025-R1-CAR-RIC')
      .limit(1)
      .get();

    if (!snapshot.empty) {
      const doc = snapshot.docs[0];
      const data = doc.data();
      console.log('Sample record fields:');
      console.log(Object.keys(data).sort());
      console.log('\nTimestamp fields:');
      Object.keys(data).forEach((key) => {
        if (key.includes('time') || key.includes('date') || key.includes('updated')) {
          console.log(`${key}: ${data[key]}`);
        }
      });
    }
  } catch (error) {
    console.error('Error:', error);
  }
}

checkFields();
