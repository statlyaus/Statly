// Create league directly using Node.js
const fetch = require('node-fetch');

async function createLeague() {
  const leagueData = {
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
  };

  try {
    console.log('🎯 Creating AFL Champions League...');
    
    const response = await fetch('http://localhost:3000/api/leagues', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-user-id': '2qlfdHSCFTPlxoKFSUfNLSlCDRe2'
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
      console.log(`  - Categories: ${result.data.categories.join(', ')}`);
      console.log(`  - Description: ${result.data.description}`);
      console.log(`  - Status: ${result.data.status}`);
      console.log('\n🔗 You can now access your league in the app!');
    } else {
      console.error('❌ Failed to create league:', result);
    }
  } catch (error) {
    console.error('💥 Error creating league:', error.message);
  }
}

createLeague();
