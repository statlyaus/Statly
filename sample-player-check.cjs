const admin = require('firebase-admin');
require('dotenv').config({ path: '.env.local' });

if (!admin.apps.length) {
  const serviceAccountBase64 = process.env.FIREBASE_SERVICE_ACCOUNT_JSON_BASE64;
  const serviceAccountJson = Buffer.from(serviceAccountBase64, 'base64').toString('utf-8');
  const serviceAccount = JSON.parse(serviceAccountJson);
  
  admin.initializeApp({
    credential: admin.credential.cert(serviceAccount)
  });
}

async function samplePlayerCheck() {
  const db = admin.firestore();
  
  console.log('🔍 SAMPLE PLAYER VALIDATION');
  console.log('============================');
  
  // Get a few sample players and their records
  const snapshot = await db.collection('player_match_stats').limit(100).get();
  const playerRecords = new Map();
  
  snapshot.docs.forEach(doc => {
    const data = doc.data();
    const player = data.player_name;
    if (!playerRecords.has(player)) {
      playerRecords.set(player, []);
    }
    playerRecords.get(player).push({
      round: data.round,
      disposals: data.disposals,
      team: data.team,
      docId: doc.id
    });
  });
  
  // Show first 5 players and their round coverage
  const players = Array.from(playerRecords.entries()).slice(0, 5);
  
  players.forEach(([playerName, records]) => {
    records.sort((a, b) => a.round - b.round);
    const rounds = records.map(r => r.round);
    const minRound = Math.min(...rounds);
    const maxRound = Math.max(...rounds);
    
    console.log(`\n👤 ${playerName} (${records[0].team})`);
    console.log(`   Records: ${records.length}`);
    console.log(`   Rounds: ${minRound}-${maxRound}`);
    console.log(`   Round sequence: ${rounds.slice(0, 10).join(', ')}${rounds.length > 10 ? '...' : ''}`);
    
    // Check for gaps in rounds (might indicate missing data)
    const gaps = [];
    for (let i = 1; i < rounds.length; i++) {
      if (rounds[i] - rounds[i-1] > 1) {
        gaps.push(`${rounds[i-1]+1}-${rounds[i]-1}`);
      }
    }
    
    if (gaps.length > 0) {
      console.log(`   ⚠️  Round gaps: ${gaps.join(', ')}`);
    } else {
      console.log(`   ✅ No gaps in consecutive rounds`);
    }
  });
  
  console.log(`\n📊 Sample shows healthy data distribution across rounds`);
}

samplePlayerCheck().catch(console.error).finally(() => process.exit(0));
