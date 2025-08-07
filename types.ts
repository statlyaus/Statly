/**
 * Represents a player in the system.
 * This is the canonical type definition for a player object.
 */
export interface Player {
  id: string;
  name: string;
  team: string;
  position?: string;
  stats?: Record<string, number | string>;
  avg?: number;
  // Individual stats for easier access if needed
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
  // Rank properties from mock data
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