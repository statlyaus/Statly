import type { Prisma } from '@prisma/client';

import {
  FANTASY_CATEGORY_KEYS,
  normalizeFantasyCategoryKeys,
  type FantasyCategoryKey,
  type PlayerStats,
} from '@/types/fantasyCategories';
import type { Player } from '@/types/players';
import { normalizeCategoryDirections } from '@/server/leagues/categoryDirections';
import type { CategoryDirection } from '@/server/leagues/scoringTypes';
import { listSeasonStatPlayers, listStatSeasons } from '@/server/players/playerPoolReadModel';
import {
  getLeaguePlayerStatSeasonOptions,
  projectLeaguePlayerStatLine,
  readPlayerSeasonStatAverage,
} from '@/server/players/readModels/leaguePlayerStatReadModel';

type DraftPlayerStatsProjection = {
  avgPoints?: number;
  averagePoints?: number;
  fantasyPoints?: number;
  gamesPlayed: number;
  statsSeason: number;
  availableStatSeasons: number[];
  stats: Partial<PlayerStats>;
};

export type StatlyZPlayerInput = {
  id: string;
  stats?: Partial<PlayerStats> | null;
};

type StatlyZBreakdownEntry = {
  category: FantasyCategoryKey;
  value: number;
  zScore: number;
};

type StatlyZScore = {
  score: number;
  breakdown: StatlyZBreakdownEntry[];
  missingCategories: FantasyCategoryKey[];
};

export type AvailableDraftPlayerSource = {
  id: string;
  name: string;
  position: string;
  club: string;
};

export type DraftPlayerStatsLookup = ReturnType<typeof buildDraftPlayerStatsLookup>;
export type DraftStatSeasonOptions = {
  selectedSeason: number;
  availableSeasons: number[];
};

export function parseSelectedCategories(raw: unknown): FantasyCategoryKey[] {
  return normalizeFantasyCategoryKeys(raw, []);
}

function roundStat(value: number): number {
  return Math.round(value * 10) / 10;
}

function roundStatlyZ(value: number): number {
  const rounded = Math.round(value * 100) / 100;
  return Object.is(rounded, -0) ? 0 : rounded;
}

function validSelectedCategories(
  selectedCategories: readonly (FantasyCategoryKey | string)[]
): FantasyCategoryKey[] {
  return normalizeFantasyCategoryKeys(selectedCategories, []);
}

function readFinitePlayerStat(
  player: StatlyZPlayerInput,
  category: FantasyCategoryKey
): number | null {
  const value = player.stats?.[category];
  return typeof value === 'number' && Number.isFinite(value) ? value : null;
}

export function calculateStatlyZScores(
  players: readonly StatlyZPlayerInput[],
  selectedCategories: readonly (FantasyCategoryKey | string)[],
  categoryDirections?: Partial<Record<FantasyCategoryKey, CategoryDirection>> | null
): Map<string, StatlyZScore> {
  const categories = validSelectedCategories(selectedCategories);
  // The league's direction decides the sign: a high value in a LOW_WINS category lowers the score.
  const directions = normalizeCategoryDirections(categories, categoryDirections);
  const categoryStats = new Map<FantasyCategoryKey, { mean: number; stdDev: number }>();

  for (const category of categories) {
    const values = players
      .map((player) => readFinitePlayerStat(player, category))
      .filter((value): value is number => value !== null);

    if (values.length === 0) {
      categoryStats.set(category, { mean: 0, stdDev: 0 });
      continue;
    }

    const mean = values.reduce((total, value) => total + value, 0) / values.length;
    const variance =
      values.reduce((total, value) => total + (value - mean) ** 2, 0) / values.length;

    categoryStats.set(category, { mean, stdDev: Math.sqrt(variance) });
  }

  return new Map(
    players.map((player) => {
      const breakdown: StatlyZBreakdownEntry[] = [];
      const missingCategories: FantasyCategoryKey[] = [];
      let score = 0;

      for (const category of categories) {
        const value = readFinitePlayerStat(player, category);

        if (value === null) {
          missingCategories.push(category);
          continue;
        }

        const stats = categoryStats.get(category);
        const rawZScore = stats && stats.stdDev !== 0 ? (value - stats.mean) / stats.stdDev : 0;
        const zScore = directions[category] === 'LOW_WINS' ? -rawZScore : rawZScore;
        const roundedZScore = roundStatlyZ(zScore);

        score += zScore;
        breakdown.push({ category, value, zScore: roundedZScore });
      }

      return [
        player.id,
        {
          score: roundStatlyZ(score),
          breakdown,
          missingCategories,
        },
      ];
    })
  );
}

function projectDraftPlayerStats(
  player: Player,
  requestedSeason?: number | null
): DraftPlayerStatsProjection | null {
  const seasonOptions = getLeaguePlayerStatSeasonOptions([player], requestedSeason);
  const selectedSeason = requestedSeason ?? seasonOptions.selectedSeason;
  const seasonSource = player.statsBySeason?.[String(selectedSeason)];
  if (!seasonSource || seasonSource.games <= 0) return null;

  const statLine = projectLeaguePlayerStatLine(player, FANTASY_CATEGORY_KEYS, selectedSeason);
  const stats: Partial<PlayerStats> = {};

  for (const key of FANTASY_CATEGORY_KEYS) {
    const value = statLine.values[key];
    if (typeof value === 'number' && Number.isFinite(value)) stats[key] = roundStat(value);
  }

  if (Object.keys(stats).length === 0) return null;

  const averageFantasyPoints = readPlayerSeasonStatAverage(seasonSource, ['aflFantasy']);
  const score = averageFantasyPoints === null ? null : roundStat(averageFantasyPoints);

  return {
    ...(score === null
      ? {}
      : {
          avgPoints: score,
          averagePoints: score,
          fantasyPoints: score,
        }),
    gamesPlayed: statLine.gamesPlayed,
    statsSeason: selectedSeason,
    availableStatSeasons: seasonOptions.availableSeasons,
    stats,
  };
}

/**
 * Draft stat projections keyed on the canonical `Player.id`. The stored stats and the draft pool
 * share that id, so a player gets only their own stats: never a namesake's by name or club.
 */
export function buildDraftPlayerStatsLookup(
  players: Player[],
  options: { season?: number | null } = {}
) {
  const byId = new Map<string, DraftPlayerStatsProjection>();
  for (const player of players) {
    const projection = projectDraftPlayerStats(player, options.season);
    if (projection) byId.set(player.id, projection);
  }
  return { byId };
}

/** The draft's stat season: the requested one when stored, else the newest stored season. */
export async function loadDraftStatSeasonOptions(
  requestedSeason?: number | null
): Promise<DraftStatSeasonOptions> {
  const availableSeasons = await listStatSeasons();
  const selectedSeason =
    requestedSeason && availableSeasons.includes(requestedSeason)
      ? requestedSeason
      : (availableSeasons[0] ?? new Date().getFullYear());
  return { selectedSeason, availableSeasons };
}

/**
 * One season's stored stats (default the newest), read once for the whole draft pool. Inside a
 * transaction pass `client`, so the read does not wait on a second pool connection.
 */
export async function loadDraftPlayerStatsLookup(
  options: { season?: number | null } = {},
  client?: Pick<Prisma.TransactionClient, 'playerSeasonStat'>
): Promise<DraftPlayerStatsLookup> {
  const season = options.season ?? (await listStatSeasons(client))[0] ?? null;
  return buildDraftPlayerStatsLookup(await listSeasonStatPlayers({ season }, client), { season });
}

export function buildAvailableDraftPlayer(
  player: AvailableDraftPlayerSource,
  statsLookup: DraftPlayerStatsLookup | null
) {
  return {
    id: player.id,
    name: player.name,
    position: player.position,
    club: player.club,
    isAvailable: true,
    // Kept as an undefined compatibility field until roster and waiver adapters stop reading it.
    statsTotal: undefined,
    ...statsLookup?.byId.get(player.id),
  };
}
