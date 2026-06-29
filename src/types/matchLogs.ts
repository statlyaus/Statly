// Types for match log data used across components
export interface MatchLog {
  season?: number;
  round: number;
  opponent: string;
  goals?: number;
  disposals?: number;
  marks?: number;
  tackles?: number;
  clearances?: number;
  inside50s?: number;
  rebound50s?: number;
  hitouts?: number;
  intercepts?: number;
  goalAssists?: number;
  scoreInvolvements?: number;
  effectiveDisposals?: number;
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
  season?: number;
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
