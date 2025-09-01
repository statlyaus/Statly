const fetch = require('node-fetch');

async function testAPI() {
  try {
    console.log('Testing rankings API...');
    const response = await fetch(
      'http://localhost:3001/api/rankings?season=2025&period=season&sortBy=overall&sortDirection=desc'
    );

    if (!response.ok) {
      console.error('API response not OK:', response.status);
      return;
    }

    const data = await response.json();

    console.log('API Response structure:');
    console.log('- Success:', data.success);
    console.log('- Data exists:', !!data.data);
    console.log('- Players array exists:', !!data.data?.players);
    console.log('- Number of players:', data.data?.players?.length || 'N/A');
    console.log('- Total players in meta:', data.data?.meta?.totalPlayers || 'N/A');

    if (data.data?.players?.length > 0) {
      console.log('\nFirst player example:');
      console.log('- Name:', data.data.players[0].playerName);
      console.log('- Team:', data.data.players[0].team);
      console.log('- Rank:', data.data.players[0].rank);
      console.log('- Overall score:', data.data.players[0].overall);
      console.log('- Games:', data.data.players[0].games);
    }

    console.log('\nSuccess! API is working properly.');
  } catch (error) {
    console.error('Error testing API:', error.message);
  }
}

testAPI();
