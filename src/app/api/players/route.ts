import { NextResponse } from 'next/server';
import type { Player } from '@/types';
import { db } from '@/lib/firebaseClient';
import { collection, getDocs } from 'firebase/firestore';

export async function GET() {
  try {
    const playersCollection = collection(db, 'players');
    const playerSnapshot = await getDocs(playersCollection);
    const playersList = playerSnapshot.docs.map((doc) => ({
      id: doc.id,
      ...doc.data(),
    })) as Player[];

    // Sort by average points descending (if avg exists)
    playersList.sort((a, b) => (b.avg || 0) - (a.avg || 0));

    return NextResponse.json(playersList);
  } catch (error) {
    console.error('Error fetching players from Firestore:', error);
    return NextResponse.json({ error: 'Failed to fetch player data' }, { status: 500 });
  }
}