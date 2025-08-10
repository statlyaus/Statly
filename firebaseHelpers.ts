import { initializeApp, cert, getApps } from 'firebase-admin/app';
import { getFirestore, type Firestore } from 'firebase-admin/firestore';
import type { ServiceAccount } from 'firebase-admin/app';

/**
 * Initializes a Firebase Admin app using the GOOGLE_SERVICE_ACCOUNT
 * environment variable. The variable should contain the raw JSON of a
 * service account. The initialized Firestore instance is memoised and
 * returned on subsequent calls.
 */
export function initFirebase(): Firestore {
  if (db) return db;

  const serviceAccountEnv = process.env.GOOGLE_SERVICE_ACCOUNT;
  if (!serviceAccountEnv) {
    throw new Error('Missing GOOGLE_SERVICE_ACCOUNT environment variable');
  }

  let serviceAccount: ServiceAccount;
  try {
    serviceAccount = JSON.parse(serviceAccountEnv) as ServiceAccount;
  } catch {
    throw new Error('Invalid GOOGLE_SERVICE_ACCOUNT JSON');
  }

  if (!getApps().length) {
    initializeApp({ credential: cert(serviceAccount) });
  }

  db = getFirestore();
  return db;
}

let db: Firestore | null = null;

export interface LeagueRequest {
  leagueId: string;
  status: string;
}

export async function loadUserSettings(uid: string): Promise<Record<string, unknown> | undefined> {
  const firestore = initFirebase();
  const doc = await firestore.collection('userSettings').doc(uid).get();
  return doc.exists ? (doc.data() as Record<string, unknown>) : undefined;
}

export async function saveUserSettings(uid: string, settings: Record<string, unknown>): Promise<void> {
  const firestore = initFirebase();
  await firestore.collection('userSettings').doc(uid).set(settings, { merge: true });
}

export async function loadUserLeagueRequests(uid: string): Promise<LeagueRequest[]> {
  const firestore = initFirebase();
  const doc = await firestore.collection('userLeagueRequests').doc(uid).get();
  return doc.exists ? ((doc.data()?.requests as LeagueRequest[]) || []) : [];
}

export async function saveUserLeagueRequests(uid: string, requests: LeagueRequest[]): Promise<void> {
  const firestore = initFirebase();
  await firestore
    .collection('userLeagueRequests')
    .doc(uid)
    .set({ requests }, { merge: true });
}
