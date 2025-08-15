const admin = require('firebase-admin');

const base64Json = process.env.FIREBASE_SERVICE_ACCOUNT_JSON_BASE64;
const json = Buffer.from(base64Json, 'base64').toString('utf8');
const serviceAccount = JSON.parse(json);

if (!admin.apps.length) {
  admin.initializeApp({
    credential: admin.credential.cert(serviceAccount),
  });
}

const db = admin.firestore();

async function examineDetailedStats() {
  try {
    console.log('🔍 Examining detailed player_match_stats structure...');
    const snapshot = await db.collection('player_match_stats').limit(1).get();
    
    if (snapshot.size > 0) {
      const doc = snapshot.docs[0];
      const data = doc.data();
      
      console.log('\n📊 Complete document structure:');
      console.log('Document ID:', doc.id);
      console.log('\n📋 Top-level fields:');
      Object.keys(data).forEach(key => {
        console.log(`  ${key}: ${typeof data[key]}`);
      });
      
      console.log('\n🏈 Stats object structure:');
      if (data.stats) {
        Object.keys(data.stats).forEach(key => {
          console.log(`  stats.${key}: ${data.stats[key]} (${typeof data.stats[key]})`);
        });
      }
      
      console.log('\n📝 Raw row structure:');
      if (data.raw_row) {
        Object.keys(data.raw_row).forEach(key => {
          console.log(`  raw_row.${key}: ${data.raw_row[key]} (${typeof data.raw_row[key]})`);
        });
      }
      
      console.log('\n🎯 Your 9 Categories Availability Check:');
      const nineCategories = {
        'goals': data.stats?.goals || data.raw_row?.goals,
        'tackles': data.stats?.tackles || data.raw_row?.tackles,
        'clearances': data.stats?.clearances || data.raw_row?.clearances,
        'intercepts': data.stats?.intercepts || data.raw_row?.intercepts,
        'contestedMarks': data.stats?.contested_marks || data.raw_row?.contested_marks,
        'rebound50s': data.stats?.rebound_50s || data.raw_row?.rebound_50s,
        'contestedPossessions': data.stats?.contested_possessions || data.raw_row?.contested_possessions,
        'onePercenters': data.stats?.one_percenters || data.raw_row?.one_percenters,
        'goalAssists': data.stats?.goal_assists || data.raw_row?.goal_assists
      };
      
      Object.entries(nineCategories).forEach(([key, value]) => {
        const status = value !== undefined && value !== null ? '✅' : '❌';
        console.log(`  ${status} ${key}: ${value}`);
      });
      
      console.log('\n📈 Sample player stats summary:');
      console.log(`Player: ${data.player_name} (${data.team})`);
      console.log(`Match: vs ${data.opposition} - Round ${data.round}, ${data.season}`);
      console.log(`Disposals: ${data.stats?.disposals || 'N/A'}`);
      console.log(`Goals: ${data.stats?.goals || 'N/A'}`);
      console.log(`Tackles: ${data.stats?.tackles || 'N/A'}`);
      
    } else {
      console.log('❌ No documents found in player_match_stats collection');
    }
  } catch (error) {
    console.error('Error:', error.message);
  }
}

examineDetailedStats();
