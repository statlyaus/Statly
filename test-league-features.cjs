#!/usr/bin/env node

/**
 * AFL Fantasy League Bot Simulator & API Tester
 * Tests league functionality by simulating bot behavior
 *
 * Usage: node test-league-features.cjs [leagueId]
 */

const fetch = require('node-fetch');
const fs = require('fs');
const path = require('path');

const API_BASE = 'http://localhost:3001/api';

// Sample AFL players for testing (realistic names)
const SAMPLE_PLAYERS = [
  // Midfielders
  {
    id: 'marcus_bontempelli',
    name: 'Marcus Bontempelli',
    position: 'MID',
    team: 'Western Bulldogs',
  },
  { id: 'christian_petracca', name: 'Christian Petracca', position: 'MID', team: 'Melbourne' },
  { id: 'sam_walsh', name: 'Sam Walsh', position: 'MID', team: 'Carlton' },
  { id: 'clayton_oliver', name: 'Clayton Oliver', position: 'MID', team: 'Melbourne' },
  { id: 'lachie_neale', name: 'Lachie Neale', position: 'MID', team: 'Brisbane' },
  { id: 'touk_miller', name: 'Touk Miller', position: 'MID', team: 'Gold Coast' },
  { id: 'nick_daicos', name: 'Nick Daicos', position: 'MID', team: 'Collingwood' },
  { id: 'andrew_brayshaw', name: 'Andrew Brayshaw', position: 'MID', team: 'Fremantle' },

  // Forwards
  { id: 'jeremy_cameron', name: 'Jeremy Cameron', position: 'FWD', team: 'Geelong' },
  { id: 'charlie_curnow', name: 'Charlie Curnow', position: 'FWD', team: 'Carlton' },
  { id: 'tom_hawkins', name: 'Tom Hawkins', position: 'FWD', team: 'Geelong' },
  { id: 'lance_franklin', name: 'Lance Franklin', position: 'FWD', team: 'Sydney' },
  { id: 'taylor_walker', name: 'Taylor Walker', position: 'FWD', team: 'Adelaide' },
  { id: 'tom_lynch', name: 'Tom Lynch', position: 'FWD', team: 'Richmond' },

  // Defenders
  { id: 'jordan_dawson', name: 'Jordan Dawson', position: 'DEF', team: 'Adelaide' },
  { id: 'jack_crisp', name: 'Jack Crisp', position: 'DEF', team: 'Collingwood' },
  { id: 'jake_lloyd', name: 'Jake Lloyd', position: 'DEF', team: 'Sydney' },
  { id: 'daniel_rich', name: 'Daniel Rich', position: 'DEF', team: 'Brisbane' },
  { id: 'shannon_hurn', name: 'Shannon Hurn', position: 'DEF', team: 'West Coast' },
  { id: 'rory_laird', name: 'Rory Laird', position: 'DEF', team: 'Adelaide' },

  // Rucks
  { id: 'max_gawn', name: 'Max Gawn', position: 'RUC', team: 'Melbourne' },
  { id: 'brodie_grundy', name: 'Brodie Grundy', position: 'RUC', team: 'Collingwood' },
  { id: 'todd_goldstein', name: 'Todd Goldstein', position: 'RUC', team: 'North Melbourne' },
  { id: 'sean_darcy', name: 'Sean Darcy', position: 'RUC', team: 'Fremantle' },
];

class LeagueAPITester {
  constructor(leagueId, apiBase = API_BASE) {
    this.leagueId = leagueId;
    this.apiBase = apiBase;
    this.humanManagerId = process.env.USER_ID || 'human-manager';
  }

  // Helper method for API calls
  async apiCall(endpoint, method = 'GET', body = null, headers = {}) {
    const url = `${this.apiBase}${endpoint}`;
    const options = {
      method,
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer dev:${this.humanManagerId}`,
        ...headers,
      },
    };

    if (body) {
      options.body = JSON.stringify(body);
    }

    try {
      const response = await fetch(url, options);
      const data = await response.json();

      if (!response.ok) {
        throw new Error(
          `API call failed: ${response.status} - ${data.error || data.message || 'Unknown error'}`
        );
      }

      return data;
    } catch (error) {
      console.error(`❌ API call failed for ${method} ${url}:`, error.message);
      throw error;
    }
  }

  // Test league access
  async testLeagueAccess() {
    console.log('🔍 Testing league access...');

    try {
      const league = await this.apiCall(`/leagues/${this.leagueId}`);
      console.log(`✅ League found: ${league.data?.name || 'Unknown'}`);
      return league.data;
    } catch (error) {
      console.log('❌ League access failed:', error.message);
      return null;
    }
  }

  // Test getting league members
  async testGetMembers() {
    console.log('👥 Testing member retrieval...');

    try {
      const members = await this.apiCall(`/leagues/${this.leagueId}/members`);
      console.log(`✅ Found ${members.data?.length || 0} members`);

      if (members.data) {
        members.data.forEach((member, i) => {
          const indicator = member.isBot ? '🤖' : '👤';
          console.log(`   ${indicator} ${member.teamName} (Position ${i + 1})`);
        });
      }

      return members.data;
    } catch (error) {
      console.log('❌ Member retrieval failed:', error.message);
      return [];
    }
  }

  // Test draft room functionality
  async testDraftRoom() {
    console.log('🎯 Testing draft room...');

    try {
      // Try to get or create draft
      const draft = await this.apiCall(`/leagues/${this.leagueId}/draft`);

      if (draft.data?.hasDraft) {
        console.log(`✅ Draft room exists: ${draft.data.draftId}`);
        return draft.data.draftId;
      } else {
        console.log('⚠️ No draft room found, attempting to create...');

        // Create draft room
        const createDraft = await this.apiCall(`/leagues/${this.leagueId}/draft`, 'POST', {
          draftType: 'snake',
          timePerPick: 120,
          scheduledTime: new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString(), // 24 hours from now
        });

        console.log('✅ Draft room created successfully');
        return createDraft.data?.draftId;
      }
    } catch (error) {
      console.log('❌ Draft room test failed:', error.message);
      return null;
    }
  }

  // Simulate draft picks
  async simulateDraftPicks(draftId, numPicks = 5) {
    if (!draftId) {
      console.log('⚠️ Skipping draft simulation - no draft ID');
      return;
    }

    console.log(`🎲 Simulating ${numPicks} draft picks...`);

    try {
      // Get draft state
      const draftState = await this.apiCall(`/drafts/${draftId}`);
      console.log(`📊 Draft status: ${draftState.data?.status || 'unknown'}`);

      // Simulate auto-picks for bots
      for (let i = 0; i < numPicks; i++) {
        console.log(`   Pick ${i + 1}: Simulating auto-pick...`);

        try {
          await this.apiCall(`/drafts/${draftId}/auto-pick`, 'POST');
          console.log(`   ✅ Auto-pick ${i + 1} completed`);

          // Wait briefly between picks
          await new Promise((resolve) => setTimeout(resolve, 500));
        } catch (error) {
          console.log(`   ❌ Auto-pick ${i + 1} failed:`, error.message);
          break;
        }
      }

      console.log('✅ Draft simulation completed');
    } catch (error) {
      console.log('❌ Draft simulation failed:', error.message);
    }
  }

  // Test trade proposals
  async testTradeProposals() {
    console.log('💱 Testing trade proposals...');

    try {
      // Get existing trades
      const trades = await this.apiCall(`/leagues/${this.leagueId}/trades`);
      console.log(`📋 Found ${trades.data?.length || 0} existing trades`);

      // Simulate creating a trade proposal
      const sampleTrade = {
        toTeamId: 'bot-1', // Trade with first bot
        offer: {
          fromTeam: {
            players: [SAMPLE_PLAYERS[0].id], // Marcus Bontempelli
            picks: [],
          },
          toTeam: {
            players: [SAMPLE_PLAYERS[1].id], // Christian Petracca
            picks: [],
          },
        },
        message: 'Test trade - midfield swap!',
      };

      try {
        const newTrade = await this.apiCall(
          `/leagues/${this.leagueId}/trades`,
          'POST',
          sampleTrade
        );
        console.log('✅ Trade proposal created successfully');

        // Simulate responding to a trade (if any exist)
        if (trades.data && trades.data.length > 0) {
          const tradeId = trades.data[0].id;

          try {
            await this.apiCall(`/trades/${tradeId}`, 'PUT', {
              action: 'accept',
              message: 'Looks good to me!',
            });
            console.log('✅ Trade response sent');
          } catch (error) {
            console.log('⚠️ Trade response failed:', error.message);
          }
        }

        return newTrade.data;
      } catch (error) {
        console.log('⚠️ Trade creation failed:', error.message);
      }
    } catch (error) {
      console.log('❌ Trade test failed:', error.message);
    }
  }

  // Test waiver claims
  async testWaiverClaims() {
    console.log('📋 Testing waiver claims...');

    try {
      // Get current waivers
      const waivers = await this.apiCall(`/leagues/${this.leagueId}/waivers`);
      console.log(`📊 Found ${waivers.data?.length || 0} pending waivers`);

      // Submit a new waiver claim
      const sampleWaiver = {
        playerId: SAMPLE_PLAYERS[5].id, // Touk Miller
        type: 'pickup',
        dropPlayerId: SAMPLE_PLAYERS[6].id, // Nick Daicos
      };

      try {
        const newWaiver = await this.apiCall(
          `/leagues/${this.leagueId}/waivers`,
          'POST',
          sampleWaiver
        );
        console.log('✅ Waiver claim submitted successfully');
        return newWaiver.data;
      } catch (error) {
        console.log('⚠️ Waiver submission failed:', error.message);
      }
    } catch (error) {
      console.log('❌ Waiver test failed:', error.message);
    }
  }

  // Test roster management
  async testRosterManagement() {
    console.log('👔 Testing roster management...');

    try {
      // Get current roster
      const roster = await this.apiCall(`/leagues/${this.leagueId}/roster`);
      console.log('📋 Current roster retrieved');

      // Test lineup setting
      const sampleLineup = {
        DEF: [
          SAMPLE_PLAYERS[14].id,
          SAMPLE_PLAYERS[15].id,
          SAMPLE_PLAYERS[16].id,
          SAMPLE_PLAYERS[17].id,
          SAMPLE_PLAYERS[18].id,
          SAMPLE_PLAYERS[19].id,
        ],
        MID: [
          SAMPLE_PLAYERS[0].id,
          SAMPLE_PLAYERS[1].id,
          SAMPLE_PLAYERS[2].id,
          SAMPLE_PLAYERS[3].id,
          SAMPLE_PLAYERS[4].id,
          SAMPLE_PLAYERS[5].id,
          SAMPLE_PLAYERS[6].id,
          SAMPLE_PLAYERS[7].id,
        ],
        RUC: [SAMPLE_PLAYERS[20].id, SAMPLE_PLAYERS[21].id],
        FWD: [
          SAMPLE_PLAYERS[8].id,
          SAMPLE_PLAYERS[9].id,
          SAMPLE_PLAYERS[10].id,
          SAMPLE_PLAYERS[11].id,
          SAMPLE_PLAYERS[12].id,
          SAMPLE_PLAYERS[13].id,
        ],
        captain: SAMPLE_PLAYERS[0].id,
        viceCaptain: SAMPLE_PLAYERS[1].id,
      };

      try {
        await this.apiCall(`/leagues/${this.leagueId}/lineup`, 'POST', sampleLineup);
        console.log('✅ Lineup set successfully');
      } catch (error) {
        console.log('⚠️ Lineup setting failed:', error.message);
      }

      return roster.data;
    } catch (error) {
      console.log('❌ Roster management test failed:', error.message);
    }
  }

  // Test free agent pickup/drop
  async testFreeAgentActions() {
    console.log('🆓 Testing free agent actions...');

    try {
      // Get free agents
      const freeAgents = await this.apiCall(`/leagues/${this.leagueId}/free-agents`);
      console.log(`📊 Found ${freeAgents.data?.length || 0} free agents`);

      // Test pickup
      if (freeAgents.data && freeAgents.data.length > 0) {
        const playerToPickup = freeAgents.data[0];

        try {
          await this.apiCall(`/leagues/${this.leagueId}/pickup`, 'POST', {
            playerId: playerToPickup.id,
            dropPlayerId: SAMPLE_PLAYERS[0].id, // Drop someone to make room
          });
          console.log(`✅ Picked up ${playerToPickup.name || 'player'}`);
        } catch (error) {
          console.log('⚠️ Pickup failed:', error.message);
        }
      }
    } catch (error) {
      console.log('❌ Free agent test failed:', error.message);
    }
  }

  // Test standings and stats
  async testStandingsAndStats() {
    console.log('📊 Testing standings and stats...');

    try {
      // Get standings
      const standings = await this.apiCall(`/leagues/${this.leagueId}/standings`);
      console.log('📈 League standings retrieved');

      if (standings.data) {
        standings.data.forEach((team, i) => {
          console.log(`   ${i + 1}. ${team.teamName} (${team.wins}-${team.losses}-${team.draws})`);
        });
      }

      // Get matchups
      try {
        const matchups = await this.apiCall(`/leagues/${this.leagueId}/matchups`);
        console.log(`📅 Found ${matchups.data?.length || 0} matchups`);
      } catch (error) {
        console.log('⚠️ Matchups retrieval failed:', error.message);
      }

      // Get activity feed
      try {
        const activity = await this.apiCall(`/leagues/${this.leagueId}/activity`);
        console.log(`📋 Found ${activity.data?.length || 0} activity items`);
      } catch (error) {
        console.log('⚠️ Activity feed retrieval failed:', error.message);
      }

      return standings.data;
    } catch (error) {
      console.log('❌ Standings test failed:', error.message);
    }
  }

  // Run all tests
  async runAllTests() {
    console.log('🚀 Starting comprehensive league testing...\n');

    const results = {
      league: null,
      members: null,
      draftId: null,
      trades: null,
      waivers: null,
      roster: null,
      standings: null,
      summary: {
        testsRun: 0,
        testsPassed: 0,
        testsFailed: 0,
      },
    };

    const tests = [
      { name: 'League Access', func: () => this.testLeagueAccess(), key: 'league' },
      { name: 'Members', func: () => this.testGetMembers(), key: 'members' },
      { name: 'Draft Room', func: () => this.testDraftRoom(), key: 'draftId' },
      { name: 'Trade Proposals', func: () => this.testTradeProposals(), key: 'trades' },
      { name: 'Waiver Claims', func: () => this.testWaiverClaims(), key: 'waivers' },
      { name: 'Roster Management', func: () => this.testRosterManagement(), key: 'roster' },
      { name: 'Free Agents', func: () => this.testFreeAgentActions(), key: null },
      { name: 'Standings & Stats', func: () => this.testStandingsAndStats(), key: 'standings' },
    ];

    for (const test of tests) {
      console.log(`\n${'='.repeat(50)}`);
      console.log(`🧪 TEST: ${test.name}`);
      console.log('='.repeat(50));

      results.summary.testsRun++;

      try {
        const result = await test.func();

        if (test.key) {
          results[test.key] = result;
        }

        if (result !== null && result !== undefined) {
          results.summary.testsPassed++;
          console.log(`✅ ${test.name} test PASSED`);
        } else {
          results.summary.testsFailed++;
          console.log(`⚠️ ${test.name} test completed with warnings`);
        }
      } catch (error) {
        results.summary.testsFailed++;
        console.log(`❌ ${test.name} test FAILED:`, error.message);
      }

      // Brief pause between tests
      await new Promise((resolve) => setTimeout(resolve, 1000));
    }

    // Run draft simulation if we have a draft ID
    if (results.draftId) {
      console.log(`\n${'='.repeat(50)}`);
      console.log('🎯 BONUS TEST: Draft Simulation');
      console.log('='.repeat(50));

      try {
        await this.simulateDraftPicks(results.draftId, 3);
        console.log('✅ Draft simulation PASSED');
      } catch (error) {
        console.log('❌ Draft simulation FAILED:', error.message);
      }
    }

    return results;
  }
}

// Main function
async function main() {
  const args = process.argv.slice(2);
  let leagueId = args[0];

  // Try to load league ID from saved data if not provided
  if (!leagueId) {
    const dataPath = path.join(__dirname, 'test-league-output', 'league-data.json');

    if (fs.existsSync(dataPath)) {
      try {
        const savedData = JSON.parse(fs.readFileSync(dataPath, 'utf8'));
        leagueId = savedData.leagueId;
        console.log(`📂 Using league ID from saved data: ${leagueId}`);
      } catch (error) {
        console.error('❌ Could not read saved league data');
      }
    }
  }

  if (!leagueId) {
    console.error('❌ No league ID provided. Usage: node test-league-features.cjs [leagueId]');
    console.error('   Or run create-test-league.cjs first to create a test league');
    process.exit(1);
  }

  console.log('🏈 AFL Fantasy League API Tester');
  console.log('================================');
  console.log(`League ID: ${leagueId}`);
  console.log(`API Base: ${API_BASE}\n`);

  // Create tester instance
  const tester = new LeagueAPITester(leagueId);

  try {
    // Run comprehensive tests
    const results = await tester.runAllTests();

    // Generate summary report
    console.log('\n🎉 TESTING COMPLETED!');
    console.log('====================');
    console.log(`Tests Run: ${results.summary.testsRun}`);
    console.log(`Passed: ${results.summary.testsPassed}`);
    console.log(`Failed: ${results.summary.testsFailed}`);
    console.log(
      `Success Rate: ${Math.round((results.summary.testsPassed / results.summary.testsRun) * 100)}%`
    );

    // Save test results
    const outputDir = path.join(__dirname, 'test-league-output');
    if (!fs.existsSync(outputDir)) {
      fs.mkdirSync(outputDir);
    }

    fs.writeFileSync(path.join(outputDir, 'test-results.json'), JSON.stringify(results, null, 2));

    console.log(`\n💾 Test results saved to: ${outputDir}/test-results.json`);

    // Instructions for manual testing
    console.log('\n🎮 MANUAL TESTING INSTRUCTIONS');
    console.log('==============================');
    console.log('1. Visit: http://localhost:3001/leagues');
    console.log(`2. Join with code: ${results.league?.code || 'See league data'}`);
    console.log('3. Navigate to league overview');
    console.log('4. Test draft room functionality');
    console.log('5. Review and respond to trade proposals');
    console.log('6. Submit waiver claims');
    console.log('7. Set your lineup and manage roster');
    console.log('8. Check standings and activity feed');
  } catch (error) {
    console.error('\n❌ Testing failed:', error);
    process.exit(1);
  }
}

// Export for use as module
module.exports = { LeagueAPITester };

// Run if called directly
if (require.main === module) {
  main();
}
