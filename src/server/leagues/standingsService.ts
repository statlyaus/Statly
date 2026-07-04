import type { LeagueScoringMode } from './scoringTypes';

export interface FinalizedScoreInput {
  matchupId: string;
  memberId: string;
  categoryWins: number;
  categoryLosses: number;
  categoryDraws: number;
  matchupWin: boolean;
  matchupLoss: boolean;
  matchupDraw: boolean;
  pointsFor: number;
  pointsAgainst: number;
}

export interface CalculateStandingsInput {
  scoringMode: LeagueScoringMode;
  memberIds: readonly string[];
  finalizedScores: readonly FinalizedScoreInput[];
}

export interface StandingRow {
  memberId: string;
  wins: number;
  losses: number;
  draws: number;
  categoryWins: number;
  categoryLosses: number;
  categoryDraws: number;
  pointsFor: number;
  pointsAgainst: number;
}

export function calculateStandingsRows(input: CalculateStandingsInput): StandingRow[] {
  const rows = new Map<string, StandingRow>();
  for (const memberId of input.memberIds) {
    rows.set(memberId, {
      memberId,
      wins: 0,
      losses: 0,
      draws: 0,
      categoryWins: 0,
      categoryLosses: 0,
      categoryDraws: 0,
      pointsFor: 0,
      pointsAgainst: 0,
    });
  }

  for (const score of input.finalizedScores) {
    const row = rows.get(score.memberId);
    if (!row) continue;

    row.categoryWins += score.categoryWins;
    row.categoryLosses += score.categoryLosses;
    row.categoryDraws += score.categoryDraws;
    row.pointsFor += score.pointsFor;
    row.pointsAgainst += score.pointsAgainst;

    if (input.scoringMode === 'H2H_EACH_CATEGORY') {
      row.wins += score.categoryWins;
      row.losses += score.categoryLosses;
      row.draws += score.categoryDraws;
    } else {
      if (score.matchupWin) row.wins += 1;
      if (score.matchupLoss) row.losses += 1;
      if (score.matchupDraw) row.draws += 1;
    }
  }

  return [...rows.values()].sort(
    (a, b) =>
      b.wins - a.wins ||
      a.losses - b.losses ||
      b.categoryWins - a.categoryWins ||
      b.pointsFor - a.pointsFor ||
      a.memberId.localeCompare(b.memberId)
  );
}
