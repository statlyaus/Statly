import { type NextRequest, NextResponse } from 'next/server';
import { initializeApp, getApps, cert } from 'firebase-admin/app';
import { getFirestore } from 'firebase-admin/firestore';

// Initialize Firebase Admin (server-side only)
if (!getApps().length) {
  try {
    let serviceAccount;
    
    // Try to get service account from different environment variables
    if (process.env.GOOGLE_SERVICE_ACCOUNT) {
      serviceAccount = JSON.parse(process.env.GOOGLE_SERVICE_ACCOUNT);
    } else if (process.env.FIREBASE_SERVICE_ACCOUNT_JSON_BASE64) {
      const decodedJson = Buffer.from(process.env.FIREBASE_SERVICE_ACCOUNT_JSON_BASE64, 'base64').toString('utf-8');
      serviceAccount = JSON.parse(decodedJson);
    } else {
      throw new Error('No Firebase service account found in environment variables');
    }
    
    initializeApp({
      credential: cert(serviceAccount),
    });
  } catch (error) {
    console.error('Failed to initialize Firebase Admin:', error);
  }
}

const testData = [
  {
    id: 'stats_001',
    player_id: 'player_001',
    player_name: 'Charlie Curnow',
    team: 'Carlton',
    position: 'FWD',
    fantasy_points: 98,
    goals: 3,
    disposals: 18,
    marks: 8,
    tackles: 4,
    season: 2025,
    round_number: 1,
    created_at: new Date().toISOString()
  },
  {
    id: 'stats_002',
    player_id: 'player_002',
    player_name: 'Patrick Cripps',
    team: 'Carlton',
    position: 'MID',
    fantasy_points: 124,
    goals: 1,
    disposals: 32,
    marks: 6,
    tackles: 8,
    season: 2025,
    round_number: 1,
    created_at: new Date().toISOString()
  },
  {
    id: 'stats_003',
    player_id: 'player_003',
    player_name: 'Dustin Martin',
    team: 'Richmond',
    position: 'MID',
    fantasy_points: 108,
    goals: 2,
    disposals: 25,
    marks: 5,
    tackles: 6,
    season: 2025,
    round_number: 1,
    created_at: new Date().toISOString()
  }
];

export async function POST(_request: NextRequest) {
  try {
    const db = getFirestore();
    
    console.log('Adding test data to Firebase...');
    
    // Add each player stat
    for (const stat of testData) {
      await db.collection('player_match_stats').doc(stat.id).set(stat);
      console.log(`Added: ${stat.player_name} - ${stat.fantasy_points} points`);
    }
    
    return NextResponse.json({
      success: true,
      message: 'Test data added successfully',
      count: testData.length,
      data: testData
    });

  } catch (error) {
    console.error('Failed to add test data:', error);
    return NextResponse.json(
      { 
        success: false, 
        error: 'Failed to add test data', 
        details: error instanceof Error ? error.message : 'Unknown error' 
      },
      { status: 500 }
    );
  }
}

export async function GET() {
  return NextResponse.json({
    message: 'Use POST to add test data to Firebase',
    data: testData
  });
}
