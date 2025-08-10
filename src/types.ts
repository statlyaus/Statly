// src/types.ts

// Canonical Player
export interface Player {
  id: string;
  name: string;
  team?: string;             // make optional if some docs lack team
  position?: string;
  injury?: string;
  games?: number;
  summary?: Record<string, number>;
  stats?: Record<string, number | string>;
  avg?: number;

  // Optional detailed stats
  kicks?: number;
  handballs?: number;
  marks?: number;
  tackles?: number;
  goals?: number;
  hitouts?: number;
  clearances?: number;
  inside50s?: number;
  rebound50s?: number;
  contestedPossessions?: number;

  // Optional ranks (if present in data)
  kicks_rank?: number;
  handballs_rank?: number;
  marks_rank?: number;
  tackles_rank?: number;
  goals_rank?: number;
  hitouts_rank?: number;
  clearances_rank?: number;
  inside50s_rank?: number;
  rebound50s_rank?: number;
  contestedPossessions_rank?: number;
}

// Minimal Team shape used by MyTeamPanel
export interface Team {
  id: string;
  players?: Array<string | number>; // ids of players on the team
}

// (Optional) super‑light version used in some tables
export type PlayerLite = Pick<Player, 'id' | 'name' | 'team' | 'position'> & {
  [key: string]: unknown;
};