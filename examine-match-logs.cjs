// Test script to examine matchLogs structure for AFL stats
const admin = require('firebase-admin');
require('dotenv').config({ path: '.env.local' });

if (!admin.apps.length) {
  const serviceAccountJson = process.env.FIREBASE_SERVICE_ACCOUNT_JSON_BASE64 
    ? Buffer.from(process.env.FIREBASE_SERVICE_ACCOUNT_JSON_BASE64, 'base64').toString()
    : '{}';
  
  admin.initializeApp({
    credential: admin.credential.cert(JSON.parse(serviceAccountJson)),
    projectId: 'statly-4cbed'
  });
}

const db = admin.firestore();

async function examineMatchLogs() {
  try {
    console.log('Examining matchLogs structure for AFL stats...\n');
    
    const snapshot = await db.collection('players').limit(1).get();
    
    if (snapshot.empty) {
      console.log('No players found');
      return;
    }
    
    const doc = snapshot.docs[0];
    const data = doc.data();
    
    console.log(`Player: ${data.name}`);
    
    if (data.matchLogs && Array.isArray(data.matchLogs)) {
      console.log(`Found ${data.matchLogs.length} match logs\n`);
      
      // Examine the first match log
      const firstMatch = data.matchLogs[0];
      console.log('First match log structure:');
      console.log(JSON.stringify(firstMatch, null, 2));
      
      // Look for the stats you mentioned
      console.log('\n🎯 Looking for requested stats:');
      const requestedStats = [
        'goals', 'marks', 'tackles', 'effective_disposals', 'kicks', 
        'disposal_efficiency', 'clearances', 'turnovers', 'metres_gained'
      ];
      
      requestedStats.forEach(stat => {
        if (firstMatch.hasOwnProperty(stat)) {
          console.log(`✅ ${stat}: ${firstMatch[stat]}`);
        } else {
          console.log(`❌ ${stat}: NOT FOUND`);
        }
      });
      
      console.log('\n📊 All available stats in match log:');
      Object.keys(firstMatch).forEach(key => {
        console.log(`  ${key}: ${firstMatch[key]}`);
      });
      
    } else {
      console.log('No matchLogs found or not an array');
    }
    
  } catch (error) {
    console.error('Error:', error);
  }
}

examineMatchLogs();
