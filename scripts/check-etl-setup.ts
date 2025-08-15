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

  // Check for required files
  const requiredFiles = [
    'statly-4cbed-firebase-adminsdk-fbsvc-7df0e3dae3.json',
    '.env.local',
    'package.json',
  ];

  console.log('📁 Checking required files:');
  requiredFiles.forEach((file) => {
    const filePath = path.join(process.cwd(), file);
    if (fs.existsSync(filePath)) {
      console.log(`   ✅ ${file}`);
    } else {
      console.log(`   ❌ ${file}`);
      issues.push(`Missing required file: ${file}`);
    }
  });

  // Check environment variables
  console.log('\n🔐 Checking environment variables:');
  const envPath = path.join(process.cwd(), '.env.local');

  if (fs.existsSync(envPath)) {
    const envContent = fs.readFileSync(envPath, 'utf8');

    // Check for Firebase service account
    if (
      envContent.includes('GOOGLE_SERVICE_ACCOUNT') ||
      envContent.includes('FIREBASE_SERVICE_ACCOUNT')
    ) {
      console.log('   ✅ Firebase service account variable found');
    } else {
      console.log('   ⚠️  Firebase service account variable not found');
      warnings.push('Add GOOGLE_SERVICE_ACCOUNT to .env.local with your service account JSON');
    }

    // Check for other common variables
    const expectedVars = ['NEXT_PUBLIC_FIREBASE_PROJECT_ID', 'NEXT_PUBLIC_FIREBASE_APP_ID'];
    expectedVars.forEach((varName) => {
      if (envContent.includes(varName)) {
        console.log(`   ✅ ${varName}`);
      } else {
        console.log(`   ⚠️  ${varName} not found`);
        warnings.push(`Consider adding ${varName} to .env.local`);
      }
    });
  } else {
    console.log('   ❌ .env.local file not found');
    issues.push('Create .env.local file with required environment variables');
  }

  // Check API routes exist
  console.log('\n🛣️  Checking API routes:');
  const apiRoutes = ['src/app/api/player-stats/route.ts', 'src/app/api/matches/enhanced/route.ts'];

  apiRoutes.forEach((route) => {
    const routePath = path.join(process.cwd(), route);
    if (fs.existsSync(routePath)) {
      console.log(`   ✅ ${route}`);
    } else {
      console.log(`   ❌ ${route}`);
      issues.push(`Missing API route: ${route}`);
    }
  });

  // Check hooks exist
  console.log('\n🪝 Checking client hooks:');
  const hooks = ['src/hooks/usePlayerStats.ts', 'src/hooks/useEnhancedMatches.ts'];

  hooks.forEach((hook) => {
    const hookPath = path.join(process.cwd(), hook);
    if (fs.existsSync(hookPath)) {
      console.log(`   ✅ ${hook}`);
    } else {
      console.log(`   ❌ ${hook}`);
      issues.push(`Missing hook: ${hook}`);
    }
  });

  // Check scripts exist
  console.log('\n📜 Checking initialization scripts:');
  const scripts = ['scripts/initialize-firebase-db.ts'];

  scripts.forEach((script) => {
    const scriptPath = path.join(process.cwd(), script);
    if (fs.existsSync(scriptPath)) {
      console.log(`   ✅ ${script}`);
    } else {
      console.log(`   ❌ ${script}`);
      issues.push(`Missing script: ${script}`);
    }
  });

  // Check package.json scripts
  console.log('\n📦 Checking package.json scripts:');
  const packageJsonPath = path.join(process.cwd(), 'package.json');
  if (fs.existsSync(packageJsonPath)) {
    const packageJson = JSON.parse(fs.readFileSync(packageJsonPath, 'utf8'));
    const scripts = packageJson.scripts || {};

    const recommendedScripts = ['init-firebase-db', 'test-etl'];

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
  console.log('3. Test API endpoints: /api/player-stats and /api/matches/enhanced');
  console.log('4. Use ETLTestComponent to verify integration');

  console.log('\n💡 Quick Setup Commands:');
  console.log('   # Initialize Firebase database');
  console.log('   npx tsx scripts/initialize-firebase-db.ts');
  console.log('');
  console.log('   # Test API endpoints');
  console.log('   curl http://localhost:3000/api/player-stats?season=2025');
  console.log('   curl http://localhost:3000/api/matches/enhanced?season=2025');

  return { issues: issues.length, warnings: warnings.length };
}

// Run the check
const result = checkEnvironmentSetup();
process.exit(result.issues > 0 ? 1 : 0);

export { checkEnvironmentSetup };
