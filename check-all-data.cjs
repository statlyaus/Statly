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

const db = admin.firestore();

async function checkAllRounds() {
  console.log('🔍 Comprehensive database analysis...\n');
  
  try {
    // Check multiple collections that might contain data
    const collections = [
      'player_match_stats',
      'player_stats_2025', 
      'match_stats',
      'afl_player_stats'
    ];
    
    for (const collectionName of collections) {
      console.log(`\n📊 COLLECTION: ${collectionName}`);
      console.log('='.repeat(50));
      
      try {
        const snapshot = await db.collection(collectionName)
          .where('season', '==', 2025)
          .limit(2000)
          .get();
          
        if (snapshot.empty) {
          console.log('❌ No data found');
          continue;
        }
        
        const rounds = new Set();
        const players = new Set();
        let totalRecords = 0;
        
        snapshot.forEach(doc => {
          const data = doc.data();
          if (data.round || data.round_number) {
            rounds.add(data.round || data.round_number);
          }
          if (data.player_name) {
            players.add(data.player_name);
          }
          totalRecords++;
        });
        
        console.log(`✅ Records found: ${totalRecords}`);
        console.log(`🏃‍♂️ Unique players: ${players.size}`);
        console.log(`🔢 Rounds: ${Array.from(rounds).sort((a,b) => a-b).join(', ')}`);
        
        // Sample a few records to see structure
        if (snapshot.docs.length > 0) {
          console.log('\n📋 Sample record structure:');
          const sampleData = snapshot.docs[0].data();
          console.log(JSON.stringify({
            player_name: sampleData.player_name,
            round: sampleData.round || sampleData.round_number,
            team: sampleData.team,
            season: sampleData.season,
            hasStats: !!sampleData.stats,
            hasRawRow: !!sampleData.raw_row
          }, null, 2));
        }
        
      } catch (error) {
        console.log(`❌ Collection ${collectionName} error: ${error.message}`);
      }
    }
    
  } catch (error) {
    console.error('❌ Error:', error.message);
  }
  
  process.exit(0);
}

checkAllRounds();
