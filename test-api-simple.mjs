import fetch from 'node-fetch';

async function testAPI() {
  try {
    console.log('Testing rankings API...');
    const rankingsResponse = await fetch('http://localhost:3001/api/rankings?season=2025&period=season&sortBy=overall&sortDirection=desc');
    console.log('Rankings response status:', rankingsResponse.status);
    
    if (!rankingsResponse.ok) {
      const text = await rankingsResponse.text();
      console.log('Rankings error body:', text);
    } else {
      const data = await rankingsResponse.json();
      console.log('Rankings success, got', data.data?.length || 0, 'players');
    }

    console.log('\nTesting weekend-summary API...');
    const summaryResponse = await fetch('http://localhost:3001/api/weekend-summary');
    console.log('Summary response status:', summaryResponse.status);
    
    if (!summaryResponse.ok) {
      const text = await summaryResponse.text();
      console.log('Summary error body:', text);
    } else {
      const data = await summaryResponse.json();
      console.log('Summary success:', data.summary?.substring(0, 100) || 'No summary');
    }

  } catch (error) {
    console.error('Test error:', error.message);
  }
}

testAPI();
