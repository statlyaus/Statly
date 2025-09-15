import type { Timestamp as ClientTimestamp } from 'firebase/firestore';
import type { Timestamp as AdminTimestamp } from 'firebase-admin/firestore';

/**
 * Shared Firebase timestamp type that can handle both client-side and server-side timestamps
 */
export type FirebaseTimestamp = ClientTimestamp | AdminTimestamp | Date;

// Minimal scaffolds for upcoming strict typing
export type PlayerProfile = {
  id: string;
  displayName: string;
  team?: string;
  position?: string;
  updatedAt?: FirebaseTimestamp;
};

export type MatchDocMeta = {
  id: string; // leagueId or matchId depending on collection
  round: number;
  createdAt?: FirebaseTimestamp;
  updatedAt?: FirebaseTimestamp;
};
