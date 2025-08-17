const { initializeApp, cert } = require('firebase-admin/app');
const { getFirestore } = require('firebase-admin/firestore');
const fs = require('fs');
const readline = require('readline');

// Load environment variables and run
require('dotenv').config({ path: '/workspaces/Statly/.env.local' });

// Initialize Firebase Admin
const serviceAccountBase64 = process.env.FIREBASE_SERVICE_ACCOUNT_JSON_BASE64;

if (!serviceAccountBase64) {
  throw new Error('FIREBASE_SERVICE_ACCOUNT_JSON_BASE64 environment variable is required');
}

const serviceAccount = JSON.parse(
  Buffer.from(serviceAccountBase64, 'base64').toString('utf-8')
);

initializeApp({
  credential: cert(serviceAccount),
  databaseURL: "https://statly-4cbed-default-rtdb.firebaseio.com"
});

const db = getFirestore();

async function uploadCompleteSeasonData() {
  console.log('🔥 Uploading complete 2025 season data to Firebase...');
  
  try {
    // First, clear existing data in smaller batches
    console.log('🧹 Clearing existing player_match_stats data...');
    const existingRef = db.collection('player_match_stats');
    
    let deletedCount = 0;
    let hasMore = true;
    
    while (hasMore) {
      const snapshot = await existingRef.limit(500).get();
      
      if (snapshot.empty) {
        hasMore = false;
        break;
      }
      
      const batch = db.batch();
      snapshot.docs.forEach(doc => {
        batch.delete(doc.ref);
      });
      
      await batch.commit();
      deletedCount += snapshot.size;
      console.log(`🗑️  Deleted ${deletedCount} records so far...`);
    }
    
    console.log(`✅ Cleared ${deletedCount} existing records`);

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

uploadCompleteSeasonData().then(() => {
  console.log('🏁 Upload process completed');
  process.exit(0);
}).catch(error => {
  console.error('💥 Fatal error:', error);
  process.exit(1);
});
