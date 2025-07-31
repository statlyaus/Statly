// src/app/api/players/route.ts
import { NextResponse } from 'next/server';
import { getFirestore } from 'firebase-admin/firestore';
import { getApps, initializeApp, cert, ServiceAccount } from 'firebase-admin/app';
// @ts-ignore
import serviceAccount from '@/serviceAccountKey.json';

if (!getApps().length) {
  initializeApp({
    credential: cert(serviceAccount as ServiceAccount),
  });
}

const db = getFirestore();

export async function GET() {
  const snapshot = await db.collection('players').get();
  const players = snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() }));
  return NextResponse.json(players);
}