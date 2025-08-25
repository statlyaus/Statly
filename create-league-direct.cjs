// Create league directly using Node.js
// Enhanced version with configuration support and duplicate checking
const fetch = globalThis.fetch || require('node-fetch');

// Configuration
const CONFIG = {
  serverUrl: process.env.SERVER_URL || 'http://localhost:3000',
  userId: process.env.USER_ID || '2qlfdHSCFTPlxoKFSUfNLSlCDRe2',
  defaultLeague: {
    name: "AFL Champions League 2025",
    type: "public",
    maxTeams: 12,
    description: "Premier AFL Fantasy league with comprehensive scoring across 9 categories. Snake draft system with active trading and waiver wire management.",
    categories: ["goals", "kicks", "handballs", "marks", "tackles", "hitouts", "clearances", "inside50s", "contestedPossessions"],
    tradeSettings: {
      tradeLimit: 15,
      tradeReview: "none"
    },
    waiverWire: {
      waiverPeriodHours: 24,
      waiverResetPolicy: "weekly"
    }
  }
};

async function checkExistingLeague(name) {
  try {
    const response = await fetch(`${CONFIG.serverUrl}/api/leagues`, {
      headers: {
        'Authorization': `Bearer dev:${CONFIG.userId}`
      }
    });
    
    if (response.ok) {
      const leagues = await response.json();
      return leagues.data?.find(league => league.name === name) || null;
    }
  } catch (error) {
    console.log('⚠️ Could not check for existing leagues, proceeding with creation...');
  }
  return null;
}

async function createLeague(customConfig = {}) {
  const leagueData = { ...CONFIG.defaultLeague, ...customConfig };

  try {
    console.log(`🎯 Creating league: ${leagueData.name}...`);
    
    // Check for existing league
    const existingLeague = await checkExistingLeague(leagueData.name);
    if (existingLeague) {
      console.log(`⚠️ League "${leagueData.name}" already exists!`);
      console.log(`📋 Existing League Details:`);
      console.log(`  - Code: ${existingLeague.code}`);
      console.log(`  - ID: ${existingLeague.id}`);
      console.log(`  - Status: ${existingLeague.status}`);
      console.log('\n🔗 You can access this existing league in the app!');
      return existingLeague;
    }
    
    const response = await fetch(`${CONFIG.serverUrl}/api/leagues`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer dev:${CONFIG.userId}`
      },
      body: JSON.stringify(leagueData)
    });

    const result = await response.json();
    
    if (response.ok) {
      console.log('✅ League created successfully!');
      console.log('📋 League Details:');
      console.log(`  - Name: ${result.data.name}`);
      console.log(`  - Code: ${result.data.code}`);
      console.log(`  - ID: ${result.data.id}`);
      console.log(`  - Max Teams: ${result.data.maxTeams}`);
      console.log(`  - Categories: ${result.data.categories?.join(', ') || 'N/A'}`);
      console.log(`  - Description: ${result.data.description}`);
      console.log(`  - Status: ${result.data.status}`);
      console.log('\n🔗 You can now access your league in the app!');
      return result.data;
    } else {
      console.error('❌ Failed to create league:', result);
      return null;
    }
  } catch (error) {
    console.error('💥 Error creating league:', error.message);
    return null;
  }
}

// CLI support for different league types
const leagueType = process.argv[2];
const customName = process.argv[3];

// Help function
function showHelp() {
  console.log(`
🏈 AFL League Creator
===================

Usage:
  node create-league-direct.cjs [type] [name]

League Types:
  champions  - AFL Champions League (default, 12 teams, 9 categories)
  test       - Test League (4 teams, for testing)
  simple     - Simple League (8 teams, 3 categories)

Examples:
  node create-league-direct.cjs                           # Creates default champions league
  node create-league-direct.cjs test                      # Creates test league
  node create-league-direct.cjs test "My Test League"     # Creates test league with custom name
  node create-league-direct.cjs simple                    # Creates simple league
  node create-league-direct.cjs champions "My League"     # Creates champions league with custom name

Environment Variables:
  SERVER_URL - API server URL (default: http://localhost:3000)
  USER_ID    - User ID for league creation (required)
`);
}

if (leagueType === '--help' || leagueType === '-h' || leagueType === 'help') {
  showHelp();
  process.exit(0);
}

switch (leagueType) {
  case 'test':
    createLeague({ 
      name: customName || 'Test League 2025', 
      maxTeams: 4,
      description: 'Test league for development and testing purposes.'
    });
    break;
  case 'simple':
    createLeague({ 
      name: customName || 'Simple AFL League', 
      maxTeams: 8,
      categories: ["goals", "kicks", "marks"],
      description: 'Simplified AFL league with basic scoring.'
    });
    break;
  case 'champions':
  default:
    createLeague(customName ? { name: customName } : {});
}
