// src/app/api/players/route.ts
import { initializeApp, cert, getApps } from 'firebase-admin/app';
import { getFirestore } from 'firebase-admin/firestore';
import { NextRequest, NextResponse } from 'next/server';
import { readFileSync } from 'fs';
import { join } from 'path';

const serviceAccount = JSON.parse(
  readFileSync(join(process.cwd(), 'serviceAccountKey.json'), 'utf8')
);

if (!getApps().length) {
  initializeApp({ credential: cert(serviceAccount as any) });
}

const db = getFirestore();

export async function GET(req: NextRequest) {
  try {
    const snapshot = await db.collection('players').get();

    const players = snapshot.docs.map((doc) => {
      const data = doc.data();
      // Ensure id is a string and name is present
      return {
        ...data,
        id: String(doc.id),
        name: data.name || (data.matchLogs?.[0]?.Player ?? ""),
      };
    });

    // Set CORS headers
    return NextResponse.json(players, {
      headers: {
        'Access-Control-Allow-Origin': '*', // Or restrict to your frontend origin
        'Access-Control-Allow-Methods': 'GET,OPTIONS',
        'Access-Control-Allow-Headers': 'Content-Type',
      },
    });
  } catch (error) {
    console.error('🔥 Error fetching players:', error);
    return new NextResponse('Failed to fetch players', { status: 500 });
  }
}