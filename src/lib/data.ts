// src/lib/data.ts
import 'server-only';
import { adminDb } from '@/lib/firebaseAdmin';
import type { Player } from '@/types';

/**
 * Fetches all players from the Firestore database.
 * Server-only.
 */
export async function getPlayers(): Promise<Player[]> {
  try {
    const snap = await adminDb.collection('players').get();
    if (snap.empty) return [];
    const players = snap.docs.map(d => ({ id: d.id, ...d.data() })) as Player[];
    // stable, case-insensitive sort by name
    return players.sort((a, b) => (a.name ?? '').localeCompare(b.name ?? '', undefined, { sensitivity: 'base' }));
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    throw new Error(`getPlayers failed (server Firestore): ${msg}`);
  }
}

/**
 * Fetch a single player by id. Server-only.
 */
export async function getPlayer(id: string): Promise<Player | null> {
  try {
    const doc = await adminDb.collection('players').doc(id).get();
    if (!doc.exists) return null;
    return { id: doc.id, ...(doc.data() as Omit<Player, 'id'>) };
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    throw new Error(`getPlayer(${id}) failed: ${msg}`);
  }
}

/**
 * Fetch all player IDs for static generation. Server-only.
 */
export async function getPlayerIds(): Promise<{ id: string }[]> {
  try {
    const snap = await adminDb.collection('players').select().get();
    return snap.docs.map(d => ({ id: d.id }));
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    throw new Error(`getPlayerIds failed: ${msg}`);
  }
}