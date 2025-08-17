// Simple test to call the API and see what data it returns
async function testAPI() {
  try {
    const response = await fetch('http://localhost:3002/api/player-stats?season=2025');
    const data = await response.json();
    
    console.log('API Response:', data);
    
    if (data.success && data.data.length > 0) {
      const firstPlayer = data.data[0];
      console.log('First player data:', firstPlayer);
      console.log('TotalValue:', firstPlayer.totalValue);
      console.log('Categories:', firstPlayer.categories);
      console.log('PerGameLog:', firstPlayer.perGameLog);
    }
  } catch (error) {
    console.error('Error calling API:', error);
  }
}

testAPI();
