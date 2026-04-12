#!/usr/bin/env node
// Validate environment for staging/production. Warn in development.
const { z } = require('zod');

const ServerSchema = z.object({
  NODE_ENV: z.enum(['development', 'staging', 'production']).default('development'),
  DATABASE_URL: z.string().min(1, 'DATABASE_URL is required').optional(),
  FIREBASE_SERVICE_ACCOUNT_JSON_BASE64: z.string().optional(),
  FIREBASE_PROJECT_ID: z.string().optional(),
  FIREBASE_CLIENT_EMAIL: z.string().optional(),
  FIREBASE_PRIVATE_KEY: z.string().optional(),
  NEXT_PUBLIC_API_BASE_URL: z.string().url().optional(),
  NEXT_PUBLIC_SOCKET_URL: z.string().url().optional(),
});

const parsed = ServerSchema.safeParse(process.env);
const nodeEnv = process.env.NODE_ENV || 'development';

const errors = [];
if (!parsed.success) {
  for (const e of parsed.error.errors) {
    errors.push(`${e.path.join('.')}: ${e.message}`);
  }
}

const hasBase64 = Boolean(
  process.env.FIREBASE_SERVICE_ACCOUNT_JSON_BASE64 &&
  process.env.FIREBASE_SERVICE_ACCOUNT_JSON_BASE64.trim()
);
const hasTriple = Boolean(
  process.env.FIREBASE_PROJECT_ID &&
  process.env.FIREBASE_CLIENT_EMAIL &&
  process.env.FIREBASE_PRIVATE_KEY
);

if (nodeEnv === 'production') {
  if (!process.env.DATABASE_URL) errors.push('DATABASE_URL: required in production');
  if (!hasBase64 && !hasTriple) errors.push('Firebase ADC or service account credentials required');
}

if (errors.length) {
  if (nodeEnv === 'production') {
    console.error('[env:validate] Invalid production configuration:\n - ' + errors.join('\n - '));
    process.exit(1);
  } else {
    console.warn('[env:validate] Warnings (non-fatal in development):\n - ' + errors.join('\n - '));
  }
} else {
  console.log('[env:validate] Environment OK (' + nodeEnv + ')');
}
