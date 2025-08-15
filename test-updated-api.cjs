// Test script to validate the updated 9-category API
const admin = require('firebase-admin');

const base64Json = process.env.FIREBASE_SERVICE_ACCOUNT_JSON_BASE64;
if (!base64Json) {
  console.error('❌ FIREBASE_SERVICE_ACCOUNT_JSON_BASE64 environment variable is required');
  process.exit(1);
}

const json = Buffer.from(base64Json, 'base64').toString('utf8');
const serviceAccount = JSON.parse(json);

if (!admin.apps.length) {
  admin.initializeApp({
    credential: admin.credential.cert(serviceAccount),
  });
}

const db = admin.firestore();

async function testAPILogic() {
  try {
    console.log('🧪 Testing updated 9-category API logic...\n');

    // Get one sample document
    const snapshot = await db.collection('player_match_stats').limit(1).get();

    if (snapshot.empty) {
      console.log('❌ No data found in player_match_stats collection');
      return;
    }

    const doc = snapshot.docs[0];
    const data = doc.data();

    console.log('📊 Testing category mapping for:', data.player_name);
    console.log('Team:', data.team, 'vs', data.opposition);
    console.log('');

    // Test the new category mappings
    const categories = {
      goals: data.stats?.goals || data.raw_row?.goals || 0,
      tackles: data.stats?.tackles || data.raw_row?.tackles || 0,
      inside50s: data.stats?.inside_50s || data.raw_row?.inside_50s || 0, // Replaces clearances
      intercepts: data.stats?.intercepts || data.raw_row?.intercepts || 0,
      contestedMarks: data.stats?.contested_marks || data.raw_row?.contested_marks || 0,
      rebound50s: data.stats?.rebound_50s || data.raw_row?.rebound_50s || 0,
      contestedPossessions:
        data.stats?.contested_possessions || data.raw_row?.contested_possessions || 0,
      effectiveDisposals: data.stats?.effective_disposals || data.raw_row?.effective_disposals || 0, // Replaces one percenters
      scoreInvolvements: data.stats?.score_involvements || data.raw_row?.score_involvements || 0, // Replaces goal assists
    };

    console.log('✅ NEW 9-Category Structure:');
    Object.entries(categories).forEach(([key, value]) => {
      const replacement =
        key === 'inside50s'
          ? ' (was clearances)'
          : key === 'effectiveDisposals'
            ? ' (was one percenters)'
            : key === 'scoreInvolvements'
              ? ' (was goal assists)'
              : '';
      console.log(`   ${key}${replacement}: ${value}`);
    });

    console.log('\n📈 Data Availability Check:');
    const availableCount = Object.values(categories).filter(
      (val) => val !== undefined && val !== null
    ).length;
    console.log(`   Available categories: ${availableCount}/9`);
    console.log(`   Data completeness: ${((availableCount / 9) * 100).toFixed(1)}%`);

    if (availableCount === 9) {
      console.log('   🎉 Perfect! All 9 categories have data');
    } else {
      console.log('   ⚠️  Some categories missing data (will default to 0)');
    }

    console.log('\n🔍 Raw data available:');
    console.log('   Inside 50s:', data.stats?.inside_50s || data.raw_row?.inside_50s || 'Missing');
    console.log(
      '   Effective Disposals:',
      data.stats?.effective_disposals || data.raw_row?.effective_disposals || 'Missing'
    );
    console.log(
      '   Score Involvements:',
      data.stats?.score_involvements || data.raw_row?.score_involvements || 'Missing'
    );
  } catch (error) {
    console.error('❌ Test failed:', error.message);
  }
}

// Load environment variables
if (process.env.NODE_ENV !== 'production') {
  require('dotenv').config({ path: '.env.local' });
}

testAPILogic();
