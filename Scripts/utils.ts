import fs from 'fs/promises';
import { initializeApp, cert, getApps, ServiceAccount } from 'firebase-admin/app';
import { getFirestore, Firestore } from 'firebase-admin/firestore';
import { decodeServiceAccount } from '../src/lib/serviceAccount';

export async function readJsonFile<T>(path: string): Promise<T> {
  const raw = await fs.readFile(path, 'utf-8');
  return JSON.parse(raw) as T;
}

export function cleanName(name: string): string {
  return name.toLowerCase().replace(/\s+/g, ' ').trim();
}

export function initFirestore(): Firestore {
  if (!getApps().length) {
    const serviceAccountEnv = process.env.GOOGLE_SERVICE_ACCOUNT;
    if (!serviceAccountEnv) {
      throw new Error('Missing GOOGLE_SERVICE_ACCOUNT environment variable');
    }
    const serviceAccount = decodeServiceAccount(serviceAccountEnv);
    initializeApp({ credential: cert(serviceAccount) });
  }
  return getFirestore();
}

// Add logging utility
export function logProgress(message: string, type: 'info' | 'success' | 'warning' | 'error' = 'info') {
  const icons = { info: 'ℹ️', success: '✅', warning: '⚠️', error: '❌' };
  console.log(`${icons[type]} ${message}`);
}

// Add validation utility
export function validateRequiredArgs(args: string[], requiredCount: number, usage: string) {
  if (args.length < requiredCount + 2) { // +2 for node and script name
    console.error(`Usage: ${usage}`);
    process.exit(1);
  }
}
