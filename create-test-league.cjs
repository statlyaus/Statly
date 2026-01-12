#!/usr/bin/env node

const { admin } = require('./scripts/firebaseAdmin.cjs');

const db = admin.firestore();
const auth = admin.auth();

// Generate unique league code
function generateLeagueCode() {
  const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789';
  let code = '';
  for (let i = 0; i < 6; i++) {
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
      // Must match CategoryEnum in src/app/leagues/[id]/page.tsx
      categories: [
        'goals',
        'kicks',
        'handballs',
        'marks',
        'tackles',
        'hitouts',
        'inside50s',
        'rebound50s',
        'contestedPossessions',
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
      .collection('leagues')
      .doc(leagueRef.id)
      .collection('members')
      .doc(ownerMember.userId)
      .set(ownerMember, { merge: true });
    console.log('✅ Owner added to league');

    // Add 10 bot teams (leave 1 open slot)
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

    for (let i = 0; i < 10; i++) {
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
        .collection('leagues')
        .doc(leagueRef.id)
        .collection('members')
        .doc(botMember.userId)
        .set(botMember, { merge: true });
      console.log(`🤖 Added bot team: ${botTeams[i]}`);
    }

    console.log('\n🎉 Test league setup complete!');
    console.log(`📋 League Name: ${league.name}`);
    console.log(`🔑 League Code: ${code}`);
    console.log(`👥 Total Teams: 11 (1 owner + 10 bots)`);
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
