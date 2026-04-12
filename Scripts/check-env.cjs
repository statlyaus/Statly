#!/usr/bin/env node
// Check .env.local parsing and surface safe info
require('dotenv').config({ path: '.env.local' });

const report = {
  ok: true,
  nodeEnv: process.env.NODE_ENV || 'development',
  serverVars: {
    APP_BASE_URL: process.env.APP_BASE_URL || null,
    APP_ORIGIN: process.env.APP_ORIGIN || null,
    NEXT_PUBLIC_API_BASE_URL: process.env.NEXT_PUBLIC_API_BASE_URL || null,
    NEXT_PUBLIC_API_URL: process.env.NEXT_PUBLIC_API_URL || null,
    NEXT_PUBLIC_SOCKET_URL: process.env.NEXT_PUBLIC_SOCKET_URL || null,
    SOCKETIO_PORT: process.env.SOCKETIO_PORT || null,
    SOCKET_PORT: process.env.SOCKET_PORT || null,
  },
  flags: {
    hasFirebaseBase64: Boolean(
      process.env.FIREBASE_SERVICE_ACCOUNT_JSON_BASE64 &&
      process.env.FIREBASE_SERVICE_ACCOUNT_JSON_BASE64.trim()
    ),
    hasFirebaseProjectId: Boolean(process.env.FIREBASE_PROJECT_ID),
    hasFirebaseClientEmail: Boolean(process.env.FIREBASE_CLIENT_EMAIL),
    hasFirebasePrivateKey: Boolean(process.env.FIREBASE_PRIVATE_KEY),
  },
  warnings: [],
};

const warnings = new Set();
if (process.env.VITE_API_URL) {
  warnings.add(
    'Found VITE_API_URL which Next.js ignores. Use NEXT_PUBLIC_API_URL for client code.'
  );
}
for (const key of Object.keys(process.env)) {
  if (/^(VITE_|REACT_APP_)/.test(key)) {
    warnings.add(`Found ${key} which Next.js ignores on client. Prefer NEXT_PUBLIC_*.`);
  }
}

if (process.env.NODE_ENV !== 'production') {
  warnings.add('If you changed NEXT_PUBLIC_* vars, restart the dev server to apply.');
}

report.warnings = Array.from(warnings);

console.log(JSON.stringify(report, null, 2));
