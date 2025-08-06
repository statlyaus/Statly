// src/types.ts

export type Player = {
  id: number;
  name: string;
  team?: string;
  position: string;
  avg?: number;

  kicks?: number;
  kicks_rank?: number;
  handballs?: number;
  handballs_rank?: number;
  marks?: number;
  marks_rank?: number;
  tackles?: number;
  tackles_rank?: number;
  goals?: number;
  goals_rank?: number;
  hitouts?: number;
  hitouts_rank?: number;
  clearances?: number;
  clearances_rank?: number;
  inside50s?: number;
  inside50s_rank?: number;
  rebound50s?: number;
  rebound50s_rank?: number;
  contestedPossessions?: number;
  contestedPossessions_rank?: number;
};

export interface LeagueStanding {
  rank: number;
  teamName: string;
  wins: number;
  losses: number;
  ties: number;
  percentage: number;
  gamesBehind: string;
  userId?: string;
}

export interface RecentActivity {
  date: string;
  type: 'Added' | 'Dropped' | 'Trade' | 'Waiver';
  team: string;
  player: string;
  details?: string;
}

export interface PlayerNews {
  player: string;
  news: string;
  severity: 'low' | 'medium' | 'high';
  date: string;
}