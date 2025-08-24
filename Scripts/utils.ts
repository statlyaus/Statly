import fs from 'fs/promises';
// Reuse shared Admin initialization and dotenv loader
import '../src/lib/loadEnv';
import { adminDb } from '../src/lib/firebaseAdmin';

export async function readJsonFile<T>(path: string): Promise<T> {
  const raw = await fs.readFile(path, 'utf-8');
  return JSON.parse(raw) as T;
}

export function cleanName(name: string): string {
  return name.toLowerCase().replace(/\s+/g, ' ').trim();
}

// Return the shared Firestore instance from Firebase Admin
export function initFirestore() {
  return adminDb;
}

// Add logging utility
export function logProgress(message: string, type: 'info' | 'success' | 'warning' | 'error' = 'info') {
  const icons = { info: 'ℹ️', success: '✅', warning: '⚠️', error: '❌' } as const;
  console.log(`${icons[type]} ${message}`);
}

// Add validation utility
export function validateRequiredArgs(args: string[], requiredCount: number, usage: string) {
  if (args.length < requiredCount + 2) {
    // +2 for node and script name
    console.error(`Usage: ${usage}`);
    process.exit(1);
  }
}
