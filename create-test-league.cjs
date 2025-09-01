#!/usr/bin/env node

const { initializeApp, cert } = require('firebase-admin/app');
const { getFirestore } = require('firebase-admin/firestore');

// Initialize Firebase Admin
const serviceAccount = require('./statly-4cbed-firebase-adminsdk-fbsvc-7df0e3dae3.json');
initializeApp({
  credential: cert(serviceAccount),
});

const db = getFirestore();

// Generate unique league code
function generateLeagueCode() {
  const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789';
  let code = '';
  for (let i = 0; i < 8; i++) {
    code += chars.charAt(Math.floor(Math.random() * chars.length));
  }
  return code;
}

async function createTestLeague() {
  try {
    console.log('🎯 Creating test league with bots...');

    // Generate unique league code
    let code;
    let attempts = 0;
    do {
      code = generateLeagueCode();
      const existingLeague = await db
        .collection('leagues')
        .where('code', '==', code)
        .limit(1)
        .get();
      attempts++;
      if (existingLeague.empty) break;
    } while (attempts < 10);

    // Create league object
    const now = new Date().toISOString();
    const league = {
      name: 'AFL Champions League 2025',
      code,
      type: 'public',
      ownerId: '2qlfdHSCFTPlxoKFSUfNLSlCDRe2',
      maxTeams: 12,
      categories: [
        'disposals',
        'goals',
        'marks',
        'tackles',
        'inside_50s',
        'contested_possessions',
        'effective_disposals',
        'hitouts',
        'rebound_50s',
      ],
      tradeSettings: {
        tradeLimit: 10,
        tradeReview: 'none',
      },
      waiverWire: {
        waiverOrder: [],
        waiverPeriodHours: 24,
        waiverResetPolicy: 'weekly',
      },
      createdAt: now,
      status: 'preseason',
      description: 'Test league with bot teams for development',
    };

    // Save league
    const leagueRef = await db.collection('leagues').add(league);
    console.log(`✅ League created with ID: ${leagueRef.id}`);
    console.log(`🔑 League code: ${code}`);

    // Add owner as first member
    const ownerMember = {
      leagueId: leagueRef.id,
      userId: '2qlfdHSCFTPlxoKFSUfNLSlCDRe2',
      role: 'owner',
      teamName: 'AFL Champions Owner',
      joinedAt: now,
      isActive: true,
    };

    await db
      .collection('leagueMembers')
      .doc(`${leagueRef.id}_${ownerMember.userId}`)
      .set(ownerMember, { merge: true });
    console.log('✅ Owner added to league');

    // Add 11 bot teams
    const botTeams = [
      'Richmond Tigers Bot',
      'Collingwood Magpies Bot',
      'Geelong Cats Bot',
      'West Coast Eagles Bot',
      'Melbourne Demons Bot',
      'Sydney Swans Bot',
      'Port Adelaide Power Bot',
      'Brisbane Lions Bot',
      'Adelaide Crows Bot',
      'Carlton Blues Bot',
      'St Kilda Saints Bot',
    ];

    for (let i = 0; i < 11; i++) {
      const botMember = {
        leagueId: leagueRef.id,
        userId: `bot_${i + 1}`,
        role: 'member',
        teamName: botTeams[i],
        joinedAt: new Date(Date.now() + i * 1000).toISOString(), // Stagger join times
        isActive: true,
        isBot: true,
      };

      await db
        .collection('leagueMembers')
        .doc(`${leagueRef.id}_${botMember.userId}`)
        .set(botMember, { merge: true });
      console.log(`🤖 Added bot team: ${botTeams[i]}`);
    }

    console.log('\n🎉 Test league setup complete!');
    console.log(`📋 League Name: ${league.name}`);
    console.log(`🔑 League Code: ${code}`);
    console.log(`👥 Total Teams: 12 (1 owner + 11 bots)`);
    console.log(`\n🚀 You can now join this league using code: ${code}`);
    console.log('   1. Go to http://localhost:3000/leagues/join');
    console.log(`   2. Enter code: ${code}`);
    console.log('   3. Enter your team name: "Robbo Rockers"');
    console.log('   4. Submit to test the join functionality!');
  } catch (error) {
    console.error('❌ Error creating test league:', error);
  }
}

createTestLeague();
