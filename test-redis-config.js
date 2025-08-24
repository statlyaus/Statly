#!/usr/bin/env node

// Simple test to verify Redis retry configuration
console.log('Testing Redis configuration...');

// Test environment variable parsing
const redisMaxRetries = parseInt(process.env.REDIS_MAX_RETRIES || '3');
console.log(`REDIS_MAX_RETRIES: ${redisMaxRetries} (type: ${typeof redisMaxRetries})`);

// Verify it's a valid number
if (isNaN(redisMaxRetries)) {
  console.error('❌ REDIS_MAX_RETRIES is not a valid number');
  process.exit(1);
}

if (redisMaxRetries < 1 || redisMaxRetries > 10) {
  console.warn('⚠️  REDIS_MAX_RETRIES outside recommended range (1-10)');
}

console.log('✅ Redis retry configuration is valid');
console.log(`   - Will retry failed Redis operations up to ${redisMaxRetries} times`);
console.log('   - This provides resilience against transient network errors');
console.log('   - Avoids infinite retry loops that could hang the application');
