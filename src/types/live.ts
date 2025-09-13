/**
 * Minimal, UI-focused DTO for roster players.
 * Keep this decoupled from Firestore schema so UI stays stable if backend evolves.
 */
export interface LivePlayerRow {
  id: string;
  name: string;
  team?: string;
  position?: string;
  injury?: string;
}

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
