// Simple test to check if API is working
const http = require('http');

function testAPI() {
  const postData = JSON.stringify({
    name: "AFL Champions League 2025",
    type: "public", 
    maxTeams: 12,
    description: "Premier AFL Fantasy league with comprehensive scoring across 9 categories.",
    categories: ["goals", "kicks", "handballs", "marks", "tackles", "hitouts", "clearances", "inside50s", "contestedPossessions"],
    tradeSettings: {
      tradeLimit: 15,
      tradeReview: "none"
    },
    waiverWire: {
      waiverPeriodHours: 24,
      waiverResetPolicy: "weekly"
    }
  });

  const options = {
    hostname: 'localhost',
    port: 3000,
    path: '/api/leagues',
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-user-id': '2qlfdHSCFTPlxoKFSUfNLSlCDRe2',
      'Content-Length': Buffer.byteLength(postData)
    }
  };

  console.log('🎯 Creating AFL Champions League...');
  
  const req = http.request(options, (res) => {
    console.log(`Status: ${res.statusCode}`);
    console.log(`Headers: ${JSON.stringify(res.headers)}`);
    
    let data = '';
    res.on('data', (chunk) => {
      data += chunk;
    });
    
    res.on('end', () => {
      try {
        const result = JSON.parse(data);
        if (res.statusCode === 201) {
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
      } catch (e) {
        console.error('❌ Failed to parse response:', data);
      }
    });
  });

  req.on('error', (e) => {
    console.error(`💥 Request error: ${e.message}`);
  });

  req.write(postData);
  req.end();
}

testAPI();
