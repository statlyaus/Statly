import { FANTASY_CATEGORIES } from '@/types/fantasyCategories';

import {
  isCountedSlot,
  type CategoryTotals,
  type LineupScoringPlayer,
} from './matchupScoringEngine';

/**
 * The No Losers result rule (epic #1290, BR-10 to BR-17): a counted player's stats are multiplied
 * by his club's result in the match his stat row belongs to. WIN 1, DRAW 0.5, LOSS by 1 to 5
 * points 0.5, LOSS by 6 or more 0, ABANDONED 1. Pure: no database access, no scoring side effects.
 * Stored on every score computed with it (BR-21), so bump it whenever the rule changes.
 */
export const NO_LOSERS_RESULT_RULE_VERSION = 'no-losers-result-rule/v1';

/** A loss by this many points or fewer (under a goal) counts half (BR-14). */
const CLOSE_LOSS_MAX_MARGIN = 5;

/** An official AFL match result, keyed by its Statly match id (`matchUid`, BR-07). */
export interface NoLosersMatchResult {
  homeClub: string;
  awayClub: string;
  homePoints: number;
  awayPoints: number;
  status: 'FINAL' | 'ABANDONED';
}

export interface NoLosersLineupPlayer extends LineupScoringPlayer {
  /** The Statly match id (`matchUid`) of the player's stat row; null when he has no stat row. */
  matchId: string | null;
  /**
   * The club of the player's stat row (his club in that match, not his current club), spelled
   * exactly as the result's `homeClub`/`awayClub` store it. Any other spelling resolves to
   * CLUB_NOT_IN_MATCH: the rule never guesses which side he played for. Callers resolve it by club
   * abbreviation (`noLosersScoring.ts`), never from the provider's spelling (BR-07).
   */
  club: string;
}

export type NoLosersMultiplier = 1 | 0.5 | 0;

export type NoLosersPlayerOutcome =
  /** Bench or interchange: never counted, so the rule does not touch it (BR-17). */
  | { kind: 'NOT_COUNTED_SLOT' }
  /** No stat row: unavailable exactly as without the rule (#1270); nothing to multiply. */
  | { kind: 'NO_STAT_ROW' }
  | {
      kind: 'RESULT';
      clubResult: 'WIN' | 'DRAW' | 'LOSS' | 'ABANDONED';
      /** The club's points minus the opponent's; null for an abandoned game. */
      margin: number | null;
      multiplier: NoLosersMultiplier;
    }
  /** The result cannot be resolved. Never guessed as a win or a loss (BR-08). */
  | {
      kind: 'UNAVAILABLE';
      reason: 'RESULT_MISSING' | 'CLUB_NOT_IN_MATCH' | 'STATS_WITHOUT_MATCH';
    };

export interface NoLosersScoredPlayer {
  playerId: string;
  slot: NoLosersLineupPlayer['slot'];
  outcome: NoLosersPlayerOutcome;
  rawTotals: CategoryTotals;
  /** The totals that count for the fantasy team; null while the outcome is UNAVAILABLE. */
  countedTotals: CategoryTotals | null;
}

export interface NoLosersResultRuleOutput {
  ruleVersion: typeof NO_LOSERS_RESULT_RULE_VERSION;
  players: NoLosersScoredPlayer[];
  /** Counted players whose result is unavailable; the lineup cannot be scored until it is empty. */
  unavailablePlayerIds: string[];
}

export interface ApplyNoLosersResultRuleInput {
  players: readonly NoLosersLineupPlayer[];
  /** Official results by Statly match id (`matchUid`). */
  results: ReadonlyMap<string, NoLosersMatchResult>;
}

function hasStats(totals: CategoryTotals): boolean {
  return Object.values(totals).some((value) => typeof value === 'number');
}

function resolveOutcome(
  player: NoLosersLineupPlayer,
  results: ApplyNoLosersResultRuleInput['results']
): NoLosersPlayerOutcome {
  if (!isCountedSlot(player.slot)) return { kind: 'NOT_COUNTED_SLOT' };
  if (player.matchId === null) {
    return hasStats(player.totals)
      ? { kind: 'UNAVAILABLE', reason: 'STATS_WITHOUT_MATCH' }
      : { kind: 'NO_STAT_ROW' };
  }
  const result = results.get(player.matchId);
  if (!result) return { kind: 'UNAVAILABLE', reason: 'RESULT_MISSING' };

  const isHome = player.club === result.homeClub;
  if (!isHome && player.club !== result.awayClub) {
    return { kind: 'UNAVAILABLE', reason: 'CLUB_NOT_IN_MATCH' };
  }
  if (result.status === 'ABANDONED') {
    return { kind: 'RESULT', clubResult: 'ABANDONED', margin: null, multiplier: 1 };
  }

  const margin = isHome
    ? result.homePoints - result.awayPoints
    : result.awayPoints - result.homePoints;
  if (margin > 0) return { kind: 'RESULT', clubResult: 'WIN', margin, multiplier: 1 };
  if (margin === 0) return { kind: 'RESULT', clubResult: 'DRAW', margin, multiplier: 0.5 };
  return {
    kind: 'RESULT',
    clubResult: 'LOSS',
    margin,
    multiplier: -margin <= CLOSE_LOSS_MAX_MARGIN ? 0.5 : 0,
  };
}

/**
 * Every count, high-wins and low-wins alike (BR-11), and both ratio inputs (effective disposals
 * and disposals, BR-12) are multiplied. A ratio category's own per-player value is a rate, not a
 * count, so it is copied unchanged: the team ratio is recomputed from the multiplied inputs by
 * `aggregateLineupCategoryTotals`. An absent value stays absent (#1270).
 */
function multiplyTotals(totals: CategoryTotals, multiplier: NoLosersMultiplier): CategoryTotals {
  const counted: CategoryTotals = {};
  for (const [key, value] of Object.entries(totals) as [
    keyof CategoryTotals,
    number | undefined,
  ][]) {
    if (value === undefined) continue;
    const category = (FANTASY_CATEGORIES as Partial<typeof FANTASY_CATEGORIES>)[
      key as keyof typeof FANTASY_CATEGORIES
    ];
    const isRate = category?.aggregation?.kind === 'ratio';
    counted[key] = isRate ? value : value * multiplier;
  }
  return counted;
}

export function applyNoLosersResultRule(
  input: ApplyNoLosersResultRuleInput
): NoLosersResultRuleOutput {
  const players = input.players.map((player): NoLosersScoredPlayer => {
    const outcome = resolveOutcome(player, input.results);
    const countedTotals =
      outcome.kind === 'UNAVAILABLE'
        ? null
        : outcome.kind === 'RESULT'
          ? multiplyTotals(player.totals, outcome.multiplier)
          : player.totals;
    return {
      playerId: player.playerId,
      slot: player.slot,
      outcome,
      rawTotals: player.totals,
      countedTotals,
    };
  });

  return {
    ruleVersion: NO_LOSERS_RESULT_RULE_VERSION,
    players,
    unavailablePlayerIds: players
      .filter((player) => player.outcome.kind === 'UNAVAILABLE')
      .map((player) => player.playerId),
  };
}

/**
 * The lineup with counted totals, ready for `aggregateLineupCategoryTotals`; null while any
 * counted player's result is unavailable, so a caller cannot score on a guess.
 */
export function countedLineupPlayers(
  output: NoLosersResultRuleOutput
): LineupScoringPlayer[] | null {
  if (output.unavailablePlayerIds.length > 0) return null;
  return output.players.map((player) => ({
    playerId: player.playerId,
    slot: player.slot,
    totals: player.countedTotals ?? {},
  }));
}
