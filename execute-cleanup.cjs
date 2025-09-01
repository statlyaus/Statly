require('dotenv').config({ path: '.env.local' });
const admin = require('firebase-admin');

// Initialize Firebase Admin SDK
if (!admin.apps.length) {
  const serviceAccountBase64 = process.env.FIREBASE_SERVICE_ACCOUNT_JSON_BASE64;
  const serviceAccountJson = Buffer.from(serviceAccountBase64, 'base64').toString('utf-8');
  const serviceAccount = JSON.parse(serviceAccountJson);

  admin.initializeApp({
    credential: admin.credential.cert(serviceAccount),
  });
}

const firestore = admin.firestore();

function standardizeName(name) {
  // Remove arrow symbols and extra spaces
  return name
    .replace(/\s*[↗↙↖↘]\s*/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

async function executeCleanup() {
  console.log('🧹 Starting player name standardization cleanup...\n');

  const collectionRef = firestore.collection('player_match_stats');
  const snapshot = await collectionRef.get();

  let totalUpdated = 0;
  let batchCount = 0;
  const batchSize = 500;
  let batch = firestore.batch();

  // Group documents by standardized player name
  const playerGroups = new Map();

  snapshot.forEach((doc) => {
    const data = doc.data();
    const originalName = data.player_name;
    const standardizedName = standardizeName(originalName);

    if (!playerGroups.has(standardizedName)) {
      playerGroups.set(standardizedName, []);
    }

    playerGroups.get(standardizedName).push({
      doc: doc,
      originalName: originalName,
      standardizedName: standardizedName,
    });
  });

  console.log(`📊 Found ${playerGroups.size} unique standardized player names`);
  console.log(`🔍 Processing ${snapshot.size} total records...\n`);

  // Process each player group
  for (const [standardizedName, records] of playerGroups.entries()) {
    // Only process if there are records that need standardization
    const needsUpdate = records.filter((r) => r.originalName !== r.standardizedName);

    if (needsUpdate.length > 0) {
      console.log(`📝 Standardizing "${standardizedName}" (${needsUpdate.length} records)`);

      for (const record of needsUpdate) {
        console.log(`    🔄 "${record.originalName}" → "${record.standardizedName}"`);

        // Add to batch
        batch.update(record.doc.ref, { player_name: standardizedName });
        totalUpdated++;
        batchCount++;

        // Execute batch if it reaches batch size
        if (batchCount >= batchSize) {
          console.log(`\n💾 Executing batch update (${batchCount} operations)...`);
          await batch.commit();
          batch = firestore.batch();
          batchCount = 0;
        }
      }
    }
  }

  // Execute remaining batch operations
  if (batchCount > 0) {
    console.log(`\n💾 Executing final batch update (${batchCount} operations)...`);
    await batch.commit();
  }

  console.log(`\n✅ Cleanup completed successfully!`);
  console.log(`📊 Total records updated: ${totalUpdated}`);
  console.log(`🎯 All player names have been standardized (arrow symbols removed)`);
}

executeCleanup()
  .catch(console.error)
  .finally(() => process.exit(0));
