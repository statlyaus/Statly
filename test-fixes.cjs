const https = require('https');

// Disable SSL verification for localhost
process.env['NODE_TLS_REJECT_UNAUTHORIZED'] = 0;

async function testAPIs() {
  console.log('Testing APIs after fixes...\n');

  try {
    // Test 1: Player Stats API
    console.log('1. Testing player-stats API...');
    const playerResponse = await fetch(
      'http://localhost:3001/api/player-stats?season=2025&limit=5'
    );

    if (playerResponse.ok) {
      const playerData = await playerResponse.json();
      console.log('✅ Player Stats API working');
      console.log(`   - Found ${playerData.count} players`);

      if (playerData.data && playerData.data.length > 0) {
        console.log('   - Sample player names:');
        playerData.data.slice(0, 3).forEach((player, i) => {
          console.log(`     ${i + 1}. "${player.player_name}" (${player.team})`);
        });

        // Check for "Aaron Cadman" dominance
        const uniqueNames = [...new Set(playerData.data.map((p) => p.player_name))];
        console.log(`   - Unique player names in sample: ${uniqueNames.length}`);

        if (uniqueNames.length === 1 && uniqueNames[0] === 'Aaron Cadman') {
          console.log('❌ Still showing everyone as Aaron Cadman!');
        } else {
          console.log('✅ Diverse player names detected');
        }
      }
    } else {
      console.log(`❌ Player Stats API failed: ${playerResponse.status}`);
    }

    console.log();

    // Test 2: Weekend Summary API
    console.log('2. Testing weekend-summary API...');
    const summaryResponse = await fetch('http://localhost:3001/api/weekend-summary');

    if (summaryResponse.ok) {
      const summaryData = await summaryResponse.json();
      console.log('✅ Weekend Summary API working');
      console.log(`   - Summary length: ${summaryData.summary?.length || 0} characters`);
    } else {
      console.log(`❌ Weekend Summary API failed: ${summaryResponse.status}`);
      const errorText = await summaryResponse.text();
      console.log(`   - Error: ${errorText.substring(0, 100)}...`);
    }
  } catch (error) {
    console.error('❌ Test failed:', error.message);
  }
}

// Use built-in fetch for Node.js 18+
if (typeof fetch === 'undefined') {
  global.fetch = require('node-fetch');
}

testAPIs();
