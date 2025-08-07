import { adminDb } from '@/lib/firebaseAdmin';
import type { Player } from '@/types';

/**
 * Fetches all players from the Firestore database.
 * This function is intended to be used on the server side.
 * @returns A promise that resolves to an array of players.
 */
export async function getPlayers(): Promise<Player[]> {
  if (!adminDb) {
    console.error('Firebase Admin DB is not initialized.');
    throw new Error('Database connection is not available.');
  }

  const playersSnapshot = await adminDb.collection('players').get();
  if (playersSnapshot.empty) {
    return [];
  }

  const players = playersSnapshot.docs.map((doc) => ({ id: doc.id, ...doc.data() })) as Player[];
  return players.sort((a, b) => (a.name > b.name ? 1 : -1));
}