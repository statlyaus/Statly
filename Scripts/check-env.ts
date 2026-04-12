#!/usr/bin/env tsx
/**
 * Checks that .env.local is parsed and highlights potential issues.
 * Safe output only: shows non-sensitive values and presence flags.
 */
import { config } from 'dotenv';

// Load from project root
config({ path: '.env.local' });

type Report = {
  ok: boolean;
  nodeEnv: string;
  serverVars: Record<string, string | null>;
  flags: Record<string, boolean>;
  warnings: string[];
};

const report: Report = {
  ok: true,
  nodeEnv: process.env.NODE_ENV || 'development',
  serverVars: {
    APP_BASE_URL: process.env.APP_BASE_URL || null,
    APP_ORIGIN: process.env.APP_ORIGIN || null,
    NEXT_PUBLIC_API_URL: process.env.NEXT_PUBLIC_API_URL || null,
    NEXT_PUBLIC_SOCKET_URL: process.env.NEXT_PUBLIC_SOCKET_URL || null,
    SOCKETIO_PORT: process.env.SOCKETIO_PORT || null,
  },
  flags: {
    hasFirebaseBase64: Boolean(process.env.FIREBASE_SERVICE_ACCOUNT_JSON_BASE64?.trim()),
    hasFirebaseProjectId: Boolean(process.env.FIREBASE_PROJECT_ID),
    hasFirebaseClientEmail: Boolean(process.env.FIREBASE_CLIENT_EMAIL),
    hasFirebasePrivateKey: Boolean(process.env.FIREBASE_PRIVATE_KEY),
  },
  warnings: [],
};

// Detect Vite/Cra-style client vars not used by Next.js
if (process.env.VITE_API_URL) {
  report.warnings.push(
    'Found VITE_API_URL which Next.js ignores. Use NEXT_PUBLIC_API_URL for client code.'
  );
}
for (const key of Object.keys(process.env)) {
  if (/^(VITE_|REACT_APP_)/.test(key)) {
    report.warnings.push(`Found ${key} which Next.js ignores on client. Prefer NEXT_PUBLIC_*.`);
  }
}

// Recommend restart if running in dev and NEXT_PUBLIC_* changed
if (process.env.NODE_ENV !== 'production') {
  report.warnings.push('If you changed NEXT_PUBLIC_* vars, restart the dev server to apply.');
}

console.log(JSON.stringify(report, null, 2));
