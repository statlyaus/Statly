import type { Prisma } from '@prisma/client';

import { prisma } from '@/lib/prisma';
import type { Player, PlayerSeasonStatBasis, PlayerSeasonStatSource } from '@/types/players';

/**
 * The player pool managers browse, search, draft, roster and trade: Prisma `Player` (canonical id,
 * club, position) with each season's totals from Prisma `PlayerSeasonStat`
 * (docs/runbooks/player-identity.md, "Player season stat totals"). Never reads Firestore.
 */

/**
 * ETL stat keys (etl/normalizePlayerRow.ts, as `PlayerSeasonStat` stores them) to the app's stat
 * keys. A test holds it to exactly the keys the ETL stores.
 */
export const APP_STAT_KEY: Record<string, string> = {
  kicks: 'kicks',
  handballs: 'handballs',
  disposals: 'disposals',
  marks: 'marks',
  tackles: 'tackles',
  goals: 'goals',
  behinds: 'behinds',
  hit_outs: 'hitouts',
  clearances: 'clearances',
  inside_50s: 'inside50s',
  rebound_50s: 'rebound50s',
  clangers: 'clangers',
  contested_possessions: 'contestedPossessions',
  uncontested_possessions: 'uncontestedPossessions',
  frees_for: 'freesFor',
  frees_against: 'freesAgainst',
  one_percenters: 'onePercenters',
  goal_assists: 'goalAssists',
  turnovers: 'turnovers',
  intercepts: 'intercepts',
  metres_gained: 'metresGained',
  contested_marks: 'contestedMarks',
  effective_disposals: 'effectiveDisposals',
  disposal_efficiency: 'disposalEfficiency',
  score_involvements: 'scoreInvolvements',
  minutes: 'minutes',
  tog_pct: 'timeOnGroundPct',
};

/** Percentages: a season figure is the mean of the games, never a sum. */
const PER_GAME_ONLY = new Set(['disposal_efficiency', 'tog_pct']);

type StoredSeasonStat = {
  season: number;
  games: number;
  totalsJson: Prisma.JsonValue;
  gamesByStatJson: Prisma.JsonValue;
};

const asNumberRecord = (value: Prisma.JsonValue): Record<string, number> =>
  value && typeof value === 'object' && !Array.isArray(value)
    ? Object.fromEntries(
        Object.entries(value).filter(
          (entry): entry is [string, number] =>
            typeof entry[1] === 'number' && Number.isFinite(entry[1])
        )
      )
    : {};

/**
 * A stored season as the app's stat source. Counts are season totals; a count some games did not
 * report is scaled to all the games, so its per-game value is its mean over the games that did
 * (readers divide totals by `games`). A scaled count is therefore not a true season total.
 * Percentages are the mean of the games, read per game.
 */
export function toSeasonStatSource(row: StoredSeasonStat): PlayerSeasonStatSource {
  const totals = asNumberRecord(row.totalsJson);
  const gamesByStat = asNumberRecord(row.gamesByStatJson);
  const stats: Record<string, number> = {};
  const basisByStat: Record<string, PlayerSeasonStatBasis> = {};
  for (const [etlKey, total] of Object.entries(totals)) {
    const key = APP_STAT_KEY[etlKey];
    const reported = gamesByStat[etlKey] ?? 0;
    if (!key || reported <= 0) continue;
    if (PER_GAME_ONLY.has(etlKey)) {
      stats[key] = total / reported;
      basisByStat[key] = 'PER_GAME';
    } else {
      stats[key] = reported < row.games ? (total * row.games) / reported : total;
      basisByStat[key] = 'TOTAL';
    }
  }
  return { games: row.games, dataThrough: null, stats, basisByStat };
}

type PoolPlayer = {
  id: string;
  name: string;
  club: string;
  position: string;
  seasonStats: StoredSeasonStat[];
};

/** A pool player with the seasons loaded for them, showing `season` (or their latest) as `stats`. */
export function toPoolPlayer(player: PoolPlayer, season?: number): Player {
  const sorted = [...player.seasonStats].sort((a, b) => b.season - a.season);
  const statsBySeason = Object.fromEntries(
    sorted.map((row) => [String(row.season), toSeasonStatSource(row)])
  );
  const statsSeason = season ?? sorted[0]?.season;
  const shown = statsSeason ? statsBySeason[String(statsSeason)] : undefined;
  return {
    id: player.id,
    name: player.name,
    team: player.club,
    position: player.position,
    games: shown?.games ?? 0,
    stats: shown?.stats ?? {},
    statsBySeason,
    statsSeason,
    availableStatSeasons: sorted.map((row) => row.season),
  };
}

export interface PlayerPoolFilters {
  /** Matches any part of the name, club or position, ignoring case. */
  query?: string;
  /** The one season loaded and shown as `stats`; null before any season is filled. */
  season: number | null;
  /** Everyone with a row for `season`, active or not (a past season); default the active pool. */
  playedOnly?: boolean;
}

const seasonStatSelect = {
  season: true,
  games: true,
  totalsJson: true,
  gamesByStatJson: true,
} as const;

/** Seasons with stored totals, latest first. */
export async function listStatSeasons(
  client: Pick<Prisma.TransactionClient, 'playerSeasonStat'> = prisma
): Promise<number[]> {
  const rows = await client.playerSeasonStat.groupBy({
    by: ['season'],
    orderBy: { season: 'desc' },
  });
  return rows.map((row) => row.season);
}

type PoolClient = Pick<Prisma.TransactionClient, 'player'>;

/** Pool players sorted by name, with only `season`'s totals loaded and shown. */
export async function listPoolPlayers(
  filters: PlayerPoolFilters,
  client: PoolClient = prisma
): Promise<Player[]> {
  const season = filters.season;
  const players = await client.player.findMany({
    where: {
      ...(filters.playedOnly && season !== null
        ? { seasonStats: { some: { season } } }
        : { active: true }),
      ...(filters.query
        ? {
            OR: [
              { name: { contains: filters.query, mode: 'insensitive' as const } },
              { club: { contains: filters.query, mode: 'insensitive' as const } },
              { position: { contains: filters.query, mode: 'insensitive' as const } },
            ],
          }
        : {}),
    },
    select: {
      id: true,
      name: true,
      club: true,
      position: true,
      // One season only: every season of every player would bloat the page and its cache.
      seasonStats: {
        where: { season: { in: season === null ? [] : [season] } },
        select: seasonStatSelect,
      },
    },
    orderBy: { name: 'asc' },
  });
  return players.map((player) => toPoolPlayer(player, season ?? undefined));
}

/** One pool player by canonical id, active or not. */
export async function getPoolPlayer(
  id: string,
  client: PoolClient = prisma
): Promise<Player | null> {
  const player = await client.player.findUnique({
    where: { id },
    select: {
      id: true,
      name: true,
      club: true,
      position: true,
      seasonStats: { select: seasonStatSelect },
    },
  });
  return player ? toPoolPlayer(player) : null;
}

/**
 * One season's stored totals with their players, active or not (a rostered player who has since
 * retired keeps their stats), for the draft, lineup and trade stat columns. `ids` limits it to
 * those players. Keyed on the canonical `Player.id`, so callers join by id and never by name.
 */
export async function listSeasonStatPlayers(
  { season, ids }: { season: number | null; ids?: readonly string[] },
  client: Pick<Prisma.TransactionClient, 'playerSeasonStat'> = prisma
): Promise<Player[]> {
  if (season === null) return [];
  const rows = await client.playerSeasonStat.findMany({
    where: { season, ...(ids ? { playerId: { in: [...ids] } } : {}) },
    select: {
      ...seasonStatSelect,
      player: { select: { id: true, name: true, club: true, position: true } },
    },
  });
  return rows.map(({ player, ...row }) => toPoolPlayer({ ...player, seasonStats: [row] }, season));
}

/** These players' totals for the newest stored season: the lineup and trade stat columns. */
export async function listLatestSeasonStatPlayers(ids: readonly string[]): Promise<Player[]> {
  const [season = null] = await listStatSeasons();
  return listSeasonStatPlayers({ season, ids });
}
