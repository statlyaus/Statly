import admin from 'firebase-admin';
import { readFileSync } from 'fs';

const serviceAccount = JSON.parse(readFileSync('./statly-4cbed-firebase-adminsdk-fbsvc-7df0e3dae3.json', 'utf8'));

if (!admin.apps.length) {
  admin.initializeApp({
    credential: admin.credential.cert(serviceAccount)
  });
}

const db = admin.firestore();

async function checkPlayers() {
  try {
    const snapshot = await db.collection('players').limit(3).get();
    console.log('Found', snapshot.size, 'players');
    
    snapshot.forEach(doc => {
      const data = doc.data();
      console.log('\nPlayer ID:', doc.id);
      console.log('Name:', data.name || data.playerName);
      console.log('Team:', data.team);
      console.log('Has goals?', data.goals !== undefined);
      console.log('Has tackles?', data.tackles !== undefined);
      console.log('Has stats object?', data.stats !== undefined);
      if (data.stats) {
        console.log('Stats keys:', Object.keys(data.stats));
      }
      console.log('Sample fields:', {
        goals: data.goals,
        tackles: data.tackles,
        kicks: data.kicks,
        games: data.games
      });
    });
  } catch (error) {
    console.error('Error:', error);
  }
  
  process.exit(0);
}

checkPlayers();
