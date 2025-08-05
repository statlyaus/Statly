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

export const mockStandings: Omit<LeagueStanding, 'userId'>[] = [
  {
    rank: 1,
    teamName: "Matthew's Monstrous Team",
    wins: 14,
    losses: 3,
    ties: 1,
    percentage: 0.806,
    gamesBehind: '--',
  },
  {
    rank: 2,
    teamName: "Ronnie's Rowdy Team",
    wins: 13,
    losses: 5,
    ties: 0,
    percentage: 0.722,
    gamesBehind: '1.5',
  },
  {
    rank: 3,
    teamName: "Bambang's Best Team",
    wins: 11,
    losses: 6,
    ties: 1,
    percentage: 0.639,
    gamesBehind: '3.0',
  },
  {
    rank: 4,
    teamName: "Michael's Magnificent Team",
    wins: 10,
    losses: 8,
    ties: 0,
    percentage: 0.556,
    gamesBehind: '4.5',
  },
];

export const mockRecentActivity: RecentActivity[] = [
  { date: 'Wed Jul 24', type: 'Added', team: "Matthew's Team", player: 'Nick Daicos', details: 'Waiver claim' },
  { date: 'Tue Jul 23', type: 'Trade', team: "Ronnie's Team", player: 'Marcus Bontempelli', details: 'for Max Gawn + picks' },
  { date: 'Tue Jul 23', type: 'Dropped', team: "Michael's Team", player: 'Tom Hawkins', details: 'Injury concerns' },
];

export const mockPlayerNews: PlayerNews[] = [
  {
    player: 'Nick Daicos',
    news: 'Expected to return after minor calf tightness. Will undergo fitness test Friday.',
    severity: 'medium',
    date: 'Jul 24',
  },
  {
    player: 'Marcus Bontempelli',
    news: 'Dominated in training and is likely to play more midfield minutes.',
    severity: 'low',
    date: 'Jul 24',
  },
  {
    player: 'Max Gawn',
    news: 'Managing workload after minor soreness, expected to play Round 19.',
    severity: 'medium',
    date: 'Jul 23',
  },
];