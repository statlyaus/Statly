// Test script to examine player data structure
const admin = require('firebase-admin');
require('dotenv').config({ path: '.env.local' });

if (!admin.apps.length) {
  const serviceAccountJson = process.env.FIREBASE_SERVICE_ACCOUNT_JSON_BASE64
    ? Buffer.from(process.env.FIREBASE_SERVICE_ACCOUNT_JSON_BASE64, 'base64').toString()
    : '{}';

  admin.initializeApp({
    credential: admin.credential.cert(JSON.parse(serviceAccountJson)),
    projectId: 'statly-4cbed',
  });
}

const db = admin.firestore();

async function examinePlayerData() {
  try {
    console.log('Examining player data structure...\n');

    const snapshot = await db.collection('players').limit(3).get();

    if (snapshot.empty) {
      console.log('No players found in collection');
      return;
    }

    snapshot.forEach((doc) => {
      console.log(`Player ID: ${doc.id}`);
      const data = doc.data();
      console.log('Available fields:');
      Object.keys(data).forEach((key) => {
        console.log(`  ${key}: ${typeof data[key]} = ${data[key]}`);
      });
      console.log('---\n');
    });
  } catch (error) {
    console.error('Error:', error);
  }
}

examinePlayerData();
