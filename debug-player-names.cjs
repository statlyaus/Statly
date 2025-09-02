const fetch = require('node-fetch');

async function testPlayerNames() {
  try {
    console.log('Testing player-stats API...');
    const response = await fetch('http://localhost:3001/api/player-stats?season=2025&limit=10');

    if (!response.ok) {
      console.error('API response not OK:', response.status);
      return;
    }

    const data = await response.json();

    console.log('API Response:');
    console.log('- Success:', data.success);
    console.log('- Count:', data.count);

    if (data.data && Array.isArray(data.data)) {
      console.log('\nFirst 5 player names:');
      data.data.slice(0, 5).forEach((player, i) => {
        console.log(
          `${i + 1}. Name: "${player.player_name}", Team: "${player.team}", ID: "${player.id}"`
        );
      });

      // Check for Aaron Cadman specifically
      const aaronCadmanRecords = data.data.filter((p) => p.player_name === 'Aaron Cadman');
      console.log(`\nAaron Cadman records found: ${aaronCadmanRecords.length}`);

      // Check for null/undefined/empty names
      const emptyNames = data.data.filter((p) => !p.player_name || p.player_name.trim() === '');
      console.log(`Records with empty names: ${emptyNames.length}`);

      if (emptyNames.length > 0) {
        console.log('Examples of empty name records:');
        emptyNames.slice(0, 3).forEach((player, i) => {
          console.log(`  ${i + 1}. Name: "${player.player_name}", ID: "${player.id}"`);
        });
      }
    }
  } catch (error) {
    console.error('Error testing API:', error.message);
  }
}

testPlayerNames();
