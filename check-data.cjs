const admin = require('firebase-admin');
const serviceAccount = require('./statly-4cbed-firebase-adminsdk-fbsvc-7df0e3dae3.json');

if (!admin.apps.length) {
  admin.initializeApp({
    credential: admin.credential.cert(serviceAccount),
    databaseURL: 'https://statly-4cbed-default-rtdb.firebaseio.com/'
  });
}

const db = admin.firestore();

async function checkData() {
  try {
    const snapshot = await db.collection('player_match_stats').get();
    console.log('Total player records:', snapshot.size);
    
    const rounds = {};
    const teams = new Set();
    
    snapshot.forEach(doc => {
      const data = doc.data();
      const round = data.round;
      rounds[round] = (rounds[round] || 0) + 1;
      teams.add(data.team);
    });
    
    console.log('\nRecords by round:');
    Object.keys(rounds).sort((a,b) => parseInt(a) - parseInt(b)).forEach(round => {
      console.log(`Round ${round}: ${rounds[round]} players`);
    });
    
    console.log(`\nTeams covered: ${teams.size} teams`);
    console.log('Teams:', Array.from(teams).sort().join(', '));
    
  } catch (error) {
    console.error('Error:', error);
  }
}

checkData();
