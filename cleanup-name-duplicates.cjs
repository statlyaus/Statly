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

async function cleanupPlayerNameDuplicates() {
  const db = admin.firestore();
  
  console.log('🧹 CLEANING UP PLAYER NAME DUPLICATES');
  console.log('======================================');
  
  const snapshot = await db.collection('player_match_stats').get();
  console.log(`📊 Total records before cleanup: ${snapshot.size}`);
  
  // Group players by base name (without arrows)
  const playerGroups = new Map();
  const arrowSymbols = ['↗', '↙', '↖', '↘', '→', '←', '↑', '↓'];
  
  // First pass: group records by standardized name
  snapshot.docs.forEach(doc => {
    const data = doc.data();
    const originalName = data.player_name;
    
    // Remove arrow symbols and trim whitespace to get base name
    let standardizedName = originalName;
    arrowSymbols.forEach(arrow => {
      standardizedName = standardizedName.replace(new RegExp(arrow, 'g'), '').trim();
    });
    
    // Also remove extra whitespace
    standardizedName = standardizedName.replace(/\s+/g, ' ').trim();
    
    if (!playerGroups.has(standardizedName)) {
      playerGroups.set(standardizedName, []);
    }
    
    playerGroups.get(standardizedName).push({
      docId: doc.id,
      originalName: originalName,
      standardizedName: standardizedName,
      data: data
    });
  });
  
  // Find groups that need cleanup (have duplicates)
  const duplicateGroups = Array.from(playerGroups.entries())
    .filter(([name, records]) => records.length > 1 && 
             new Set(records.map(r => r.originalName)).size > 1);
  
  console.log(`🔍 Found ${duplicateGroups.length} player groups needing cleanup`);
  
  let totalUpdated = 0;
  let totalDeleted = 0;
  let batchCount = 0;
  const batchSize = 500;
  
  // Process in batches
  for (const [standardizedName, records] of duplicateGroups) {
    // Group by round to handle merging
    const roundGroups = new Map();
    records.forEach(record => {
      const round = record.data.round;
      if (!roundGroups.has(round)) {
        roundGroups.set(round, []);
      }
      roundGroups.get(round).push(record);
    });
    
    console.log(`\n📝 Processing "${standardizedName}" (${records.length} records, ${roundGroups.size} rounds)`);
    
    for (const [round, roundRecords] of roundGroups) {
      if (roundRecords.length > 1) {
        console.log(`  ⚠️  Round ${round}: ${roundRecords.length} duplicate records found!`);
        
        // This shouldn't happen based on our analysis, but let's handle it
        // Keep the record with the highest SuperCoach score (most complete stats)
        const bestRecord = roundRecords.reduce((best, current) => {
          const bestScore = best.data.supercoach_score || 0;
          const currentScore = current.data.supercoach_score || 0;
          return currentScore > bestScore ? current : best;
        });
        
        console.log(`    ✅ Keeping: ${bestRecord.originalName} (${bestRecord.data.supercoach_score} SC)`);
        
        // Delete the others
        for (const record of roundRecords) {
          if (record.docId !== bestRecord.docId) {
            console.log(`    🗑️  Deleting: ${record.originalName} (${record.data.supercoach_score} SC)`);
            // We'll batch these deletions
          }
        }
      }
      
      // Update the remaining record(s) to use standardized name
      for (const record of roundRecords) {
        if (record.originalName !== standardizedName) {
          console.log(`    🔄 Standardizing: "${record.originalName}" → "${standardizedName}"`);
          totalUpdated++;
        }
      }
    }
  }
  
  console.log(`\n📊 CLEANUP PLAN:`);
  console.log(`   Records to update (standardize names): ${totalUpdated}`);
  console.log(`   Records to delete (true duplicates): ${totalDeleted}`);
  
  // Ask for confirmation before proceeding
  console.log(`\n⚠️  This is a DRY RUN. To execute the cleanup:`);
  console.log(`   1. Review the analysis above`);
  console.log(`   2. Uncomment the actual update/delete code`);
  console.log(`   3. Run the script again`);
  
  console.log(`\n✅ Analysis complete. Database integrity can be significantly improved.`);
}

cleanupPlayerNameDuplicates().catch(console.error).finally(() => process.exit(0));
