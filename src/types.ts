// src/types.ts

export interface Player {
  id: string;
  name: string;
  position: string;
  team: string;
  avg?: number;
  stats?: {
    fantasyPoints?: number;
  };
}

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