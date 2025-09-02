#!/usr/bin/env node

const { initializeApp, getApps, cert } = require('firebase-admin/app');
const { getFirestore } = require('firebase-admin/firestore');
const fs = require('fs');
const path = require('path');

console.log('🔥 Testing Firebase Admin Authentication...');

try {
  if (getApps().length === 0) {
    const serviceAccountPath = path.join(
      __dirname,
      'statly-4cbed-firebase-adminsdk-fbsvc-7df0e3dae3.json'
    );

    if (!fs.existsSync(serviceAccountPath)) {
      throw new Error('Service account file not found');
    }

    const serviceAccount = require(serviceAccountPath);
    console.log('✅ Service account loaded');
    console.log(`   Project ID: ${serviceAccount.project_id}`);
    console.log(`   Client email: ${serviceAccount.client_email}`);

    initializeApp({
      credential: cert(serviceAccount),
      projectId: serviceAccount.project_id,
    });

    console.log('✅ Firebase Admin initialized');
  }

  const db = getFirestore();
  console.log('✅ Firestore instance created');

  // Test a simple query
  console.log('🧪 Testing database access...');

  const testQuery = async () => {
    try {
      const snapshot = await db.collection('leagues').limit(1).get();
      console.log(`✅ Database query successful - found ${snapshot.size} documents`);
      return true;
    } catch (error) {
      console.error('❌ Database query failed:', error.message);
      return false;
    }
  };

  testQuery().then((success) => {
    if (success) {
      console.log('🎉 Firebase authentication test PASSED');
    } else {
      console.log('💥 Firebase authentication test FAILED');
    }
    process.exit(success ? 0 : 1);
  });
} catch (error) {
  console.error('❌ Firebase initialization failed:', error.message);
  process.exit(1);
}
