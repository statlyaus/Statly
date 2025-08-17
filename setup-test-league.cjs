#!/usr/bin/env node

/**
 * AFL Fantasy League - Complete Setup & Testing
 * Creates a test league and runs comprehensive API tests
 * 
 * Usage: node setup-test-league.cjs
 */

const { createTestLeague } = require('./create-test-league.cjs');
const { LeagueAPITester } = require('./test-league-features.cjs');

async function main() {
  console.log('🏈 AFL Fantasy League - Complete Setup & Testing');
  console.log('================================================\n');

  try {
    // Step 1: Create test league
    console.log('📝 STEP 1: Creating test league...');
    const leagueData = await createTestLeague();
    
    console.log('\n⏳ Waiting 3 seconds for database propagation...');
    await new Promise(resolve => setTimeout(resolve, 3000));
    
    // Step 2: Test league functionality
    console.log('\n🧪 STEP 2: Testing league functionality...');
    const tester = new LeagueAPITester(leagueData.leagueId);
    const testResults = await tester.runAllTests();
    
    // Step 3: Final summary
    console.log('\n🎉 SETUP COMPLETE!');
    console.log('==================');
    console.log(`✅ League Created: ${leagueData.leagueId}`);
    console.log(`✅ Join Code: ${leagueData.leagueCode}`);
    console.log(`✅ Tests Passed: ${testResults.summary.testsPassed}/${testResults.summary.testsRun}`);
    
    console.log('\n🎮 READY TO USE:');
    console.log('================');
    console.log('Your 12-team AFL Fantasy league is ready with:');
    console.log('• 11 bot-controlled teams with realistic names');
    console.log('• Snake draft system with auto-pick capability');
    console.log('• Trade proposals already waiting for you');
    console.log('• Waiver claims system configured');
    console.log('• Complete roster management');
    console.log('• League activity feed');
    
    console.log('\n🚀 NEXT STEPS:');
    console.log('==============');
    console.log('1. Start your server: npm run dev');
    console.log('2. Open: http://localhost:3001/leagues');
    console.log(`3. Join with code: ${leagueData.leagueCode}`);
    console.log('4. Explore all features!');
    
    return {
      leagueData,
      testResults,
      success: true
    };
    
  } catch (error) {
    console.error('\n❌ Setup failed:', error);
    return {
      success: false,
      error: error.message
    };
  }
}

// Run if called directly
if (require.main === module) {
  main().then(result => {
    if (result.success) {
      console.log('\n✅ All setup completed successfully!');
      process.exit(0);
    } else {
      console.log('\n❌ Setup failed');
      process.exit(1);
    }
  });
}

module.exports = { main };
