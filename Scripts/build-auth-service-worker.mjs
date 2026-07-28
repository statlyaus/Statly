import { mkdir } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import nextEnv from '@next/env';
import { build } from 'esbuild';

const { loadEnvConfig } = nextEnv;

const scriptsDirectory = path.dirname(fileURLToPath(import.meta.url));
const projectRoot = path.resolve(scriptsDirectory, '..');
const outputDirectory = path.join(projectRoot, 'public');
const outputFile = path.join(outputDirectory, 'auth-service-worker.js');

loadEnvConfig(projectRoot, process.env.NODE_ENV !== 'production');

const firebaseConfig = {
  apiKey: process.env.NEXT_PUBLIC_FIREBASE_API_KEY ?? '',
  authDomain: process.env.NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN ?? '',
  projectId: process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID ?? '',
  storageBucket: process.env.NEXT_PUBLIC_FIREBASE_STORAGE_BUCKET ?? '',
  messagingSenderId: process.env.NEXT_PUBLIC_FIREBASE_MESSAGING_SENDER_ID ?? '',
  appId: process.env.NEXT_PUBLIC_FIREBASE_APP_ID ?? '',
  measurementId: process.env.NEXT_PUBLIC_FIREBASE_MEASUREMENT_ID ?? '',
};

const useAuthEmulator =
  process.env.NODE_ENV !== 'production' && process.env.NEXT_PUBLIC_USE_EMULATORS === 'true';
const authEmulatorUrl = useAuthEmulator
  ? (process.env.NEXT_PUBLIC_FIREBASE_AUTH_EMULATOR_URL ?? 'http://127.0.0.1:9099')
  : null;

await mkdir(outputDirectory, { recursive: true });
await build({
  entryPoints: [path.join(projectRoot, 'src/workers/firebase-auth-service-worker.ts')],
  outfile: outputFile,
  bundle: true,
  define: {
    __FIREBASE_AUTH_EMULATOR_URL__: JSON.stringify(authEmulatorUrl),
    __FIREBASE_CONFIG__: JSON.stringify(firebaseConfig),
  },
  format: 'iife',
  legalComments: 'none',
  logLevel: 'info',
  minify: process.env.NODE_ENV === 'production',
  platform: 'browser',
  sourcemap: process.env.NODE_ENV === 'production' ? false : 'inline',
  target: ['es2022'],
});
