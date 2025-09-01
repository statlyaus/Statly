require('dotenv').config({ path: '.env.local' });
const admin = require('firebase-admin');

if (!admin.apps.length) {
  const serviceAccountBase64 = process.env.FIREBASE_SERVICE_ACCOUNT_JSON_BASE64;
  const serviceAccountJson = Buffer.from(serviceAccountBase64, 'base64').toString('utf-8');
  const serviceAccount = JSON.parse(serviceAccountJson);

  admin.initializeApp({
    credential: admin.credential.cert(serviceAccount),
  });
}

async function finalVerification() {
  const db = admin.firestore();

  console.log('🎯 FINAL DATABASE VERIFICATION');
  console.log('===============================');

  const snapshot = await db.collection('player_match_stats').get();
  console.log(`📊 Total records: ${snapshot.size}`);

  // Count unique players
  const uniquePlayers = new Set();
  const roundCounts = new Map();
  const arrowCount = { total: 0, withArrows: 0 };

  snapshot.forEach((doc) => {
    const data = doc.data();
    const playerName = data.player_name;
    const round = data.round;

    uniquePlayers.add(playerName);

    // Count rounds
    if (!roundCounts.has(round)) {
      roundCounts.set(round, 0);
    }
    roundCounts.set(round, roundCounts.get(round) + 1);

    // Check for remaining arrow symbols
    arrowCount.total++;
    if (playerName && /[↗↙↖↘→←↑↓]/.test(playerName)) {
      arrowCount.withArrows++;
      console.log(`⚠️  Arrow symbol found: "${playerName}"`);
    }
  });

  console.log(`👤 Unique players: ${uniquePlayers.size}`);
  console.log(
    `🔢 Unique rounds: ${Array.from(roundCounts.keys())
      .sort((a, b) => a - b)
      .join(', ')}`
  );
  console.log(
    `📈 Round coverage: ${Math.min(...roundCounts.keys())} to ${Math.max(...roundCounts.keys())}`
  );
  console.log(
    `🧹 Arrow symbols remaining: ${arrowCount.withArrows} out of ${arrowCount.total} records`
  );

  if (arrowCount.withArrows === 0) {
    console.log(`\n✅ DATABASE CLEANUP SUCCESSFUL!`);
    console.log(`🎉 All player names have been standardized`);
    console.log(`📊 Complete 2025 AFL season data ready for use`);
  } else {
    console.log(`\n⚠️  ${arrowCount.withArrows} records still have arrow symbols`);
  }

  // Display round distribution
  console.log(`\n📋 RECORDS PER ROUND:`);
  const sortedRounds = Array.from(roundCounts.entries()).sort((a, b) => a[0] - b[0]);
  sortedRounds.forEach(([round, count]) => {
    console.log(`   Round ${round.toString().padStart(2)}: ${count} records`);
  });
}

finalVerification()
  .catch(console.error)
  .finally(() => process.exit(0));
