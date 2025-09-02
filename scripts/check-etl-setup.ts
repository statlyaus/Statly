/**
 * Environment Setup Script for ETL Integration
 * This script ensures all environment variables are properly configured
 */

import * as fs from 'fs';
import * as path from 'path';

function checkEnvironmentSetup() {
  console.log('🔍 Checking ETL Integration environment setup...\n');

  const issues: string[] = [];
  const warnings: string[] = [];

  // Check for required files (no local service account JSON file required when using base64 env)
  const requiredFiles = [
    '.env.local',
    'package.json',
    // Optional but recommended to exist
    'firestore.rules',
    'firestore.indexes.json',
  ];

  console.log('📁 Checking required files:');
  requiredFiles.forEach((file) => {
    const filePath = path.join(process.cwd(), file);
    if (fs.existsSync(filePath)) {
      console.log(`   ✅ ${file}`);
    } else {
      console.log(`   ❌ ${file}`);
      // firestore.rules / firestore.indexes.json are recommendations, not critical
      if (file === 'firestore.rules' || file === 'firestore.indexes.json') {
        warnings.push(`Missing optional file: ${file}`);
      } else {
        issues.push(`Missing required file: ${file}`);
      }
    }
  });

  // Check environment variables
  console.log('\n🔐 Checking environment variables:');
  const envPath = path.join(process.cwd(), '.env.local');

  if (fs.existsSync(envPath)) {
    const envContent = fs.readFileSync(envPath, 'utf8');

    // Check for Firebase service account (base64 JSON string)
    if (envContent.match(/^\s*FIREBASE_SERVICE_ACCOUNT_JSON_BASE64=/m)) {
      console.log('   ✅ FIREBASE_SERVICE_ACCOUNT_JSON_BASE64');
    } else {
      console.log('   ❌ FIREBASE_SERVICE_ACCOUNT_JSON_BASE64 not found');
      issues.push(
        'Add FIREBASE_SERVICE_ACCOUNT_JSON_BASE64 to .env.local (base64 of your service account JSON)'
      );
    }

    // Client Firebase vars required for browser SDK
    const requiredClientVars = [
      'NEXT_PUBLIC_FIREBASE_API_KEY',
      'NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN',
      'NEXT_PUBLIC_FIREBASE_PROJECT_ID',
      'NEXT_PUBLIC_FIREBASE_APP_ID',
    ];

    requiredClientVars.forEach((varName) => {
      if (envContent.includes(varName)) {
        console.log(`   ✅ ${varName}`);
      } else {
        console.log(`   ⚠️  ${varName} not found`);
        warnings.push(`Consider adding ${varName} to .env.local`);
      }
    });

    // Optional but common
    const optionalClientVars = [
      'NEXT_PUBLIC_FIREBASE_MESSAGING_SENDER_ID',
      'NEXT_PUBLIC_FIREBASE_MEASUREMENT_ID',
    ];
    optionalClientVars.forEach((varName) => {
      if (envContent.includes(varName)) {
        console.log(`   ✅ ${varName}`);
      } else {
        console.log(`   ℹ️  ${varName} not found (optional)`);
      }
    });
  } else {
    console.log('   ❌ .env.local file not found');
    issues.push('Create .env.local file with required environment variables');
  }

  // Check API routes exist
  console.log('\n🛣️  Checking API routes:');
  const apiRoutes = [
    'src/app/api/player-stats/route.ts',
    'src/app/api/matches/enhanced/route.ts',
    // Helpful diagnostics
    'src/app/api/auth/health/route.ts',
    'src/app/api/rankings/route.ts',
  ];

  apiRoutes.forEach((route) => {
    const routePath = path.join(process.cwd(), route);
    if (fs.existsSync(routePath)) {
      console.log(`   ✅ ${route}`);
    } else {
      console.log(`   ❌ ${route}`);
      warnings.push(`Missing API route: ${route}`);
    }
  });

  // Check hooks exist
  console.log('\n🪝 Checking client hooks:');
  const hooks = [
    // Use the live variant present in the codebase
    'src/hooks/useLivePlayerStats.ts',
    'src/hooks/useEnhancedMatches.ts',
  ];

  hooks.forEach((hook) => {
    const hookPath = path.join(process.cwd(), hook);
    if (fs.existsSync(hookPath)) {
      console.log(`   ✅ ${hook}`);
    } else {
      console.log(`   ❌ ${hook}`);
      warnings.push(`Missing hook: ${hook}`);
    }
  });

  // Check scripts exist (correct case: Scripts/)
  console.log('\n📜 Checking initialization & maintenance scripts:');
  const scripts = [
    'Scripts/initialize-firebase-db.ts',
    'Scripts/cleanPlayerData.ts',
    'Scripts/clean-player-data.js',
  ];

  scripts.forEach((script) => {
    const scriptPath = path.join(process.cwd(), script);
    if (fs.existsSync(scriptPath)) {
      console.log(`   ✅ ${script}`);
    } else {
      console.log(`   ❌ ${script}`);
      warnings.push(`Missing script: ${script}`);
    }
  });

  // Check package.json scripts
  console.log('\n📦 Checking package.json scripts:');
  const packageJsonPath = path.join(process.cwd(), 'package.json');
  if (fs.existsSync(packageJsonPath)) {
    const packageJson = JSON.parse(fs.readFileSync(packageJsonPath, 'utf8'));
    const scripts = packageJson.scripts || {};

    const recommendedScripts = [
      // initialize database
      'init-firebase-db',
      // quick health/run checks
      'check:etl',
    ];

    recommendedScripts.forEach((scriptName) => {
      if (scripts[scriptName]) {
        console.log(`   ✅ ${scriptName}`);
      } else {
        console.log(`   ⚠️  ${scriptName} script not found`);
        warnings.push(`Add "${scriptName}" script to package.json`);
      }
    });
  }

  // Print summary
  console.log('\n📊 Environment Setup Summary:');
  console.log('='.repeat(50));

  if (issues.length === 0) {
    console.log('🎉 All critical requirements are met!');
  } else {
    console.log('❌ Critical Issues Found:');
    issues.forEach((issue, index) => {
      console.log(`   ${index + 1}. ${issue}`);
    });
  }

  if (warnings.length > 0) {
    console.log('\n⚠️  Recommendations:');
    warnings.forEach((warning, index) => {
      console.log(`   ${index + 1}. ${warning}`);
    });
  }

  // Next steps
  console.log('\n🚀 Next Steps:');
  console.log('1. Fix any critical issues listed above');
  console.log('2. Run: npm run init-firebase-db (to initialize database)');
  console.log(
    '3. Test API endpoints: /api/auth/health, /api/player-stats, /api/matches/enhanced, /api/rankings'
  );
  console.log('4. Use ETLTestComponent to verify integration');

  console.log('\n💡 Quick Setup Commands:');
  console.log('   # Initialize Firebase database');
  console.log('   npx tsx Scripts/initialize-firebase-db.ts');
  console.log('');
  console.log('   # Test API endpoints');
  console.log('   curl http://localhost:3000/api/auth/health');
  console.log('   curl "http://localhost:3000/api/player-stats?season=2025"');
  console.log('   curl "http://localhost:3000/api/matches/enhanced?season=2025"');
  console.log('   curl http://localhost:3000/api/rankings');

  return { issues: issues.length, warnings: warnings.length };
}

// Run the check
const result = checkEnvironmentSetup();
process.exit(result.issues > 0 ? 1 : 0);

export { checkEnvironmentSetup };
