/**
 * Standings history: round-by-round results, ladder position after every completed round, form,
 * streaks and the finals line, built from a league's matchups. Pure, so the API and tests share it.
 */

import { simulateFinalsOdds, type FinalsOdds } from './finalsOdds';

export type { FinalsOdds };

export type ResultLetter = 'W' | 'L' | 'D';
export type StandingsMatchupStatus = 'SCHEDULED' | 'LIVE' | 'FINAL';

export interface StandingsMatchupInput {
  round: number;
  phase: 'REGULAR' | 'FINALS';
  status: StandingsMatchupStatus;
  homeMemberId: string | null;
  awayMemberId: string | null;
  byeMemberId: string | null;
  homeCategoryWins: number;
  awayCategoryWins: number;
  drawnCategories: number;
  winnerMemberId: string | null;
}

/** A ladder row, already in ladder order (see `buildLeagueStandings`). */
export interface StandingsLadderInput {
  memberId: string;
  teamName: string;
  teamLogoUrl: string | null;
  wins: number;
  losses: number;
  draws: number;
  categoryWins: number;
  categoryLosses: number;
  categoryDraws: number;
  draftSlot: number | null;
}

export interface TeamRoundResult {
  round: number;
  phase: 'REGULAR' | 'FINALS';
  status: StandingsMatchupStatus | 'BYE';
  opponentId: string | null;
  result: ResultLetter | null;
  categoriesFor: number;
  categoriesAgainst: number;
}

export interface StandingsTeam extends StandingsLadderInput {
  rank: number;
  /** Places gained (+) or lost (−) since the previous completed round; null before round 2. */
  movement: number | null;
  played: number;
  winPct: number | null;
  categoryWinPct: number | null;
  gamesBack: number;
  streak: { result: ResultLetter; count: number } | null;
  /** Last five completed results, oldest first. */
  form: ResultLetter[];
  bestRank: number | null;
  worstRank: number | null;
  /** This round's opponent while a round is live, otherwise the next scheduled one. */
  upcoming: { round: number; opponentId: string | null; status: StandingsMatchupStatus } | null;
  results: TeamRoundResult[];
  /** Ladder position after each completed regular-season round. */
  rankHistory: Array<{ round: number; rank: number }>;
  /** Finals chances from simulating the games still to play; null without finals. */
  finals: FinalsOdds | null;
}

export interface StandingsRound {
  round: number;
  phase: 'REGULAR' | 'FINALS';
  status: StandingsMatchupStatus;
}

export interface StandingsHistory {
  teams: StandingsTeam[];
  rounds: StandingsRound[];
  completedRounds: number[];
  liveRound: number | null;
  finalsTeams: number;
}

function resultFor(matchup: StandingsMatchupInput, memberId: string): ResultLetter | null {
  if (matchup.status !== 'FINAL') return null;
  if (matchup.winnerMemberId) return matchup.winnerMemberId === memberId ? 'W' : 'L';
  const isHome = matchup.homeMemberId === memberId;
  const mine = isHome ? matchup.homeCategoryWins : matchup.awayCategoryWins;
  const theirs = isHome ? matchup.awayCategoryWins : matchup.homeCategoryWins;
  return mine > theirs ? 'W' : mine < theirs ? 'L' : 'D';
}

function roundStatus(matchups: readonly StandingsMatchupInput[]): StandingsMatchupStatus {
  const played = matchups.filter((matchup) => matchup.homeMemberId && matchup.awayMemberId);
  if (played.length > 0 && played.every((matchup) => matchup.status === 'FINAL')) return 'FINAL';
  if (played.some((matchup) => matchup.status !== 'SCHEDULED')) return 'LIVE';
  return 'SCHEDULED';
}

function pct(numerator: number, denominator: number): number | null {
  return denominator > 0 ? numerator / denominator : null;
}

export function buildStandingsHistory({
  ladder,
  matchups,
  finalsTeams,
}: {
  ladder: readonly StandingsLadderInput[];
  matchups: readonly StandingsMatchupInput[];
  finalsTeams: number;
}): StandingsHistory {
  const byRound = new Map<number, StandingsMatchupInput[]>();
  for (const matchup of matchups) {
    byRound.set(matchup.round, [...(byRound.get(matchup.round) ?? []), matchup]);
  }
  const rounds: StandingsRound[] = [...byRound.entries()]
    .sort(([left], [right]) => left - right)
    .map(([round, roundMatchups]) => ({
      round,
      phase: roundMatchups.some((matchup) => matchup.phase === 'FINALS') ? 'FINALS' : 'REGULAR',
      status: roundStatus(roundMatchups),
    }));
  const completedRounds = rounds
    .filter((round) => round.phase === 'REGULAR' && round.status === 'FINAL')
    .map((round) => round.round);
  const liveRound = rounds.find((round) => round.status === 'LIVE')?.round ?? null;

  // Results per team, every round in order.
  const resultsByMember = new Map<string, TeamRoundResult[]>();
  for (const team of ladder) resultsByMember.set(team.memberId, []);
  for (const { round, phase } of rounds) {
    for (const matchup of byRound.get(round) ?? []) {
      if (matchup.byeMemberId && resultsByMember.has(matchup.byeMemberId)) {
        resultsByMember.get(matchup.byeMemberId)!.push({
          round,
          phase,
          status: 'BYE',
          opponentId: null,
          result: null,
          categoriesFor: 0,
          categoriesAgainst: 0,
        });
      }
      for (const side of ['home', 'away'] as const) {
        const memberId = side === 'home' ? matchup.homeMemberId : matchup.awayMemberId;
        if (!memberId || !resultsByMember.has(memberId)) continue;
        resultsByMember.get(memberId)!.push({
          round,
          phase,
          status: matchup.status,
          opponentId: side === 'home' ? matchup.awayMemberId : matchup.homeMemberId,
          result: resultFor(matchup, memberId),
          categoriesFor: side === 'home' ? matchup.homeCategoryWins : matchup.awayCategoryWins,
          categoriesAgainst: side === 'home' ? matchup.awayCategoryWins : matchup.homeCategoryWins,
        });
      }
    }
  }

  // Ladder position after each completed round. The latest completed round uses the official
  // ladder order, so the history always ends where the ladder is.
  const ladderIndex = new Map(ladder.map((team, index) => [team.memberId, index]));
  const rankHistory = new Map<string, Array<{ round: number; rank: number }>>();
  for (const team of ladder) rankHistory.set(team.memberId, []);
  completedRounds.forEach((completedRound, index) => {
    const isLatest = index === completedRounds.length - 1;
    const order = [...ladder].sort((left, right) => {
      if (isLatest) return ladderIndex.get(left.memberId)! - ladderIndex.get(right.memberId)!;
      const tally = (memberId: string) => {
        const record = { wins: 0, losses: 0, draws: 0, categoryDiff: 0 };
        for (const result of resultsByMember.get(memberId) ?? []) {
          if (result.phase !== 'REGULAR' || result.round > completedRound || !result.result)
            continue;
          if (result.result === 'W') record.wins += 1;
          else if (result.result === 'L') record.losses += 1;
          else record.draws += 1;
          record.categoryDiff += result.categoriesFor - result.categoriesAgainst;
        }
        return record;
      };
      const a = tally(left.memberId);
      const b = tally(right.memberId);
      return (
        b.wins - a.wins ||
        a.losses - b.losses ||
        b.draws - a.draws ||
        b.categoryDiff - a.categoryDiff ||
        (left.draftSlot ?? Number.MAX_SAFE_INTEGER) -
          (right.draftSlot ?? Number.MAX_SAFE_INTEGER) ||
        left.teamName.localeCompare(right.teamName)
      );
    });
    order.forEach((team, position) => {
      rankHistory.get(team.memberId)!.push({ round: completedRound, rank: position + 1 });
    });
  });

  const leader = ladder[0];
  const teams: StandingsTeam[] = ladder.map((team, index) => {
    const results = resultsByMember.get(team.memberId) ?? [];
    const completed = results.filter(
      (result): result is TeamRoundResult & { result: ResultLetter } => result.result !== null
    );
    let streak: StandingsTeam['streak'] = null;
    for (const result of [...completed].reverse()) {
      if (!streak) streak = { result: result.result, count: 1 };
      else if (streak.result === result.result) streak.count += 1;
      else break;
    }
    const history = rankHistory.get(team.memberId) ?? [];
    const previous = history.length >= 2 ? history[history.length - 2].rank : null;
    const played = team.wins + team.losses + team.draws;
    const categoriesPlayed = team.categoryWins + team.categoryLosses + team.categoryDraws;
    const upcomingResult =
      results.find((result) => result.status === 'LIVE') ??
      results.find((result) => result.status === 'SCHEDULED');
    return {
      ...team,
      rank: index + 1,
      movement: previous === null ? null : previous - (index + 1),
      played,
      winPct: pct(team.wins + team.draws / 2, played),
      categoryWinPct: pct(team.categoryWins + team.categoryDraws / 2, categoriesPlayed),
      gamesBack: leader ? (leader.wins - team.wins + (team.losses - leader.losses)) / 2 : 0,
      streak,
      form: completed.slice(-5).map((result) => result.result),
      bestRank: history.length ? Math.min(...history.map((entry) => entry.rank)) : null,
      worstRank: history.length ? Math.max(...history.map((entry) => entry.rank)) : null,
      upcoming: upcomingResult
        ? {
            round: upcomingResult.round,
            opponentId: upcomingResult.opponentId,
            status: upcomingResult.status as StandingsMatchupStatus,
          }
        : null,
      results,
      rankHistory: history,
      finals: null,
    };
  });

  const clampedFinalsTeams = Math.min(Math.max(0, finalsTeams), ladder.length);
  const odds = simulateFinalsOdds({ teams, finalsTeams: clampedFinalsTeams });
  for (const team of teams) team.finals = odds.get(team.memberId) ?? null;

  return {
    teams,
    rounds,
    completedRounds,
    liveRound,
    finalsTeams: clampedFinalsTeams,
  };
}
