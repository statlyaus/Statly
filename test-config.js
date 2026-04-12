// Test script to verify socketIOConfig works correctly
const { execSync } = require('child_process');

try {
  // Compile TypeScript to JavaScript first
  console.log('🔧 Compiling TypeScript files...');
  execSync(
    'npx tsc src/lib/socketioConfig.ts --outDir temp --target es2020 --module commonjs --esModuleInterop --skipLibCheck',
    { stdio: 'inherit' }
  );

  // Load the compiled JavaScript
  console.log('📦 Loading compiled configuration...');
  const { socketIOConfig } = require('./temp/src/lib/socketioConfig.js');

  console.log('✅ socketIOConfig loaded successfully');
  console.log('Client config keys:', Object.keys(socketIOConfig.client));
  console.log('Client config types:', {
    url: typeof socketIOConfig.client.url,
    autoConnect: typeof socketIOConfig.client.autoConnect,
    reconnection: typeof socketIOConfig.client.reconnection,
    reconnectionAttempts: typeof socketIOConfig.client.reconnectionAttempts,
    reconnectionDelay: typeof socketIOConfig.client.reconnectionDelay,
    reconnectionDelayMax: typeof socketIOConfig.client.reconnectionDelayMax,
    timeout: typeof socketIOConfig.client.timeout,
    transports: Array.isArray(socketIOConfig.client.transports)
      ? 'array'
      : typeof socketIOConfig.client.transports,
    healthCheckIntervalMs: typeof socketIOConfig.client.healthCheckIntervalMs,
  });

  // Test runtime validation
  console.log('🔍 Testing runtime validation...');
  const { validateSocketIOConfig } = require('./temp/src/lib/socketioConfig.js');
  validateSocketIOConfig(socketIOConfig);
  console.log('✅ Runtime validation passed');

  console.log('🎉 All tests passed!');
} catch (error) {
  console.error('❌ Error:', error.message);
  process.exit(1);
} finally {
  // Cleanup
  try {
    execSync('rm -rf temp', { stdio: 'inherit' });
  } catch (e) {
    // Ignore cleanup errors
  }
}
