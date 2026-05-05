import type { MatchLogStats as MatchLogStatLine } from '@/lib/matchLogs';

// Types for match log data used across components
export interface MatchLog {
  round: number;
  opponent: string;
  season?: number;
  matchId?: string;
  stats?: MatchLogStatLine;
  goals?: number;
  disposals?: number;
  marks?: number;
  tackles?: number;
  fantasyPoints?: number;
  matchDate?: string;
  venue?: string;
  result?: 'W' | 'L' | 'D';
  margin?: number;
  kickingAccuracy?: string;
  timeOnGround?: number;
  superCoachScore?: number;
  dreamTeamScore?: number;
  totalValue?: number;
  fantasyScore?: number; // For backward compatibility
}

// Legacy interface for chart compatibility
export interface MatchData {
  round: number;
  totalValue: number;
  opposition: string;
  fantasyScore?: number;
}

// Statistics calculation interface
export interface MatchLogStats {
  totalMatches: number;
  avgFantasyPoints: number;
  bestFantasyPoints: number;
  worstFantasyPoints: number;
  totalGoals: number;
  avgGoals: string;
  avgDisposals: number;
  wins: number;
  losses: number;
  draws: number;
}
