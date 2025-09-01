// Simple test to call the API and see what data it returns
async function testAPI() {
  try {
    const response = await fetch('http://localhost:3002/api/player-stats?season=2025');
    const data = await response.json();

    console.log('API Response status:', data.success);
    console.log('Number of players:', data.data.length);

    if (data.success && data.data.length > 0) {
      const firstPlayer = data.data[0];
      console.log('\nFirst player data:');
      console.log('- Player name:', firstPlayer.player_name);
      console.log('- Team:', firstPlayer.team);
      console.log('- Total Value:', firstPlayer.totalValue);
      console.log('- Type of totalValue:', typeof firstPlayer.totalValue);
      console.log('- Is NaN?:', Number.isNaN(firstPlayer.totalValue));

      // Check first few players for any NaN values
      const nanPlayers = data.data.filter((p) => Number.isNaN(p.totalValue));
      console.log('\nPlayers with NaN totalValue:', nanPlayers.length);

      // Check data structure
      console.log('\nSample categories:', firstPlayer.categories);
      console.log('Sample perGameLog structure keys:', Object.keys(firstPlayer.perGameLog || {}));
    }
  } catch (error) {
    console.error('Error calling API:', error);
  }
}

testAPI();
