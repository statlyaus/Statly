import 'server-only';

import type { Prisma, PrismaClient } from '@prisma/client';

import { prisma } from '@/lib/prisma';
import { getTeamName } from '@/lib/teamLogos';

import type { NormalizedLiveStatRow, RawRoundMatch } from './liveStatsAdapter';
import type { LineupScoringPlayer } from './matchupScoringEngine';
import {
  applyNoLosersResultRule,
  countedLineupPlayers,
  type NoLosersMatchResult,
  type NoLosersResultRuleOutput,
  type NoLosersScoredPlayer,
} from './noLosersResultRule';

/**
 * Wires the No Losers result rule (`noLosersResultRule.ts`) into live and final scoring (#1294,
 * epic #1290 BR-07, BR-08, BR-20, BR-21). The join is by the Statly match id (`matchUid`, e.g.
 * `2025-R18-GEE-HAW`), which stat rows and `AflMatchResult` both carry; the player's side is found
 * by his stat row's club abbreviation against the two in `matchUid`, and the rule is then given the
 * result's own club name. The provider's club spelling is never used.
 */

/** A stored, current (`supersededById IS NULL`) official result. */
export interface StoredAflMatchResult {
  id: string;
  matchUid: string;
  homeClub: string;
  awayClub: string;
  homePoints: number | null;
  awayPoints: number | null;
  status: 'FINAL' | 'ABANDONED';
}

export interface NoLosersRoundGame {
  matchUid: string;
  /** "Geelong v Hawthorn", from the fixture. */
  label: string;
  finished: boolean;
}

export interface NoLosersRoundContext {
  /** Current results by matchUid. */
  results: ReadonlyMap<string, StoredAflMatchResult>;
  /** The match and club abbreviation of each player's stat row, by Statly player id. */
  statRowByPlayerId: ReadonlyMap<string, { matchUid: string | null; teamAbbr: string | null }>;
  games: readonly NoLosersRoundGame[];
}

/** The two club abbreviations of a Statly match id: `2025-R18-GEE-HAW` is GEE (home) v HAW. */
export function matchUidClubAbbreviations(matchUid: string): { home: string; away: string } | null {
  const parts = matchUid.split('-');
  if (parts.length < 4) return null;
  return {
    home: parts[parts.length - 2].toUpperCase(),
    away: parts[parts.length - 1].toUpperCase(),
  };
}

/**
 * BR-07: the result's own club name for the side the stat row's abbreviation names, or '' (which
 * the rule refuses as CLUB_NOT_IN_MATCH) when it names neither side.
 */
export function resolveResultClub(
  teamAbbr: string | null,
  result: Pick<StoredAflMatchResult, 'matchUid' | 'homeClub' | 'awayClub'>
): string {
  const abbreviations = matchUidClubAbbreviations(result.matchUid);
  const abbr = teamAbbr?.trim().toUpperCase();
  if (!abbreviations || !abbr) return '';
  if (abbr === abbreviations.home) return result.homeClub;
  if (abbr === abbreviations.away) return result.awayClub;
  return '';
}

function toRuleResult(result: StoredAflMatchResult): NoLosersMatchResult {
  return {
    homeClub: result.homeClub,
    awayClub: result.awayClub,
    // An abandoned game has no points; the rule counts it in full without reading them.
    homePoints: result.homePoints ?? 0,
    awayPoints: result.awayPoints ?? 0,
    status: result.status,
  };
}

export function buildNoLosersRoundContext({
  results,
  statRows,
  matches,
}: {
  results: readonly StoredAflMatchResult[];
  statRows: readonly Pick<NormalizedLiveStatRow, 'playerId' | 'matchId' | 'teamAbbr'>[];
  matches: readonly RawRoundMatch[];
}): NoLosersRoundContext {
  const statRowByPlayerId = new Map(
    statRows.map((row) => [row.playerId, { matchUid: row.matchId, teamAbbr: row.teamAbbr }])
  );
  const matchUidsWithStats = new Set(statRows.flatMap((row) => (row.matchId ? [row.matchId] : [])));
  const games = matches.flatMap((match): NoLosersRoundGame[] => {
    const matchUid = typeof match.match_uid === 'string' ? match.match_uid : null;
    if (!matchUid) return [];
    const club = (value: unknown) => (typeof value === 'string' ? getTeamName(value) : '?');
    const status = typeof match.status === 'string' ? match.status.toLowerCase() : '';
    return [
      {
        matchUid,
        label: `${club(match.home_team)} v ${club(match.away_team)}`,
        // Footywire posts stats only for finished games, so a stat row also proves it finished.
        finished:
          ['final', 'completed', 'complete'].includes(status) || matchUidsWithStats.has(matchUid),
      },
    ];
  });
  return {
    results: new Map(results.map((result) => [result.matchUid, result])),
    statRowByPlayerId,
    games,
  };
}

/** Current results for the round's games and every match a stat row names, one query. */
export async function loadNoLosersRoundContext(
  input: {
    season: number;
    statRows: readonly Pick<NormalizedLiveStatRow, 'playerId' | 'matchId' | 'teamAbbr'>[];
    matches: readonly RawRoundMatch[];
  },
  client: Pick<PrismaClient, 'aflMatchResult'> = prisma
): Promise<NoLosersRoundContext> {
  const matchUids = [
    ...new Set([
      ...input.matches.flatMap((match) =>
        typeof match.match_uid === 'string' ? [match.match_uid] : []
      ),
      ...input.statRows.flatMap((row) => (row.matchId ? [row.matchId] : [])),
    ]),
  ];
  const results =
    matchUids.length > 0
      ? await client.aflMatchResult.findMany({
          where: { season: input.season, supersededById: null, matchUid: { in: matchUids } },
          select: {
            id: true,
            matchUid: true,
            homeClub: true,
            awayClub: true,
            homePoints: true,
            awayPoints: true,
            status: true,
          },
        })
      : [];
  return buildNoLosersRoundContext({ results, statRows: input.statRows, matches: input.matches });
}

export interface NoLosersLineupScore {
  rule: NoLosersResultRuleOutput;
  /**
   * The lineup to aggregate: counted totals, or (while any counted player's result is unavailable)
   * counted where known and raw for the rest, a provisional total (BR-20) that can never be FINAL.
   */
  players: LineupScoringPlayer[];
}

export function scoreNoLosersLineup(
  players: readonly LineupScoringPlayer[],
  context: NoLosersRoundContext
): NoLosersLineupScore {
  const ruleResults = new Map(
    [...context.results].map(([matchUid, result]) => [matchUid, toRuleResult(result)])
  );
  const rule = applyNoLosersResultRule({
    results: ruleResults,
    players: players.map((player) => {
      const statRow = context.statRowByPlayerId.get(player.playerId);
      const matchUid = statRow?.matchUid ?? null;
      const result = matchUid ? context.results.get(matchUid) : undefined;
      return {
        ...player,
        matchId: matchUid,
        club: result ? resolveResultClub(statRow?.teamAbbr ?? null, result) : '',
      };
    }),
  });
  return {
    rule,
    players:
      countedLineupPlayers(rule) ??
      rule.players.map((player) => ({
        playerId: player.playerId,
        slot: player.slot,
        totals: player.countedTotals ?? player.rawTotals,
      })),
  };
}

export type NoLosersPlayerView =
  | {
      status: 'COUNTED';
      clubResult: 'WIN' | 'DRAW' | 'LOSS' | 'ABANDONED';
      margin: number | null;
      multiplier: 1 | 0.5 | 0;
    }
  /** BR-20: a finished game with no stored result yet; raw stats shown, nothing guessed. */
  | { status: 'RESULT_PENDING' }
  /** The stat row cannot be joined to its result (a data fault); raw stats shown. */
  | { status: 'UNRESOLVED' };

/** What a scoreboard row shows; null for a bench player or a player with no stat row. */
export function noLosersPlayerView(player: NoLosersScoredPlayer): NoLosersPlayerView | null {
  const { outcome } = player;
  if (outcome.kind === 'RESULT') {
    return {
      status: 'COUNTED',
      clubResult: outcome.clubResult,
      margin: outcome.margin,
      multiplier: outcome.multiplier,
    };
  }
  if (outcome.kind !== 'UNAVAILABLE') return null;
  return { status: outcome.reason === 'RESULT_MISSING' ? 'RESULT_PENDING' : 'UNRESOLVED' };
}

/**
 * Why the round cannot be FINAL yet (BR-08), one line per game: every finished game without a
 * stored result, and every game a counted player's stat row cannot be joined to. Empty when the
 * round can be finalized.
 */
export function noLosersWaitingOn(
  context: NoLosersRoundContext,
  scoredPlayers: readonly NoLosersScoredPlayer[]
): string[] {
  const labelOf = (matchUid: string) =>
    context.games.find((game) => game.matchUid === matchUid)?.label ?? matchUid;
  const waiting = new Set<string>();
  for (const game of context.games) {
    if (game.finished && !context.results.has(game.matchUid)) waiting.add(game.matchUid);
  }
  const unresolved = new Set<string>();
  for (const player of scoredPlayers) {
    if (player.outcome.kind !== 'UNAVAILABLE') continue;
    const matchUid = context.statRowByPlayerId.get(player.playerId)?.matchUid ?? null;
    if (player.outcome.reason === 'RESULT_MISSING' && matchUid) waiting.add(matchUid);
    else unresolved.add(matchUid ?? 'an unknown game');
  }
  return [
    ...[...waiting].map((matchUid) => `Waiting on the result of ${labelOf(matchUid)}`),
    ...[...unresolved].map(
      (matchUid) => `A player's club cannot be matched to ${labelOf(matchUid)}`
    ),
  ];
}

/** BR-21: one stored row per counted player, from which the side's team totals re-derive. */
export function noLosersPlayerScoreRows(
  score: NoLosersLineupScore,
  context: NoLosersRoundContext,
  scope: { leagueId: string; seasonId: string; matchupId: string; memberId: string; round: number }
): Prisma.LeagueMatchupPlayerScoreCreateManyInput[] {
  return score.rule.players.flatMap((player) => {
    const { outcome } = player;
    if (outcome.kind === 'NOT_COUNTED_SLOT') return [];
    const matchUid = context.statRowByPlayerId.get(player.playerId)?.matchUid ?? null;
    const isResult = outcome.kind === 'RESULT';
    return [
      {
        ...scope,
        playerId: player.playerId,
        slot: player.slot,
        outcome: isResult
          ? 'RESULT'
          : outcome.kind === 'NO_STAT_ROW'
            ? 'NO_STAT_ROW'
            : outcome.reason === 'RESULT_MISSING'
              ? 'RESULT_PENDING'
              : 'UNRESOLVED',
        clubResult: isResult ? outcome.clubResult : null,
        margin: isResult ? outcome.margin : null,
        multiplier: isResult ? outcome.multiplier : null,
        aflMatchUid: matchUid,
        aflMatchResultId: isResult && matchUid ? (context.results.get(matchUid)?.id ?? null) : null,
        rawTotalsJson: player.rawTotals,
        countedTotalsJson: player.countedTotals ?? player.rawTotals,
        ruleVersion: score.rule.ruleVersion,
      },
    ];
  });
}
