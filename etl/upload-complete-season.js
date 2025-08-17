const { initializeApp, cert } = require('firebase-admin/app');
const { getFirestore } = require('firebase-admin/firestore');
const fs = require('fs');
const readline = require('readline');

// Initialize Firebase Admin
const serviceAccount = require('/workspaces/Statly/statly-4cbed-firebase-adminsdk-fbsvc-7df0e3dae3.json');

initializeApp({
  credential: cert(serviceAccount),
  databaseURL: "https://statly-4cbed-default-rtdb.firebaseio.com"
});

const db = getFirestore();

async function uploadCompleteSeasonData() {
  console.log('🔥 Uploading complete 2025 season data to Firebase...');
  
  try {
    // First, clear existing data
    console.log('🧹 Clearing existing player_match_stats data...');
    const existingRef = db.collection('player_match_stats');
    const existingSnapshot = await existingRef.get();
    
    const batch = db.batch();
    existingSnapshot.docs.forEach(doc => {
      batch.delete(doc.ref);
    });
    await batch.commit();
    console.log(`✅ Cleared ${existingSnapshot.size} existing records`);

    // Upload new complete data
    const fileStream = fs.createReadStream('/workspaces/Statly/etl/full_2025_data.ndjson');
    const rl = readline.createInterface({
      input: fileStream,
      crlfDelay: Infinity
    });

    let uploadCount = 0;
    let currentBatch = db.batch();
    const batchSize = 500; // Firestore batch limit

    for await (const line of rl) {
      if (line.trim()) {
        try {
          const playerStats = JSON.parse(line);
          
          // Generate document ID (consistent with original ETL)
          const docId = `${playerStats.player_id}_${playerStats.season}_${playerStats.round}`;
          const docRef = db.collection('player_match_stats').doc(docId);
          
          currentBatch.set(docRef, playerStats);
          uploadCount++;

          // Commit batch when it reaches limit
          if (uploadCount % batchSize === 0) {
            await currentBatch.commit();
            console.log(`📤 Uploaded ${uploadCount} records...`);
            currentBatch = db.batch();
          }
        } catch (parseError) {
          console.error('Parse error for line:', line.substring(0, 100), parseError);
        }
      }
    }

    // Commit final batch
    if (uploadCount % batchSize !== 0) {
      await currentBatch.commit();
    }

    console.log(`🎉 Successfully uploaded ${uploadCount} player stats records!`);
    
    // Verify upload
    const verifySnapshot = await db.collection('player_match_stats').get();
    console.log(`✅ Verification: ${verifySnapshot.size} records in database`);
    
    // Check round coverage
    const rounds = new Set();
    verifySnapshot.docs.forEach(doc => {
      rounds.add(doc.data().round);
    });
    console.log(`📊 Rounds in database: ${Array.from(rounds).sort((a,b) => a-b).join(', ')}`);
    
  } catch (error) {
    console.error('❌ Upload failed:', error);
  }
}

// Load environment variables and run
require('dotenv/config');
uploadCompleteSeasonData().then(() => {
  console.log('🏁 Upload process completed');
  process.exit(0);
}).catch(error => {
  console.error('💥 Fatal error:', error);
  process.exit(1);
});
