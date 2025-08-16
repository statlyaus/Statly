export interface Match {
  id: string;
  round: number;
  homeTeam: string;
  awayTeam: string;
  homeScore?: number;
  awayScore?: number;
  venue: string;
  date: string;
  status: 'scheduled' | 'live' | 'completed';
}

export interface MatchResult extends Match {
  homeScore: number;
  awayScore: number;
  winner?: string;
}

export interface LiveMatch extends Match {
  status: 'live';
  minute?: number;
  quarter?: number;
}
