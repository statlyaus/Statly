import 'server-only';

import type { PrismaClient } from '@prisma/client';

import { prisma } from '@/lib/prisma';
import { getTeamName } from '@/lib/teamLogos';

import { normalizeRoundMatchStatus, type RawRoundMatch } from './liveStatsAdapter';
import { isCountedSlot, type LineupScoringPlayer } from './matchupScoringEngine';
import type { NoLosersPlayerView, StoredAflMatchResult } from './noLosersScoring';

/**
 * Read-model helpers for the No Losers screens (#1296, epic #1290 BR-40 to BR-42). Everything here
 * reads stored data (`AflMatchResult`, `LeagueMatchupPlayerScore`) or the fixture; nothing guesses a
 * result and the client never recomputes one. Footywire has no in-game score (BR-20), so a game in
 * progress shows no scoreline.
 */

/** Canonical club key: the fixture's club name, upper-cased. */
export function clubKey(club: string | null | undefined): string | null {
  const name = club?.trim() ? getTeamName(club.trim()) : '';
  return name ? name.toUpperCase() : null;
}

export type NoLosersGameState =
  /** A stored official result. */
  | 'FINAL'
  /** A stored ABANDONED result: counts in full for both clubs (BR-15). */
  | 'ABANDONED'
  /** Finished, but its official result is not stored yet (BR-20). */
  | 'RESULT_PENDING'
  | 'IN_PROGRESS'
  | 'SCHEDULED';

export interface NoLosersStripGame {
  matchUid: string;
  homeClub: string;
  awayClub: string;
  /** Only from a stored FINAL result. */
  homePoints: number | null;
  awayPoints: number | null;
  state: NoLosersGameState;
  startsAt: string | null;
}

/**
 * BR-41: the round's games for the club-result strip, in fixture order. A stored result wins over
 * the fixture's status; a result row with no fixture match (stats feed unavailable) is still shown.
 */
export function buildNoLosersClubStrip({
  matches,
  results,
  finishedMatchUids = new Set(),
}: {
  matches: readonly RawRoundMatch[];
  results: readonly StoredAflMatchResult[];
  /** Games known to be finished from their stat rows (Footywire posts stats only after the siren). */
  finishedMatchUids?: ReadonlySet<string>;
}): NoLosersStripGame[] {
  const resultByMatchUid = new Map(results.map((result) => [result.matchUid, result]));
  const statusByMatchUid = new Map(
    normalizeRoundMatchStatus(matches).matches.flatMap((match) =>
      match.matchId ? [[match.matchId, match] as const] : []
    )
  );
  const seen = new Set<string>();
  const games: NoLosersStripGame[] = [];
  for (const match of matches) {
    const matchUid = typeof match.match_uid === 'string' ? match.match_uid : null;
    if (!matchUid || seen.has(matchUid)) continue;
    seen.add(matchUid);
    const result = resultByMatchUid.get(matchUid);
    const fixture = statusByMatchUid.get(matchUid);
    const club = (value: unknown) => (typeof value === 'string' ? getTeamName(value) : '?');
    games.push(
      result
        ? stripGameFromResult(result, fixture?.startsAt ?? null)
        : {
            matchUid,
            homeClub: club(match.home_team),
            awayClub: club(match.away_team),
            homePoints: null,
            awayPoints: null,
            state:
              fixture?.status === 'final' || finishedMatchUids.has(matchUid)
                ? 'RESULT_PENDING'
                : fixture?.status === 'live'
                  ? 'IN_PROGRESS'
                  : 'SCHEDULED',
            startsAt: fixture?.startsAt?.toISOString() ?? null,
          }
    );
  }
  for (const result of results) {
    if (!seen.has(result.matchUid)) games.push(stripGameFromResult(result, null));
  }
  return games;
}

function stripGameFromResult(
  result: StoredAflMatchResult,
  startsAt: Date | null
): NoLosersStripGame {
  const final = result.status === 'FINAL';
  return {
    matchUid: result.matchUid,
    homeClub: result.homeClub,
    awayClub: result.awayClub,
    homePoints: final ? result.homePoints : null,
    awayPoints: final ? result.awayPoints : null,
    state: final ? 'FINAL' : 'ABANDONED',
    startsAt: startsAt?.toISOString() ?? null,
  };
}

export interface NoLosersClubCount {
  /** Canonical club name. */
  club: string;
  home: number;
  away: number;
}

/** BR-41: how many of each manager's counted (on-field) players are on each club. */
export function countCountedPlayersByClub(
  home: ReadonlyArray<{ slot: string; club?: string | null }>,
  away: ReadonlyArray<{ slot: string; club?: string | null }>
): NoLosersClubCount[] {
  const counts = new Map<string, NoLosersClubCount>();
  const add = (players: typeof home, side: 'home' | 'away') => {
    for (const player of players) {
      if (!isCountedSlot(player.slot as LineupScoringPlayer['slot'])) continue;
      const key = clubKey(player.club);
      if (!key) continue;
      const entry = counts.get(key) ?? { club: getTeamName(player.club!.trim()), home: 0, away: 0 };
      entry[side] += 1;
      counts.set(key, entry);
    }
  };
  add(home, 'home');
  add(away, 'away');
  return [...counts.values()].sort((a, b) => a.club.localeCompare(b.club));
}

/** A stored per-player score row (BR-21) as the read model needs it. */
export interface StoredNoLosersPlayerScore {
  memberId: string;
  playerId: string;
  outcome: string;
  clubResult: string | null;
  margin: number | null;
  multiplier: number | null;
  rawTotalsJson: unknown;
  countedTotalsJson: unknown;
}

/** The scoreboard view of a stored row; null for a player with no stat row. */
export function storedNoLosersPlayerView(
  row: StoredNoLosersPlayerScore
): NoLosersPlayerView | null {
  if (row.outcome === 'RESULT_PENDING') return { status: 'RESULT_PENDING' };
  if (row.outcome === 'UNRESOLVED') return { status: 'UNRESOLVED' };
  if (row.outcome !== 'RESULT') return null;
  const clubResult = row.clubResult;
  const multiplier = row.multiplier;
  if (
    (clubResult !== 'WIN' &&
      clubResult !== 'DRAW' &&
      clubResult !== 'LOSS' &&
      clubResult !== 'ABANDONED') ||
    (multiplier !== 1 && multiplier !== 0.5 && multiplier !== 0)
  ) {
    return { status: 'UNRESOLVED' };
  }
  return { status: 'COUNTED', clubResult, margin: row.margin, multiplier };
}

export interface ClubSeasonRecord {
  wins: number;
  losses: number;
  draws: number;
}

/**
 * BR-42: each club's season win-loss-draw record from current stored results. Abandoned games
 * have no winner and are left out. Keyed by canonical club name.
 */
export function clubSeasonRecords(
  results: ReadonlyArray<
    Pick<StoredAflMatchResult, 'homeClub' | 'awayClub' | 'homePoints' | 'awayPoints' | 'status'>
  >
): Record<string, ClubSeasonRecord> {
  const records: Record<string, ClubSeasonRecord> = {};
  const recordOf = (club: string) => {
    const name = getTeamName(club);
    records[name] ??= { wins: 0, losses: 0, draws: 0 };
    return records[name];
  };
  for (const result of results) {
    if (result.status !== 'FINAL' || result.homePoints === null || result.awayPoints === null) {
      continue;
    }
    const home = recordOf(result.homeClub);
    const away = recordOf(result.awayClub);
    if (result.homePoints > result.awayPoints) {
      home.wins += 1;
      away.losses += 1;
    } else if (result.homePoints < result.awayPoints) {
      home.losses += 1;
      away.wins += 1;
    } else {
      home.draws += 1;
      away.draws += 1;
    }
  }
  return records;
}

/** The record for a player's club, matched by canonical name. */
export function clubRecordFor(
  records: Readonly<Record<string, ClubSeasonRecord>>,
  club: string | null | undefined
): ClubSeasonRecord | null {
  const key = clubKey(club);
  if (!key) return null;
  const match = Object.entries(records).find(([name]) => name.toUpperCase() === key);
  return match ? match[1] : { wins: 0, losses: 0, draws: 0 };
}

const RESULT_SELECT = {
  id: true,
  matchUid: true,
  homeClub: true,
  awayClub: true,
  homePoints: true,
  awayPoints: true,
  status: true,
} as const;

/** Current stored results for one AFL round. */
export async function loadRoundAflResults(
  season: number,
  aflRound: number,
  client: Pick<PrismaClient, 'aflMatchResult'> = prisma
): Promise<StoredAflMatchResult[]> {
  return client.aflMatchResult.findMany({
    where: { season, round: aflRound, supersededById: null },
    select: RESULT_SELECT,
    orderBy: { matchUid: 'asc' },
  });
}

/** BR-42: every club's season record, from current stored results. */
export async function loadClubSeasonRecords(
  season: number,
  client: Pick<PrismaClient, 'aflMatchResult'> = prisma
): Promise<Record<string, ClubSeasonRecord>> {
  const results = await client.aflMatchResult.findMany({
    where: { season, supersededById: null },
    select: RESULT_SELECT,
  });
  return clubSeasonRecords(results);
}
