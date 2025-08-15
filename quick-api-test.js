#!/usr/bin/env node

async function testAPI() {
  try {
    // First check if Next.js dev server is running
    const testResponse = await fetch('http://localhost:3000/api/player-stats');
    
    if (!testResponse.ok) {
      console.log('❌ API not responding, starting Next.js dev server...');
      // Need to start the server first
      return;
    }
    
    const data = await testResponse.json();
    console.log('✅ API Response Status:', testResponse.status);
    console.log('📊 Total Records:', data.data ? data.data.length : 0);
    
    if (data.data && data.data.length > 0) {
      console.log('\n🏈 Sample Player Data:');
      const sample = data.data[0];
      console.log('Player:', sample.playerName);
      console.log('Team:', sample.team);
      console.log('Round:', sample.round);
      
      console.log('\n📈 9-Category Stats:');
      console.log('Goals:', sample.goals);
      console.log('Tackles:', sample.tackles);
      console.log('Inside 50s:', sample.inside50s);
      console.log('Intercepts:', sample.intercepts);
      console.log('Contested Marks:', sample.contestedMarks);
      console.log('Rebound 50s:', sample.rebound50s);
      console.log('Contested Possessions:', sample.contestedPossessions);
      console.log('Effective Disposals:', sample.effectiveDisposals);
      console.log('Score Involvements:', sample.scoreInvolvements);
      console.log('Total Value:', sample.totalValue);
    }
    
  } catch (error) {
    console.error('❌ Error testing API:', error.message);
    console.log('Starting Next.js dev server...');
  }
}

testAPI();
