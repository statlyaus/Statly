import type { CategoryResult } from '@/components/scores/MatchupScore';
import type { LeagueStandingsHistory } from '@/server/leagues/standingsHistoryLoader';
import type {
  ResultLetter,
  StandingsTeam,
  TeamRoundResult,
} from '@/server/leagues/standingsHistory';

export type StandingsData = LeagueStandingsHistory & { viewerMemberId: string | null };
export type { ResultLetter, StandingsTeam, TeamRoundResult };

export const RESULT_TO_CHIP: Record<ResultLetter, CategoryResult> = {
  W: 'won',
  L: 'lost',
  D: 'drawn',
};

export const RESULT_WORD: Record<ResultLetter, string> = { W: 'won', L: 'lost', D: 'drew' };

/** ".750" style, as ladders print it. */
export function formatPct(value: number | null): string {
  if (value === null) return '–';
  if (value >= 1) return '1.000';
  return value.toFixed(3).replace(/^0/, '');
}

export function formatGamesBack(value: number): string {
  if (value <= 0) return '–';
  return Number.isInteger(value) ? String(value) : value.toFixed(1);
}

export function formatRecord(wins: number, losses: number, draws: number): string {
  return `${wins}–${losses}${draws ? `–${draws}` : ''}`;
}

export function formatStreak(streak: StandingsTeam['streak']): string {
  return streak ? `${streak.result}${streak.count}` : '–';
}

/** Streaks sort wins high, losses low. */
export function streakValue(streak: StandingsTeam['streak']): number {
  if (!streak) return 0;
  return streak.result === 'W' ? streak.count : streak.result === 'L' ? -streak.count : 0;
}

export function matchCentreHref(leagueId: string, round: number): string {
  return `/leagues/${encodeURIComponent(leagueId)}?tab=matchups&round=${round}`;
}

/** "won 6–3 v Hard Ball Gets", "live 3–2 v …", "bye". */
export function describeResult(result: TeamRoundResult, opponentName: string | null): string {
  if (result.status === 'BYE') return 'bye';
  const versus = opponentName ? ` v ${opponentName}` : '';
  const score = `${result.categoriesFor}–${result.categoriesAgainst}`;
  if (result.result) return `${RESULT_WORD[result.result]} ${score}${versus}`;
  if (result.status === 'LIVE') return `live ${score}${versus}`;
  return `plays${versus || ' opponent to be confirmed'}`;
}
