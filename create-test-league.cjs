#!/usr/bin/env node

/**
 * Test AFL Fantasy League Creator
 * Creates a 12-team AFL Fantasy league with bot teams for local development testing
 * 
 * Usage: node create-test-league.cjs
 */

const { initializeApp, getApps, cert } = require('firebase-admin/app');
const { getFirestore } = require('firebase-admin/firestore');
const fs = require('fs');
const path = require('path');

// AFL Teams for realistic team names
const AFL_TEAMS = [
  'Adelaide', 'Brisbane', 'Carlton', 'Collingwood', 'Essendon', 'Fremantle',
  'Geelong', 'Gold Coast', 'GWS', 'Hawthorn', 'Melbourne', 'North Melbourne',
  'Port Adelaide', 'Richmond', 'St Kilda', 'Sydney', 'West Coast', 'Western Bulldogs'
];

// Roster structure for AFL Fantasy
const ROSTER_STRUCTURE = [
  { position: 'DEF', count: 6, label: 'Defenders' },
  { position: 'MID', count: 8, label: 'Midfielders' },
  { position: 'RUC', count: 2, label: 'Rucks' },
  { position: 'FWD', count: 6, label: 'Forwards' },
  { position: 'BENCH', count: 4, label: 'Bench' },
  { position: 'EMG', count: 2, label: 'Emergencies' }
];

// Fantasy categories for AFL
const FANTASY_CATEGORIES = [
  'goals',
  'goal_assists', 
  'tackles',
  'clearances',
  'inside_50s',
  'rebound_50s',
  'hitouts',
  'intercepts',
  'marks'
];

// Initialize Firebase Admin
function initializeFirebase() {
  if (getApps().length === 0) {
    let serviceAccount;
    
    // Try to load service account from environment or file
    if (process.env.FIREBASE_SERVICE_ACCOUNT_JSON_BASE64) {
      const decodedJson = Buffer.from(
        process.env.FIREBASE_SERVICE_ACCOUNT_JSON_BASE64,
        'base64'
      ).toString('utf-8');
      serviceAccount = JSON.parse(decodedJson);
    } else {
      // Fallback to service account file
      const serviceAccountPath = path.join(__dirname, 'statly-4cbed-firebase-adminsdk-fbsvc-7df0e3dae3.json');
      if (fs.existsSync(serviceAccountPath)) {
        serviceAccount = require(serviceAccountPath);
      } else {
        throw new Error('No Firebase service account found');
      }
    }

    initializeApp({
      credential: cert(serviceAccount),
    });
  }

  return getFirestore();
}

// Generate unique league code
function generateLeagueCode() {
  const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789';
  let code = '';
  for (let i = 0; i < 8; i++) {
    code += chars.charAt(Math.floor(Math.random() * chars.length));
  }
  return code;
}

// Generate realistic team names
function generateBotTeamNames() {
  const prefixes = ['The', 'Super', 'Elite', 'Thunder', 'Lightning', 'Fire', 'Ice', 'Storm'];
  const suffixes = ['Warriors', 'Legends', 'Champions', 'Eagles', 'Tigers', 'Sharks', 'Dragons', 'Phoenix'];
  
  const botNames = [];
  const usedNames = new Set();
  
  for (let i = 1; i <= 11; i++) {
    let teamName;
    let attempts = 0;
    
    do {
      const prefix = prefixes[Math.floor(Math.random() * prefixes.length)];
      const suffix = suffixes[Math.floor(Math.random() * suffixes.length)];
      teamName = `${prefix} ${suffix}`;
      attempts++;
    } while (usedNames.has(teamName) && attempts < 20);
    
    if (usedNames.has(teamName)) {
      teamName = `CPU Team ${i}`;
    }
    
    usedNames.add(teamName);
    botNames.push(teamName);
  }
  
  return botNames;
}

// Create the test league
async function createTestLeague() {
  console.log('🏈 Creating 12-team AFL Fantasy test league...\n');

  const db = initializeFirebase();
  const now = new Date().toISOString();
  const leagueCode = generateLeagueCode();
  const botTeamNames = generateBotTeamNames();

  // 1. Create the league
  console.log('📝 Creating league...');
  const league = {
    name: 'Test AFL Fantasy League',
    code: leagueCode,
    type: 'private',
    ownerId: 'human-manager', // Placeholder for human manager
    maxTeams: 12,
    categories: FANTASY_CATEGORIES,
    tradeSettings: {
      tradeLimit: 8,
      tradeReview: 'none',
      tradeDeadline: '2025-09-15T23:59:59.000Z', // End of regular season
    },
    waiverWire: {
      waiverOrder: [], // Will be populated with team IDs
      waiverPeriodHours: 24,
      waiverResetPolicy: 'weekly',
    },
    createdAt: now,
    status: 'preseason',
    description: 'Test league for local development with bot teams and full feature testing',
    draftDate: '2025-08-20T19:00:00.000Z', // Mock draft date
    rosterSettings: {
      structure: ROSTER_STRUCTURE,
      totalSlots: ROSTER_STRUCTURE.reduce((sum, pos) => sum + pos.count, 0),
      startingLineup: ROSTER_STRUCTURE.filter(pos => !['BENCH', 'EMG'].includes(pos.position))
        .reduce((sum, pos) => sum + pos.count, 0)
    }
  };

  const leagueRef = await db.collection('leagues').add(league);
  const leagueId = leagueRef.id;
  
  console.log(`✅ League created with ID: ${leagueId}`);
  console.log(`🔑 League code: ${leagueCode}`);

  // 2. Create league members (11 bots + 1 human slot)
  console.log('\n👥 Creating league members...');
  const memberIds = [];
  
  // Create human manager slot (owner)
  const humanMember = {
    leagueId,
    userId: 'human-manager',
    role: 'owner',
    teamName: 'Your Team',
    joinedAt: now,
    isActive: true,
    isBot: false,
    draftPosition: 1,
    roster: createEmptyRoster(),
    stats: {
      wins: 0,
      losses: 0,
      draws: 0,
      pointsFor: 0,
      pointsAgainst: 0,
      rank: 1
    }
  };
  
  const humanMemberRef = await db.collection('league_members').add(humanMember);
  memberIds.push(humanMemberRef.id);
  console.log(`✅ Human manager slot created (Position 1): Your Team`);

  // Create 11 bot teams
  for (let i = 0; i < 11; i++) {
    const botMember = {
      leagueId,
      userId: `bot-${i + 1}`,
      role: 'manager',
      teamName: botTeamNames[i],
      joinedAt: now,
      isActive: true,
      isBot: true,
      botDifficulty: ['easy', 'medium', 'hard'][Math.floor(Math.random() * 3)],
      draftPosition: i + 2,
      roster: createEmptyRoster(),
      stats: {
        wins: 0,
        losses: 0,
        draws: 0,
        pointsFor: 0,
        pointsAgainst: 0,
        rank: i + 2
      }
    };

    const botMemberRef = await db.collection('league_members').add(botMember);
    memberIds.push(botMemberRef.id);
    console.log(`✅ Bot team ${i + 1} created (Position ${i + 2}): ${botTeamNames[i]}`);
  }

  // 3. Update league with waiver order
  const shuffledMemberIds = [...memberIds].sort(() => Math.random() - 0.5);
  await leagueRef.update({
    'waiverWire.waiverOrder': shuffledMemberIds
  });

  // 4. Create draft room
  console.log('\n🎯 Creating draft room...');
  const draftRoom = {
    leagueId,
    type: 'snake',
    order: memberIds, // Draft order (1-12)
    pickClockSeconds: 120,
    scheduledAt: new Date('2025-08-20T19:00:00.000Z'),
    started: false,
    currentPick: 1,
    currentRound: 1,
    totalRounds: Math.ceil(ROSTER_STRUCTURE.reduce((sum, pos) => sum + pos.count, 0)),
    picks: [],
    settings: {
      autoPickEnabled: true,
      allowTradingPicks: false,
      pauseOnDisconnect: true
    }
  };

  const draftRef = await db.collection('draftRooms').add(draftRoom);
  console.log(`✅ Draft room created with ID: ${draftRef.id}`);

  // 5. Create trade proposals (sample pending trades)
  console.log('\n💱 Creating sample trade proposals...');
  const sampleTrades = [
    {
      leagueId,
      fromTeamId: memberIds[1], // Bot team 1
      toTeamId: 'human-manager', // Human manager
      status: 'pending',
      createdAt: now,
      expiresAt: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString(), // 7 days
      offer: {
        fromTeam: {
          players: ['marcus_bontempelli', 'christian_petracca'],
          picks: []
        },
        toTeam: {
          players: ['sam_walsh', 'clayton_oliver'],
          picks: []
        }
      },
      message: 'Interested in a midfield swap? Let me know what you think!'
    },
    {
      leagueId,
      fromTeamId: memberIds[2], // Bot team 2
      toTeamId: 'human-manager',
      status: 'pending', 
      createdAt: now,
      expiresAt: new Date(Date.now() + 5 * 24 * 60 * 60 * 1000).toISOString(),
      offer: {
        fromTeam: {
          players: ['jeremy_cameron'],
          picks: []
        },
        toTeam: {
          players: ['charlie_curnow', 'tom_hawkins'],
          picks: []
        }
      },
      message: 'Quality forward for two good forwards?'
    }
  ];

  for (let i = 0; i < sampleTrades.length; i++) {
    const tradeRef = await db.collection('trades').add(sampleTrades[i]);
    console.log(`✅ Sample trade ${i + 1} created with ID: ${tradeRef.id}`);
  }

  // 6. Create waiver claims
  console.log('\n📋 Creating sample waiver claims...');
  const sampleWaivers = [
    {
      leagueId,
      teamId: memberIds[3], // Bot team 3
      playerId: 'touk_miller',
      type: 'pickup',
      priority: 1,
      status: 'pending',
      submittedAt: now,
      processesAt: new Date(Date.now() + 16 * 60 * 60 * 1000).toISOString(), // 16 hours
      dropPlayerId: 'jack_steele'
    },
    {
      leagueId,
      teamId: memberIds[4], // Bot team 4
      playerId: 'nick_daicos',
      type: 'pickup',
      priority: 2,
      status: 'pending',
      submittedAt: now,
      processesAt: new Date(Date.now() + 16 * 60 * 60 * 1000).toISOString(),
      dropPlayerId: 'jarryd_lyons'
    }
  ];

  for (let i = 0; i < sampleWaivers.length; i++) {
    const waiverRef = await db.collection('waivers').add(sampleWaivers[i]);
    console.log(`✅ Sample waiver claim ${i + 1} created with ID: ${waiverRef.id}`);
  }

  // 7. Generate league activity
  console.log('\n📊 Creating league activity feed...');
  const activities = [
    {
      leagueId,
      type: 'member_joined',
      timestamp: now,
      data: {
        teamName: 'Your Team',
        userId: 'human-manager'
      }
    },
    {
      leagueId,
      type: 'draft_scheduled',
      timestamp: now,
      data: {
        draftDate: '2025-08-20T19:00:00.000Z',
        draftType: 'snake'
      }
    },
    {
      leagueId,
      type: 'trade_proposed',
      timestamp: new Date(Date.now() - 2 * 60 * 60 * 1000).toISOString(),
      data: {
        fromTeam: botTeamNames[0],
        toTeam: 'Your Team',
        playersInvolved: ['Marcus Bontempelli', 'Sam Walsh']
      }
    }
  ];

  for (const activity of activities) {
    await db.collection('league_activities').add(activity);
  }
  
  console.log(`✅ ${activities.length} activity items created`);

  return {
    leagueId,
    leagueCode,
    league,
    memberIds,
    draftId: draftRef.id,
    summary: {
      totalTeams: 12,
      humanManager: 'Your Team (Position 1)',
      botTeams: botTeamNames.map((name, i) => `${name} (Position ${i + 2})`),
      features: [
        'Snake draft simulation',
        'Trade proposals',
        'Waiver claims',
        'Team roster management',
        'Activity feed',
        'League standings'
      ]
    }
  };
}

// Helper function to create empty roster structure
function createEmptyRoster() {
  const roster = {};
  
  ROSTER_STRUCTURE.forEach(({ position, count }) => {
    roster[position] = Array(count).fill(null).map((_, i) => ({
      slotId: `${position}_${i + 1}`,
      playerId: null,
      isLocked: false,
      isStarting: !['BENCH', 'EMG'].includes(position)
    }));
  });
  
  return roster;
}

// API endpoint documentation
function generateAPIGuide(leagueData) {
  return {
    endpoints: {
      // League Management
      getLeague: `GET /api/leagues/${leagueData.leagueId}`,
      updateLeague: `PUT /api/leagues/${leagueData.leagueId}`,
      getMembers: `GET /api/leagues/${leagueData.leagueId}/members`,
      joinLeague: `POST /api/leagues/join`,
      
      // Draft
      getDraft: `GET /api/leagues/${leagueData.leagueId}/draft`,
      makePick: `POST /api/drafts/${leagueData.draftId}/pick`,
      autoPick: `POST /api/drafts/${leagueData.draftId}/auto-pick`,
      getDraftQueue: `GET /api/drafts/${leagueData.draftId}/queue?memberId=human-manager`,
      addToQueue: `POST /api/drafts/${leagueData.draftId}/queue`,
      
      // Roster Management
      getRoster: `GET /api/leagues/${leagueData.leagueId}/roster`,
      updateRoster: `PUT /api/leagues/${leagueData.leagueId}/roster`,
      setLineup: `POST /api/leagues/${leagueData.leagueId}/lineup`,
      
      // Trades
      getTrades: `GET /api/leagues/${leagueData.leagueId}/trades`,
      proposeTrade: `POST /api/leagues/${leagueData.leagueId}/trades`,
      respondToTrade: `PUT /api/trades/{tradeId}`,
      
      // Waivers
      getWaivers: `GET /api/leagues/${leagueData.leagueId}/waivers`,
      submitWaiver: `POST /api/leagues/${leagueData.leagueId}/waivers`,
      cancelWaiver: `DELETE /api/waivers/{waiverId}`,
      
      // Free Agents
      getFreeAgents: `GET /api/leagues/${leagueData.leagueId}/free-agents`,
      pickupPlayer: `POST /api/leagues/${leagueData.leagueId}/pickup`,
      dropPlayer: `POST /api/leagues/${leagueData.leagueId}/drop`,
      
      // Standings & Stats
      getStandings: `GET /api/leagues/${leagueData.leagueId}/standings`,
      getMatchups: `GET /api/leagues/${leagueData.leagueId}/matchups`,
      getActivity: `GET /api/leagues/${leagueData.leagueId}/activity`
    },
    
    sampleAPIcalls: {
      joinAsHuman: {
        method: 'POST',
        url: '/api/leagues/join',
        body: {
          code: leagueData.leagueCode,
          teamName: 'My Fantasy Team',
          userId: 'your-user-id'
        }
      },
      
      makeDraftPick: {
        method: 'POST',
        url: `/api/drafts/${leagueData.draftId}/pick`,
        body: {
          playerId: 'marcus_bontempelli',
          memberId: 'human-manager'
        }
      },
      
      proposeTrade: {
        method: 'POST',
        url: `/api/leagues/${leagueData.leagueId}/trades`,
        body: {
          toTeamId: leagueData.memberIds[1],
          offer: {
            fromTeam: {
              players: ['player_id_1'],
              picks: []
            },
            toTeam: {
              players: ['player_id_2'],
              picks: []
            }
          },
          message: 'Interested in this trade?'
        }
      },
      
      submitWaiverClaim: {
        method: 'POST',
        url: `/api/leagues/${leagueData.leagueId}/waivers`,
        body: {
          playerId: 'available_player_id',
          type: 'pickup',
          dropPlayerId: 'current_player_id'
        }
      }
    }
  };
}

// Main execution
async function main() {
  try {
    const leagueData = await createTestLeague();
    const apiGuide = generateAPIGuide(leagueData);
    
    // Output results
    console.log('\n🎉 Test League Created Successfully!\n');
    console.log('📊 LEAGUE SUMMARY');
    console.log('================');
    console.log(`League ID: ${leagueData.leagueId}`);
    console.log(`League Code: ${leagueData.leagueCode}`);
    console.log(`Draft ID: ${leagueData.draftId}`);
    console.log(`Total Teams: ${leagueData.summary.totalTeams}`);
    console.log(`Human Manager: ${leagueData.summary.humanManager}`);
    console.log('');
    
    console.log('🤖 BOT TEAMS');
    console.log('============');
    leagueData.summary.botTeams.forEach(team => console.log(`• ${team}`));
    console.log('');
    
    console.log('⚡ ENABLED FEATURES');
    console.log('==================');
    leagueData.summary.features.forEach(feature => console.log(`• ${feature}`));
    console.log('');
    
    console.log('🔗 QUICK ACCESS');
    console.log('===============');
    console.log(`• League URL: http://localhost:3001/leagues/${leagueData.leagueId}`);
    console.log(`• Draft URL: http://localhost:3001/drafts/${leagueData.draftId}`);
    console.log(`• Join Code: ${leagueData.leagueCode}`);
    console.log('');
    
    console.log('📡 API ENDPOINTS');
    console.log('================');
    Object.entries(apiGuide.endpoints).slice(0, 8).forEach(([name, endpoint]) => {
      console.log(`• ${name}: ${endpoint}`);
    });
    console.log('• ... and more (see generated API guide)');
    console.log('');
    
    // Save detailed data to files
    const outputDir = path.join(__dirname, 'test-league-output');
    if (!fs.existsSync(outputDir)) {
      fs.mkdirSync(outputDir);
    }
    
    fs.writeFileSync(
      path.join(outputDir, 'league-data.json'), 
      JSON.stringify(leagueData, null, 2)
    );
    
    fs.writeFileSync(
      path.join(outputDir, 'api-guide.json'), 
      JSON.stringify(apiGuide, null, 2)
    );
    
    console.log('💾 SAVED FILES');
    console.log('==============');
    console.log(`• League data: ${outputDir}/league-data.json`);
    console.log(`• API guide: ${outputDir}/api-guide.json`);
    console.log('');
    
    console.log('🚀 NEXT STEPS');
    console.log('=============');
    console.log('1. Start your Next.js server: npm run dev');
    console.log('2. Navigate to: http://localhost:3001/leagues');
    console.log(`3. Use join code: ${leagueData.leagueCode}`);
    console.log('4. Test draft, trades, and roster management');
    console.log('5. Run API tests using the generated endpoints');
    console.log('');
    
    return leagueData;

  } catch (error) {
    console.error('❌ Error creating test league:', error);
    console.error(error.stack);
    process.exit(1);
  }
}

// Run if called directly
if (require.main === module) {
  main().then(() => {
    console.log('✅ Test league creation completed successfully!');
    process.exit(0);
  }).catch(error => {
    console.error('❌ Failed to create test league:', error);
    process.exit(1);
  });
}

module.exports = { createTestLeague, generateAPIGuide };
