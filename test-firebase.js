// Quick test to check Firebase connection and data
import admin from 'firebase-admin';
import { config } from 'dotenv';

// Load environment variables
config({ path: '.env.local' });

// Load service account from environment
if (!admin.apps.length) {
  const jsonBase64 = process.env.FIREBASE_SERVICE_ACCOUNT_JSON_BASE64;
  if (!jsonBase64) {
    console.error('FIREBASE_SERVICE_ACCOUNT_JSON_BASE64 not found');
    process.exit(1);
  }
  
  const json = Buffer.from(jsonBase64, 'base64').toString('utf-8');
  const sa = JSON.parse(json);

  admin.initializeApp({
    credential: admin.credential.cert({
      projectId: sa.project_id,
      clientEmail: sa.client_email,
      privateKey: sa.private_key,
    }),
    projectId: sa.project_id,
  });
}

async function testFirebase() {
  try {
    const db = admin.firestore();
    
    console.log('Testing Firebase connection...');
    
    // Test connection by getting the first few players
    const playersRef = db.collection('players');
    const snapshot = await playersRef.limit(3).get();
    
    console.log(`Found ${snapshot.size} players in the collection`);
    
    if (snapshot.size > 0) {
      snapshot.forEach((doc) => {
        console.log(`Player ID: ${doc.id}`);
        const data = doc.data();
        console.log(`  Name: ${data.name || 'Unknown'}`);
        console.log(`  Team: ${data.team || 'Unknown'}`);
        console.log(`  Position: ${data.position || 'Unknown'}`);
        console.log(`  Games: ${data.games || 'Unknown'}`);
        console.log('  ---');
      });
    } else {
      console.log('No players found in the collection');
      
      // Check if collection exists
      const collections = await db.listCollections();
      console.log('Available collections:', collections.map(c => c.id));
    }
    
  } catch (error) {
    console.error('Firebase test failed:', error.message);
    if (error.code) {
      console.error('Error code:', error.code);
    }
  } finally {
    process.exit(0);
  }
}

testFirebase();
