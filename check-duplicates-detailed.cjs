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

async function checkDuplicates() {
  const db = admin.firestore();
  
  console.log('🔍 DUPLICATE CHECK ANALYSIS');
  console.log('============================');
  
  const snapshot = await db.collection('player_match_stats').get();
  console.log(`📊 Total records: ${snapshot.size}`);
  
  // Track duplicates by different criteria
  const duplicatesByPlayerRound = new Map();
  const duplicatesByDocId = new Map();
  const duplicatesByContent = new Map();
  
  // Check for duplicates
  snapshot.docs.forEach(doc => {
    const data = doc.data();
    const docId = doc.id;
    
    // Check by player_name + season + round (logical duplicates)
    const playerRoundKey = `${data.player_name}_${data.season}_${data.round}`;
    if (!duplicatesByPlayerRound.has(playerRoundKey)) {
      duplicatesByPlayerRound.set(playerRoundKey, []);
    }
    duplicatesByPlayerRound.get(playerRoundKey).push({
      docId,
      player_name: data.player_name,
      round: data.round,
      disposals: data.disposals,
      supercoach_score: data.supercoach_score
    });
    
    // Check by document ID (should be unique)
    if (!duplicatesByDocId.has(docId)) {
      duplicatesByDocId.set(docId, []);
    }
    duplicatesByDocId.get(docId).push(data.player_name);
    
    // Check by content hash (identical stats)
    const contentKey = `${data.player_name}_${data.round}_${data.disposals}_${data.supercoach_score}_${data.player_value}`;
    if (!duplicatesByContent.has(contentKey)) {
      duplicatesByContent.set(contentKey, []);
    }
    duplicatesByContent.get(contentKey).push(docId);
  });
  
  // Find logical duplicates (same player, same round)
  console.log('\n🔍 LOGICAL DUPLICATES (Same Player + Round):');
  const logicalDuplicates = Array.from(duplicatesByPlayerRound.entries())
    .filter(([key, records]) => records.length > 1);
  
  if (logicalDuplicates.length > 0) {
    console.log(`❌ Found ${logicalDuplicates.length} logical duplicates:`);
    logicalDuplicates.slice(0, 10).forEach(([key, records]) => {
      console.log(`   ${key}:`);
      records.forEach(record => {
        console.log(`     - ${record.docId} (${record.disposals} disposals, ${record.supercoach_score} SC)`);
      });
    });
    if (logicalDuplicates.length > 10) {
      console.log(`   ... and ${logicalDuplicates.length - 10} more`);
    }
  } else {
    console.log('✅ No logical duplicates found');
  }
  
  // Find document ID duplicates
  console.log('\n🔍 DOCUMENT ID DUPLICATES:');
  const docIdDuplicates = Array.from(duplicatesByDocId.entries())
    .filter(([docId, players]) => players.length > 1);
  
  if (docIdDuplicates.length > 0) {
    console.log(`❌ Found ${docIdDuplicates.length} document ID duplicates:`);
    docIdDuplicates.slice(0, 5).forEach(([docId, players]) => {
      console.log(`   ${docId}: ${players.join(', ')}`);
    });
  } else {
    console.log('✅ No document ID duplicates found');
  }
  
  // Find identical content duplicates
  console.log('\n🔍 IDENTICAL CONTENT DUPLICATES:');
  const contentDuplicates = Array.from(duplicatesByContent.entries())
    .filter(([content, docIds]) => docIds.length > 1);
  
  if (contentDuplicates.length > 0) {
    console.log(`❌ Found ${contentDuplicates.length} identical content duplicates:`);
    contentDuplicates.slice(0, 5).forEach(([content, docIds]) => {
      console.log(`   ${content}: ${docIds.join(', ')}`);
    });
  } else {
    console.log('✅ No identical content duplicates found');
  }
  
  // Round distribution check
  console.log('\n📊 ROUND DISTRIBUTION ANALYSIS:');
  const roundCounts = new Map();
  snapshot.docs.forEach(doc => {
    const round = doc.data().round;
    roundCounts.set(round, (roundCounts.get(round) || 0) + 1);
  });
  
  const sortedRounds = Array.from(roundCounts.entries()).sort((a, b) => a[0] - b[0]);
  sortedRounds.forEach(([round, count]) => {
    console.log(`   Round ${round.toString().padStart(2)}: ${count.toString().padStart(3)} records`);
  });
  
  // Player distribution check
  console.log('\n👥 PLAYER DISTRIBUTION ANALYSIS:');
  const playerCounts = new Map();
  snapshot.docs.forEach(doc => {
    const player = doc.data().player_name;
    playerCounts.set(player, (playerCounts.get(player) || 0) + 1);
  });
  
  const uniquePlayers = playerCounts.size;
  const totalRecords = snapshot.size;
  const avgRecordsPerPlayer = totalRecords / uniquePlayers;
  
  console.log(`   Unique players: ${uniquePlayers}`);
  console.log(`   Average records per player: ${avgRecordsPerPlayer.toFixed(1)}`);
  
  // Find players with unusual record counts
  const playerRecordCounts = Array.from(playerCounts.entries());
  const maxRecords = Math.max(...playerRecordCounts.map(([_, count]) => count));
  const minRecords = Math.min(...playerRecordCounts.map(([_, count]) => count));
  
  console.log(`   Max records for a player: ${maxRecords}`);
  console.log(`   Min records for a player: ${minRecords}`);
  
  if (maxRecords > 25) {  // More than 25 rounds is unusual
    const playersWithTooManyRecords = playerRecordCounts
      .filter(([_, count]) => count > 25)
      .slice(0, 5);
    console.log('\n⚠️  Players with unusually high record counts:');
    playersWithTooManyRecords.forEach(([player, count]) => {
      console.log(`   ${player}: ${count} records`);
    });
  }
  
  // Summary
  console.log('\n📋 DUPLICATE CHECK SUMMARY:');
  console.log('=============================');
  console.log(`✅ Total records: ${snapshot.size}`);
  console.log(`${logicalDuplicates.length === 0 ? '✅' : '❌'} Logical duplicates: ${logicalDuplicates.length}`);
  console.log(`${docIdDuplicates.length === 0 ? '✅' : '❌'} Document ID duplicates: ${docIdDuplicates.length}`);
  console.log(`${contentDuplicates.length === 0 ? '✅' : '❌'} Identical content duplicates: ${contentDuplicates.length}`);
  console.log(`✅ Unique players: ${uniquePlayers}`);
  console.log(`✅ Rounds covered: ${sortedRounds.length} (${sortedRounds[0][0]} to ${sortedRounds[sortedRounds.length-1][0]})`);
  
  if (logicalDuplicates.length === 0 && docIdDuplicates.length === 0 && contentDuplicates.length === 0) {
    console.log('\n🎉 DATABASE INTEGRITY: EXCELLENT - No duplicates found!');
  } else {
    console.log('\n⚠️  DATABASE INTEGRITY: Issues detected - duplicates need cleanup');
  }
}

checkDuplicates().catch(console.error).finally(() => process.exit(0));
