/**
 * Minimal, UI-focused DTO for roster players.
 * Keep this decoupled from Firestore schema so UI stays stable if backend evolves.
 */
import type { LegacyPlayerStat } from '@/types/fantasy';

// LivePlayerRow now extends the canonical LegacyPlayerStat, plus optional injury
export type LivePlayerRow = LegacyPlayerStat & {
  injury?: string;
};

export interface RosterTeamSummary {
  teamId: string;
  teamName?: string;
  playerCount: number;
}

export interface RosterListResponse {
  items: RosterTeamSummary[];
  nextCursor: string | null;
}

export interface RosterResponse {
  teamId: string;
  teamName?: string;
  players: LivePlayerRow[];
  updatedAt?: string | null;
}
