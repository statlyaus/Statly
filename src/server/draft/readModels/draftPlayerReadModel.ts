import { getPlayers } from '@/lib/data';
import { buildCanonicalPlayerId } from '@/lib/playerIdentity';
import {
  FANTASY_CATEGORY_KEYS,
  normalizeFantasyCategoryKeys,
  type FantasyCategoryKey,
  type PlayerStats,
} from '@/types/fantasyCategories';
import type { Player } from '@/types/players';
import {
  getLeaguePlayerStatSeasonOptions,
  projectLeaguePlayerStatLine,
  readPlayerSeasonStatAverage,
} from '@/server/players/readModels/leaguePlayerStatReadModel';

const LOWER_IS_BETTER_CATEGORIES = new Set<FantasyCategoryKey>([
  'clangers',
  'freesAgainst',
  'turnovers',
]);

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

function normalizeLookupPart(value: string | null | undefined): string {
  return String(value ?? '')
    .trim()
    .toLowerCase();
}

export function parseSelectedCategories(raw: unknown): FantasyCategoryKey[] {
  let parsed: unknown = raw;

  if (typeof raw === 'string') {
    try {
      parsed = JSON.parse(raw);
    } catch {
      parsed = raw.split(',').map((value) => value.trim());
    }
  }

  return normalizeFantasyCategoryKeys(parsed, []);
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
  selectedCategories: readonly (FantasyCategoryKey | string)[]
): Map<string, StatlyZScore> {
  const categories = validSelectedCategories(selectedCategories);
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
        const zScore = LOWER_IS_BETTER_CATEGORIES.has(category) ? -rawZScore : rawZScore;
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

export function getDraftStatSeasonOptions(
  players: Player[],
  requestedSeason?: number | null
): DraftStatSeasonOptions {
  return getLeaguePlayerStatSeasonOptions(players, requestedSeason);
}

export function buildDraftPlayerStatsLookup(
  players: Player[],
  options: { season?: number | null } = {}
) {
  const byId = new Map<string, DraftPlayerStatsProjection>();
  const byNameAndTeam = new Map<string, DraftPlayerStatsProjection>();
  const byName = new Map<string, DraftPlayerStatsProjection>();
  const ambiguousNames = new Set<string>();

  for (const player of players) {
    const projection = projectDraftPlayerStats(player, options.season);
    if (!projection) continue;

    byId.set(player.id, projection);
    byId.set(buildCanonicalPlayerId(player.id), projection);
    byId.set(buildCanonicalPlayerId(player.name), projection);

    const normalizedName = normalizeLookupPart(player.name);
    const normalizedTeam = normalizeLookupPart(player.team);

    if (normalizedName && normalizedTeam) {
      byNameAndTeam.set(`${normalizedName}|${normalizedTeam}`, projection);
    }

    if (!normalizedName || ambiguousNames.has(normalizedName)) {
      continue;
    }

    if (!byName.has(normalizedName)) {
      byName.set(normalizedName, projection);
      continue;
    }

    byName.delete(normalizedName);
    ambiguousNames.add(normalizedName);
  }

  return { byId, byNameAndTeam, byName };
}

export async function loadDraftPlayerStatsLookup(
  options: { season?: number | null } = {}
): Promise<DraftPlayerStatsLookup> {
  return buildDraftPlayerStatsLookup(await getPlayers(), options);
}

export async function loadDraftStatSeasonOptions(
  requestedSeason?: number | null
): Promise<DraftStatSeasonOptions> {
  return getDraftStatSeasonOptions(await getPlayers(), requestedSeason);
}

function findStatsProjection(
  lookup: DraftPlayerStatsLookup,
  player: AvailableDraftPlayerSource
): DraftPlayerStatsProjection | undefined {
  return (
    lookup.byId.get(player.id) ??
    lookup.byId.get(buildCanonicalPlayerId(player.id)) ??
    lookup.byId.get(buildCanonicalPlayerId(player.name)) ??
    lookup.byNameAndTeam.get(
      `${normalizeLookupPart(player.name)}|${normalizeLookupPart(player.club)}`
    ) ??
    lookup.byName.get(normalizeLookupPart(player.name))
  );
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
    ...(statsLookup ? findStatsProjection(statsLookup, player) : undefined),
  };
}
