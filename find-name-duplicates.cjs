const admin = require('firebase-admin');
require('dotenv').config({ path: '.env.local' });

if (!admin.apps.length) {
  const serviceAccountBase64 = process.env.FIREBASE_SERVICE_ACCOUNT_JSON_BASE64;
  const serviceAccountJson = Buffer.from(serviceAccountBase64, 'base64').toString('utf-8');
  const serviceAccount = JSON.parse(serviceAccountJson);

  admin.initializeApp({
    credential: admin.credential.cert(serviceAccount),
  });
}

async function findPlayerNameDuplicates() {
  const db = admin.firestore();

  console.log('🔍 PLAYER NAME VARIATION DUPLICATE CHECK');
  console.log('=========================================');

  const snapshot = await db.collection('player_match_stats').get();
  console.log(`📊 Total records: ${snapshot.size}`);

  // Group players by base name (without arrows)
  const playerVariations = new Map();
  const arrowSymbols = ['↗', '↙', '↖', '↘', '→', '←', '↑', '↓'];

  snapshot.docs.forEach((doc) => {
    const data = doc.data();
    const originalName = data.player_name;

    // Remove arrow symbols and trim whitespace to get base name
    let baseName = originalName;
    arrowSymbols.forEach((arrow) => {
      baseName = baseName.replace(new RegExp(arrow, 'g'), '').trim();
    });

    // Also remove extra whitespace
    baseName = baseName.replace(/\s+/g, ' ').trim();

    if (!playerVariations.has(baseName)) {
      playerVariations.set(baseName, new Map());
    }

    if (!playerVariations.get(baseName).has(originalName)) {
      playerVariations.get(baseName).set(originalName, []);
    }

    playerVariations.get(baseName).get(originalName).push({
      docId: doc.id,
      round: data.round,
      team: data.team,
      disposals: data.disposals,
      supercoach_score: data.supercoach_score,
    });
  });

  // Find players with multiple name variations
  const duplicateVariations = Array.from(playerVariations.entries())
    .filter(([baseName, variations]) => variations.size > 1)
    .sort((a, b) => b[1].size - a[1].size); // Sort by number of variations

  console.log(`\n🚨 FOUND ${duplicateVariations.length} PLAYERS WITH NAME VARIATIONS:`);
  console.log('====================================================');

  let totalDuplicateRecords = 0;

  duplicateVariations.forEach(([baseName, variations], index) => {
    const variationNames = Array.from(variations.keys());
    const totalRecords = Array.from(variations.values()).reduce(
      (sum, records) => sum + records.length,
      0
    );
    totalDuplicateRecords += totalRecords;

    console.log(`\n${index + 1}. "${baseName}" (${totalRecords} total records)`);
    console.log('   Variations:');

    variationNames.forEach((varName) => {
      const records = variations.get(varName);
      const rounds = records.map((r) => r.round).sort((a, b) => a - b);
      const teams = [...new Set(records.map((r) => r.team))];

      console.log(`     "${varName}": ${records.length} records`);
      console.log(
        `       Rounds: ${rounds.slice(0, 5).join(', ')}${rounds.length > 5 ? '...' : ''}`
      );
      console.log(`       Teams: ${teams.join(', ')}`);

      // Show a sample record for context
      if (records.length > 0) {
        const sample = records[0];
        console.log(
          `       Sample: R${sample.round} - ${sample.disposals} disposals, ${sample.supercoach_score} SC`
        );
      }
    });
  });

  // Analyze overlap patterns
  console.log(`\n📊 OVERLAP ANALYSIS:`);
  console.log('===================');

  let roundOverlaps = 0;
  let potentialDuplicates = 0;

  duplicateVariations.forEach(([baseName, variations]) => {
    const variationNames = Array.from(variations.keys());
    const allRounds = new Map(); // round -> [variation names that have records in this round]

    variationNames.forEach((varName) => {
      const records = variations.get(varName);
      records.forEach((record) => {
        if (!allRounds.has(record.round)) {
          allRounds.set(record.round, []);
        }
        allRounds.get(record.round).push(varName);
      });
    });

    // Check for rounds where multiple variations exist
    const overlappingRounds = Array.from(allRounds.entries()).filter(
      ([round, varNames]) => varNames.length > 1
    );

    if (overlappingRounds.length > 0) {
      roundOverlaps += overlappingRounds.length;
      potentialDuplicates++;

      console.log(`\n⚠️  "${baseName}" has overlapping rounds:`);
      overlappingRounds.slice(0, 3).forEach(([round, varNames]) => {
        console.log(`     Round ${round}: ${varNames.join(' vs ')}`);
      });
      if (overlappingRounds.length > 3) {
        console.log(`     ... and ${overlappingRounds.length - 3} more overlapping rounds`);
      }
    }
  });

  // Summary and recommendations
  console.log(`\n📋 DUPLICATE SUMMARY:`);
  console.log('====================');
  console.log(`❌ Players with name variations: ${duplicateVariations.length}`);
  console.log(`❌ Total records affected: ${totalDuplicateRecords}`);
  console.log(`❌ Players with round overlaps: ${potentialDuplicates}`);
  console.log(`❌ Overlapping round instances: ${roundOverlaps}`);

  console.log(`\n🔧 CLEANUP RECOMMENDATIONS:`);
  console.log('============================');
  console.log(`1. Standardize player names by removing arrow symbols`);
  console.log(`2. Merge records for the same player in the same round`);
  console.log(`3. Keep the most complete/accurate record when merging`);
  console.log(
    `4. Estimated cleanup: Remove ~${Math.floor(totalDuplicateRecords * 0.3)} redundant records`
  );

  // Show top 10 most problematic cases
  if (duplicateVariations.length > 0) {
    console.log(`\n🎯 TOP 10 CASES TO PRIORITIZE:`);
    console.log('==============================');
    duplicateVariations.slice(0, 10).forEach(([baseName, variations], index) => {
      const totalRecords = Array.from(variations.values()).reduce(
        (sum, records) => sum + records.length,
        0
      );
      const variationCount = variations.size;
      console.log(
        `${index + 1}. "${baseName}" - ${variationCount} variations, ${totalRecords} records`
      );
    });
  }
}

findPlayerNameDuplicates()
  .catch(console.error)
  .finally(() => process.exit(0));
