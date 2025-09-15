// types only: no runtime values

export type LegacyPlayerStat = {
  id: string;
  name: string;
  team: string;
  position: string;
  kicks: number;
  handballs: number;
  disposals: number;
  marks: number;
  tackles: number;
  goals: number;
  behinds: number;
  hitouts: number;
  clearances: number;
  inside50s: number;
  rebound50s: number;
  contested_possessions: number;
  uncontested_possessions: number;
  fantasyScore: number;
  round: number;
  season: number;
  lastUpdated: string;
  source: string;
};

export type LivePlayerDto = {
  playerId: string;
  stats: LegacyPlayerStat;
  lastSeenAt: string; // ISO
};

export type MatchDto = {
  matchId: string;
  round: number;
  status: 'scheduled' | 'in_progress' | 'final';
  homeTeamId: string;
  awayTeamId: string;
  startedAt?: string; // ISO
  updatedAt?: string; // ISO
};

