import { adminDb } from '@/lib/firebaseAdmin';
import type { Player } from '@/types';
import type { QueryDocumentSnapshot } from 'firebase-admin/firestore';

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

/**
 * Fetches a single player by their ID from the Firestore database.
 * This function is intended to be used on the server side.
 * @param id The ID of the player to fetch.
 * @returns A promise that resolves to the player object or null if not found.
 */
export async function getPlayer(id: string): Promise<Player | null> {
  if (!adminDb) {
    console.error('Firebase Admin DB is not initialized. Check server logs.');
    return null;
  }
  const playerRef = adminDb.collection('players').doc(id);
  const doc = await playerRef.get();

  if (!doc.exists) {
    return null;
  }
  return { id: doc.id, ...(doc.data() as Omit<Player, 'id'>) };
}

/**
 * Fetches all player IDs from the Firestore database for static generation.
 * @returns A promise that resolves to an array of player ID objects.
 */
export async function getPlayerIds(): Promise<{ id: string }[]> {
  if (!adminDb) {
    console.error('Firebase Admin DB is not initialized. Cannot generate static params.');
    return [];
  }
  const playersSnapshot = await adminDb.collection('players').select().get();
  return playersSnapshot.docs.map((doc: QueryDocumentSnapshot) => ({ id: doc.id }));
}