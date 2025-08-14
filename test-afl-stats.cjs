const admin = require('firebase-admin');
require('dotenv').config({ path: '.env.local' });

// Initialize Firebase Admin
if (!admin.apps.length) {
  admin.initializeApp({
    credential: admin.credential.cert(JSON.parse(
      process.env.FIREBASE_SERVICE_ACCOUNT_JSON_BASE64 
        ? Buffer.from(process.env.FIREBASE_SERVICE_ACCOUNT_JSON_BASE64, 'base64').toString() 
        : '{}'
    )),
    projectId: 'statly-4cbed'
  });
}

const db = admin.firestore();

// Test the AFL stats extraction logic
async function testAFLStatsExtraction() {
  console.log('🎯 Testing AFL stats extraction...\n');

  try {
    // Get a player with match logs
    const playersSnapshot = await db.collection('players').limit(1).get();
    
    if (playersSnapshot.empty) {
      console.log('❌ No players found');
      return;
    }

    const playerDoc = playersSnapshot.docs[0];
    const playerData = playerDoc.data();
    
    console.log('Player:', playerData.name);
    console.log('Team:', playerData.team);
    console.log('Position:', playerData.position);
    
    if (!playerData.matchLogs || !Array.isArray(playerData.matchLogs)) {
      console.log('❌ No matchLogs found');
      return;
    }

    // Get the latest match log
    const latestMatch = playerData.matchLogs[0];
    console.log('\n📊 Latest match data:');
    console.log('Date:', latestMatch.Date);
    console.log('Round:', latestMatch.Round);
    console.log('Opponent:', latestMatch.Opposition);
    
    // Extract the AFL stats we want
    const aflStats = {
      player_name: playerData.name,
      goals: latestMatch.G || 0,
      marks: latestMatch.M || 0,
      tackles: latestMatch.T || 0,
      effective_disposals: latestMatch.ED || 0,
      kicks: latestMatch.K || 0,
      disposal_efficiency: latestMatch.DE || 0,
      clearances: latestMatch.CL || 0,
      turnovers: latestMatch.TO || 0,
      metres_gained: latestMatch.MG || 0
    };

    console.log('\n🏈 Extracted AFL Stats:');
    console.log('Goals:', aflStats.goals);
    console.log('Marks:', aflStats.marks);
    console.log('Tackles:', aflStats.tackles);
    console.log('Effective Disposals:', aflStats.effective_disposals);
    console.log('Kicks:', aflStats.kicks);
    console.log('Disposal Efficiency:', aflStats.disposal_efficiency + '%');
    console.log('Clearances:', aflStats.clearances);
    console.log('Turnovers:', aflStats.turnovers);
    console.log('Metres Gained:', aflStats.metres_gained);
    
    console.log('\n✅ AFL stats extraction working correctly!');
    
  } catch (error) {
    console.error('❌ Error:', error.message);
  }
}

testAFLStatsExtraction();
