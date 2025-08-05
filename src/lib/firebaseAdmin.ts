import { cert, getApps, initializeApp } from 'firebase-admin/app';
import { getFirestore } from 'firebase-admin/firestore';
import { readFileSync } from 'fs';
import path from 'path';

const serviceAccountPath = path.join(process.cwd(), 'src/lib/serviceAccountKey.json');
const serviceAccount = JSON.parse(readFileSync(serviceAccountPath, 'utf8'));

const app = getApps().length === 0
  ? initializeApp({ credential: cert(serviceAccount) })
  : undefined;

export const adminDb = getFirestore();