// src/app/api/players/route.ts
import { db } from '@/lib/firebaseAdmin';
import { NextResponse } from 'next/server';

export async function GET() {
  const snapshot = await db.collection('players').get();
  const players = snapshot.docs.map((doc) => ({ id: doc.id, ...doc.data() }));
  return NextResponse.json(players);
}
