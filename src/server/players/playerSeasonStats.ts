import type { Prisma, PrismaClient } from '@prisma/client';

import { FOOTYWIRE_STATS_PROVIDER } from './footywireIdentity';
import { normalizeClub } from './footywirePositions';

/**
 * Per-player season totals (Prisma `PlayerSeasonStat`) built from the ETL's Footywire match stats
 * (Firestore `player_match_stats`, written by etl/processFootywireData.ts). A stat row reaches a
 * Statly player only through a reviewed `footywire` identity link; every other row is reported,
 * never matched by name (docs/runbooks/player-identity.md, "Player season stat totals").
 */

/** One `player_match_stats` document: one player in one match. */
export type EtlSeasonStatRow = {
  matchUid: string;
  playerUid: string;
  playerName: string;
  team: string;
  season: number;
  round: number;
  /** ETL stat key (e.g. contested_possessions) to its value; null when Footywire did not report it. */
  stats: Record<string, number | null>;
};

export type PlayerSeasonStatInput = {
  playerId: string;
  season: number;
  club: string;
  games: number;
  lastRound: number;
  totals: Record<string, number>;
  gamesByStat: Record<string, number>;
};

export type UnlinkedSeasonStatPlayer = {
  externalId: string;
  name: string;
  club: string;
  games: number;
};

/** A Footywire id seen at more than one club in the season: two namesakes share it. */
export type AmbiguousSeasonStatPlayer = { externalId: string; name: string; clubs: string[] };

const isNumber = (value: unknown): value is number =>
  typeof value === 'number' && Number.isFinite(value);
const integerOrNull = (value: unknown): number | null =>
  typeof value === 'number' && Number.isInteger(value) ? value : null;

/** Reads one `player_match_stats` document; throws on a document it cannot place in a game. */
export function toEtlSeasonStatRow(docId: string, data: Record<string, unknown>): EtlSeasonStatRow {
  const matchUid = typeof data.match_uid === 'string' ? data.match_uid : '';
  const playerUid = typeof data.player_uid === 'string' ? data.player_uid : '';
  const season = integerOrNull(data.season);
  const round = integerOrNull(data.round);
  if (!matchUid || !playerUid || season === null || round === null) {
    throw new Error(`player_match_stats/${docId} has no match_uid, player_uid, season or round`);
  }
  const stats =
    data.stats && typeof data.stats === 'object'
      ? Object.fromEntries(
          Object.entries(data.stats).map(([key, value]) => [key, isNumber(value) ? value : null])
        )
      : {};
  return {
    matchUid,
    playerUid,
    playerName: String(data.player_name ?? ''),
    team: String(data.team ?? ''),
    season,
    round,
    stats,
  };
}

type Group = { name: string; club: string; round: number; rows: EtlSeasonStatRow[] };

export function aggregatePlayerSeasonStats(
  season: number,
  rows: readonly EtlSeasonStatRow[],
  playerIdByExternalId: ReadonlyMap<string, string>
): {
  rows: PlayerSeasonStatInput[];
  unlinked: UnlinkedSeasonStatPlayer[];
  ambiguous: AmbiguousSeasonStatPlayer[];
} {
  // clubs: normalized club to the name as written, so spelling variants of one club agree.
  const groups = new Map<string, Group & { clubs: Map<string, string> }>();
  for (const row of rows) {
    if (row.season !== season) continue;
    const group = groups.get(row.playerUid) ?? {
      name: row.playerName,
      club: row.team,
      round: -1,
      rows: [],
      clubs: new Map<string, string>(),
    };
    group.rows.push(row);
    group.clubs.set(normalizeClub(row.team), row.team);
    if (row.round >= group.round) Object.assign(group, { round: row.round, club: row.team });
    groups.set(row.playerUid, group);
  }

  const byPlayer = new Map<string, PlayerSeasonStatInput & { matches: Set<string> }>();
  const unlinked: UnlinkedSeasonStatPlayer[] = [];
  const ambiguous: AmbiguousSeasonStatPlayer[] = [];

  for (const [externalId, group] of groups) {
    if (group.clubs.size > 1) {
      ambiguous.push({ externalId, name: group.name, clubs: [...group.clubs.values()].sort() });
      continue;
    }
    const playerId = playerIdByExternalId.get(externalId);
    if (!playerId) {
      const games = new Set(group.rows.map((row) => row.matchUid)).size;
      unlinked.push({ externalId, name: group.name, club: group.club, games });
      continue;
    }

    // The reviewed links give a player one Footywire id; a second one is a hand-made link.
    if (byPlayer.has(playerId)) throw new Error(`Player ${playerId} has two Footywire ids`);
    const acc: PlayerSeasonStatInput & { matches: Set<string> } = {
      playerId,
      season,
      club: group.club,
      games: 0,
      lastRound: -1,
      totals: {},
      gamesByStat: {},
      matches: new Set<string>(),
    };
    byPlayer.set(playerId, acc);
    for (const row of group.rows) {
      // One document per player and match; a repeat is the same game, never a second one.
      if (acc.matches.has(row.matchUid)) continue;
      acc.matches.add(row.matchUid);
      if (row.round >= acc.lastRound) Object.assign(acc, { lastRound: row.round, club: row.team });
      for (const [key, value] of Object.entries(row.stats)) {
        if (!isNumber(value)) continue;
        acc.totals[key] = (acc.totals[key] ?? 0) + value;
        acc.gamesByStat[key] = (acc.gamesByStat[key] ?? 0) + 1;
      }
    }
  }

  const byId = (a: { externalId: string }, b: { externalId: string }) =>
    a.externalId.localeCompare(b.externalId);
  return {
    rows: [...byPlayer.values()]
      .map(({ matches, ...stat }) => ({ ...stat, games: matches.size }))
      .sort((a, b) => a.playerId.localeCompare(b.playerId)),
    unlinked: unlinked.sort(byId),
    ambiguous: ambiguous.sort(byId),
  };
}

/**
 * Replaces every stored row of the season with `rows`, in one transaction. Refuses an empty fill:
 * a wrong season or a database without the links would otherwise wipe good rows.
 */
export async function replacePlayerSeasonStats(
  client: Pick<PrismaClient, '$transaction'>,
  season: number,
  rows: readonly PlayerSeasonStatInput[],
  calculatedAt = new Date()
): Promise<{ deleted: number; created: number }> {
  if (rows.length === 0) throw new Error(`No linked player has ${season} stats; nothing written`);
  const stray = rows.find((row) => row.season !== season);
  if (stray) throw new Error(`Row for ${stray.playerId} is season ${stray.season}, not ${season}`);

  return client.$transaction(async (tx: Prisma.TransactionClient) => {
    const deleted = await tx.playerSeasonStat.deleteMany({ where: { season } });
    const created = await tx.playerSeasonStat.createMany({
      data: rows.map((row) => ({
        playerId: row.playerId,
        season,
        club: row.club,
        games: row.games,
        lastRound: row.lastRound,
        totalsJson: row.totals,
        gamesByStatJson: row.gamesByStat,
        source: FOOTYWIRE_STATS_PROVIDER,
        calculatedAt,
      })),
    });
    return { deleted: deleted.count, created: created.count };
  });
}
