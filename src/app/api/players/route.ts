// src/app/api/players/route.ts
import { adminDb } from '@/lib/firebaseAdmin';
import { NextResponse } from 'next/server';
import type { QueryDocumentSnapshot, DocumentData } from 'firebase-admin/firestore';

export async function GET() {
  const snapshot = await adminDb.collection('players').get();
  const players = snapshot.docs.map((doc: QueryDocumentSnapshot<DocumentData>) => ({
    id: doc.id,
    ...doc.data(),
  }));
  return NextResponse.json(players);
}
