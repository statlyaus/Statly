const admin = require('firebase-admin');
require('dotenv/config');

if (!admin.apps.length) {
  const serviceAccountBase64 = process.env.FIREBASE_SERVICE_ACCOUNT_JSON_BASE64;
  const serviceAccountJson = Buffer.from(serviceAccountBase64, 'base64').toString('utf-8');
  const serviceAccount = JSON.parse(serviceAccountJson);
  
  admin.initializeApp({
    credential: admin.credential.cert(serviceAccount)
  });
}

const db = admin.firestore();

async function checkRounds() {
  console.log('🔍 Checking rounds available in database...\n');
  
  try {
    const snapshot = await db.collection('player_stats_2025').limit(2000).get();
    const rounds = new Set();
    const teams = new Set();
    const matchUids = new Set();
    let totalRecords = 0;
    
    snapshot.forEach(doc => {
      const data = doc.data();
      if (data.round) {
        rounds.add(data.round);
      }
      if (data.team) {
        teams.add(data.team);
      }
      if (data.match_uid) {
        matchUids.add(data.match_uid);
      }
      totalRecords++;
    });
    
    console.log('📊 DATA SUMMARY:');
    console.log('================');
    console.log('Total player stat records:', totalRecords);
    console.log('Unique rounds found:', Array.from(rounds).sort((a,b) => a-b));
    console.log('Number of teams:', teams.size);
    console.log('Unique matches:', matchUids.size);
    console.log('\nTeams:', Array.from(teams).sort());
    
    // Sample match UIDs to see structure
    console.log('\n🎯 SAMPLE MATCHES:');
    console.log('==================');
    const sampleMatches = Array.from(matchUids).slice(0, 10);
    sampleMatches.forEach(match => console.log(match));
    
  } catch (error) {
    console.error('Error:', error.message);
  }
  
  process.exit(0);
}

checkRounds();
